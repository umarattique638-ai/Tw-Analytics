import { LIMITS, dedupeKey } from '@tailwatch/contract';
import type { DropQueueMessage, EventQueueMessage, QueueMessage } from '@tailwatch/contract';
import { batchToken } from './core/batch';
import { advanceRecord, chTime, eventRow, sessionRows } from './core/rows';
import type { DroppedRow, EventRow, SessionRecord, SessionRow } from './core/rows';
import { precisionVerdict } from './precision';

/**
 * Consumer batch processing, in the exact order of PLAN 3.1 step 3:
 *
 *   (a) R2 archive of the untransformed batch      <- FIRST, before anything else
 *   (b) classify + enrich in memory; drops are recorded WITH A REASON, never discarded.
 *       Stage 7: the precision pass (bots.yml, headless scoring, referrer spam, src/precision) runs per
 *       event after the de-dup check, and a flagged visitor stays quarantined for the session window.
 *   (c) load session state and de-dup markers (Durable Object, STAGE-1 D4), drop duplicates (D5)
 *   (d) ClickHouse INSERT INTO events          (one batch, explicit dedup token)
 *   (e) ClickHouse INSERT INTO sessions        (cancel + new row, VersionedCollapsingMergeTree)
 *       ClickHouse INSERT INTO dropped_hits    (the customer's warnings feed)
 *   (f) rollups: materialized views in ClickHouse, no code here
 *   (g) commit session state + de-dup markers together, LAST
 *
 * Every external system is a port, so this file has no Cloudflare or ClickHouse types in it and is
 * tested with fakes (the same lock-in rule as the collector).
 *
 * Idempotency:
 *   - The state is committed last. If anything fails before that, a retry recomputes the same rows.
 *   - Insert groups (2026-10-09 review): before inserting, every event's de-dup key is written to the state
 *     store with the insert group it goes out in (an "intent"). A retry finds that group and re-inserts the
 *     event under the SAME token, so ClickHouse drops the block even when the queue redelivers the message
 *     mixed with other, newer messages (which used to change the token and duplicate rows). New events of
 *     the retry go out in a second insert with their own token.
 *   - wrangler.toml max_concurrency = 1: one batch at a time, so two batches can never load the same
 *     visitor's session at once (PLAN 3.1 c "serialise per visitor").
 *   - Drop messages are de-duplicated by their queue message id (d:<id>) and grouped the same way, so a
 *     redelivered batched drop (hits: n) is not counted twice. A dead-letter replay gives new message ids:
 *     a drop that was inserted before it died can then count twice (rare: replay follows a real outage).
 *   - Residual risk: if another batch of the same visitor commits between a failed attempt and its retry,
 *     the retry's session rows differ from the first attempt's while the token drops them.
 *
 * Late events: an event more than 30 minutes OLDER than the visitor's current session (offline queue,
 * backfill) starts a session of its own instead of joining today's (PLAN 5, 30-min rule). It does not
 * replace the current session in the state store.
 */

export type ClickHouseTable = 'events' | 'sessions' | 'dropped_hits';

export interface ClickHousePort {
  /** One INSERT of many rows. Never called with a single row per event. */
  insert(table: ClickHouseTable, rows: readonly object[], dedupToken: string): Promise<void>;
}

/** What one batch needs from the state store for one site. */
export interface StateLoad {
  siteId: number;
  visitors: string[];
  dedupeKeys: string[];
}

export interface StateSnapshot {
  /** Keyed `${siteId}:${visitor}`. */
  sessions: Map<string, SessionRecord>;
  /** De-dup keys already processed within the last 7 days. */
  seen: Set<string>;
  /** De-dup key -> insert group of an earlier, unfinished attempt. */
  intents?: Map<string, string>;
}

export interface StateUpdate {
  siteId: number;
  visitor: string;
  record: SessionRecord;
}

export interface StatePort {
  load(requests: readonly StateLoad[], now: number): Promise<StateSnapshot>;
  /** Records the insert group of each event BEFORE the inserts (an existing intent is kept). */
  intend?(entries: readonly { siteId: number; key: string; group: string }[], now: number): Promise<void>;
  /** Sessions and de-dup markers are committed together (one transaction per shard). */
  commit(updates: readonly StateUpdate[], dedupe: readonly { siteId: number; key: string }[], now: number): Promise<void>;
}

export interface ArchivePort {
  /** R2 PUT of one NDJSON object. */
  put(key: string, body: string): Promise<void>;
}

export interface Ports {
  clickhouse: ClickHousePort;
  state: StatePort;
  archive?: ArchivePort;
  now(): number;
  log(event: string, fields?: Record<string, string | number>): void;
}

export interface Options {
  requireArchive: boolean;
}

export interface InboundMessage {
  id: string;
  timestamp: number;
  body: unknown;
}

export interface BatchResult {
  events: number;
  duplicates: number;
  dropsRecorded: number;
  poison: number;
  ignored: number;
  sessionsStarted: number;
  /** Events the precision pass dropped (Stage 7), also included in dropsRecorded. */
  precisionDrops: number;
  archiveKey: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isEventMessage(b: Record<string, unknown>): b is Record<string, unknown> & EventQueueMessage {
  const e = b.event;
  const v = b.visitor;
  return (
    isObj(e) && isObj(v) &&
    typeof v.hash === 'string' && typeof v.prevHash === 'string' &&
    isNum(e.siteId) && typeof e.name === 'string' && typeof e.url === 'string' &&
    typeof e.host === 'string' && typeof e.path === 'string' &&
    isNum(e.seq) && isNum(e.occurredAt) && isNum(e.receivedAt) && isNum(e.trackerVersion) &&
    isObj(e.props) &&
    (e.insertId === undefined || typeof e.insertId === 'string')
  );
}

function isDropMessage(b: Record<string, unknown>): b is Record<string, unknown> & DropQueueMessage {
  return isNum(b.at) && isNum(b.siteId) && typeof b.reason === 'string';
}

type Classified =
  | { kind: 'event'; id: string; msg: EventQueueMessage }
  | { kind: 'drop'; id: string; msg: DropQueueMessage }
  | { kind: 'ignored'; id: string }
  | { kind: 'poison'; id: string; siteId?: number; at: number; code: string };

/** Never throws. A message we cannot read must not fail the rest of the batch (PROJECT-NOTES 16). */
function classify(m: InboundMessage): Classified {
  const b = m.body;
  if (!isObj(b)) return { kind: 'poison', id: m.id, at: m.timestamp, code: 'not_an_object' };
  // Unknown future version or type: leave it alone, a newer consumer will handle it.
  if (b.v !== 1 || (b.type !== 'event' && b.type !== 'drop')) return { kind: 'ignored', id: m.id };
  if (b.type === 'event') {
    if (isEventMessage(b)) return { kind: 'event', id: m.id, msg: b as unknown as EventQueueMessage };
    const siteId = isObj(b.event) && isNum(b.event.siteId) ? b.event.siteId : undefined;
    return { kind: 'poison', id: m.id, siteId, at: m.timestamp, code: 'bad_event_shape' };
  }
  return isDropMessage(b)
    ? { kind: 'drop', id: m.id, msg: b as unknown as DropQueueMessage }
    : { kind: 'poison', id: m.id, siteId: isNum(b.siteId) ? b.siteId : undefined, at: m.timestamp, code: 'bad_drop_shape' };
}

const minuteOf = (ms: number): number => Math.floor(ms / 60_000) * 60_000;
/** Earlier insert groups that keep their own insert in one retry (subrequest budget). */
const MAX_OLD_GROUPS = 3;

interface DropItem {
  siteId: number;
  at: number;
  reason: string;
  detail: string;
  country: string;
  asn: number;
  /** Identical drops this item stands for (a batched drop message from the collector). Default 1. */
  hits?: number;
}

/** Same site, reason, detail, country, asn and minute collapse into one row with hits = n. */
function aggregateDrops(items: readonly DropItem[]): DroppedRow[] {
  const map = new Map<string, DroppedRow>();
  for (const d of items) {
    const at = minuteOf(d.at);
    const key = [d.siteId, d.reason, d.detail, d.country, d.asn, at].join('|');
    const hit = map.get(key);
    const n = d.hits ?? 1;
    if (hit) hit.hits += n;
    else map.set(key, { site_id: d.siteId, at: chTime(at), reason: d.reason, detail: d.detail, country_code: d.country, asn: d.asn, hits: n });
  }
  return [...map.values()];
}

/** raw/{YYYY-MM-DD}/{HH}/{token}.ndjson, from the batch itself: a redelivery overwrites the same object. */
async function archiveKey(messages: readonly InboundMessage[]): Promise<string> {
  const first = Math.min(...messages.map((m) => (Number.isFinite(m.timestamp) ? m.timestamp : 0)));
  const iso = new Date(Number.isFinite(first) && first > 0 ? first : 0).toISOString();
  return `raw/${iso.slice(0, 10)}/${iso.slice(11, 13)}/${await batchToken(messages.map((m) => m.id), 'archive')}.ndjson`;
}

export async function processBatch(messages: readonly InboundMessage[], ports: Ports, options: Options): Promise<BatchResult> {
  const result: BatchResult = { events: 0, duplicates: 0, dropsRecorded: 0, poison: 0, ignored: 0, sessionsStarted: 0, precisionDrops: 0, archiveKey: null };
  if (messages.length === 0) return result;
  const now = ports.now();

  // (a) ARCHIVE FIRST. If it fails the whole batch is retried; nothing else has happened yet.
  if (ports.archive) {
    const key = await archiveKey(messages);
    const body = messages.map((m) => JSON.stringify({ id: m.id, timestamp: m.timestamp, body: m.body })).join('\n') + '\n';
    await ports.archive.put(key, body);
    result.archiveKey = key;
  } else if (options.requireArchive) {
    throw new Error('archive_required_but_missing');
  } else {
    ports.log('archive_skipped');
  }

  // (b) classify in memory.
  const classified = messages.map(classify);
  const events: { id: string; msg: EventQueueMessage; key: string }[] = [];
  /** Drop messages and poison: keyed by their queue message id, so a redelivery is not counted twice. */
  const messageDrops: { key: string; item: DropItem }[] = [];
  const unkeyedDrops: DropItem[] = [];
  for (const c of classified) {
    if (c.kind === 'event') events.push({ id: c.id, msg: c.msg, key: dedupeKey(c.msg.event.siteId, c.msg.event.insertId, c.id) });
    else if (c.kind === 'drop') {
      const hits = Number.isInteger(c.msg.hits) && c.msg.hits! > 0 && c.msg.hits! <= 1_000_000 ? c.msg.hits! : 1;
      messageDrops.push({ key: `d:${c.id}`, item: { siteId: c.msg.siteId, at: c.msg.at, reason: c.msg.reason, detail: c.msg.detail ?? '', country: c.msg.country ?? '', asn: c.msg.asn ?? 0, hits } });
    } else if (c.kind === 'ignored') result.ignored += 1;
    else {
      result.poison += 1;
      if (c.siteId !== undefined) messageDrops.push({ key: `d:${c.id}`, item: { siteId: c.siteId, at: c.at, reason: 'consumer_invalid', detail: c.code, country: '', asn: 0 } });
    }
  }

  // (c) one state load for the whole batch. Store errors are NOT caught: they retry the batch.
  const loads = new Map<number, StateLoad>();
  const loadFor = (siteId: number) => {
    const load = loads.get(siteId) ?? { siteId, visitors: [], dedupeKeys: [] };
    loads.set(siteId, load);
    return load;
  };
  for (const { msg, key } of events) {
    const load = loadFor(msg.event.siteId);
    load.visitors.push(msg.visitor.hash, msg.visitor.prevHash);
    load.dedupeKeys.push(key);
  }
  for (const d of messageDrops) loadFor(d.item.siteId).dedupeKeys.push(d.key);
  const snapshot: StateSnapshot = loads.size > 0 ? await ports.state.load([...loads.values()], now) : { sessions: new Map(), seen: new Set<string>() };

  // Insert groups: this attempt's own group, plus the group of anything an earlier attempt was inserting.
  // At most MAX_OLD_GROUPS earlier groups keep their own insert (Free plan: 50 subrequests per invocation);
  // in the very rare case of more, the rest join this attempt's group.
  const ids = messages.map((m) => m.id);
  const ownGroup = await batchToken(ids, 'group');
  const oldGroups = [...new Set(snapshot.intents?.values() ?? [])].sort().slice(0, MAX_OLD_GROUPS);
  const groupFor = (key: string): string => {
    const g = snapshot.intents?.get(key);
    return g && oldGroups.includes(g) ? g : ownGroup;
  };

  // Sessions need time order per visitor; the queue does not guarantee order. Events an earlier attempt was
  // inserting go FIRST (by group, then time), so their rows come out exactly as the first time and the
  // ClickHouse token can drop them; this attempt's new events then continue from that state.
  const rank = (key: string) => {
    const g = groupFor(key);
    return g === ownGroup ? oldGroups.length : oldGroups.indexOf(g);
  };
  events.sort(
    (a, b) =>
      rank(a.key) - rank(b.key) || a.msg.event.occurredAt - b.msg.event.occurredAt || a.msg.event.seq - b.msg.event.seq || (a.id < b.id ? -1 : 1),
  );

  const cache = new Map<string, SessionRecord | null>(snapshot.sessions);
  const lookup = (siteId: number, visitor: string): SessionRecord | null => cache.get(`${siteId}:${visitor}`) ?? null;
  const dirty = new Map<string, StateUpdate>();
  const processedKeys: { siteId: number; key: string }[] = [];
  const keysThisBatch = new Set<string>();

  const groups = new Map<string, { events: EventRow[]; sessions: SessionRow[]; drops: DropItem[] }>();
  const groupRows = (g: string) => {
    let hit = groups.get(g);
    if (!hit) groups.set(g, (hit = { events: [], sessions: [], drops: [] }));
    return hit;
  };
  const intentsToWrite: { siteId: number; key: string; group: string }[] = [];
  const remember = (siteId: number, key: string, group: string) => {
    if (!snapshot.intents?.has(key)) intentsToWrite.push({ siteId, key, group });
  };
  /** Sessions of late events (older than the current session): kept for this batch only, never stored. */
  const detached = new Map<string, SessionRecord>();
  let dropsCount = 0;
  const addDrop = (group: string, item: DropItem) => {
    groupRows(group).drops.push(item);
    dropsCount += item.hits ?? 1;
  };

  for (const { key, item } of messageDrops) {
    if (snapshot.seen.has(key) || keysThisBatch.has(key)) {
      result.duplicates += 1;
      continue;
    }
    keysThisBatch.add(key);
    const group = groupFor(key);
    addDrop(group, item);
    remember(item.siteId, key, group);
    processedKeys.push({ siteId: item.siteId, key });
  }
  for (const item of unkeyedDrops) addDrop(ownGroup, item);

  for (const { msg, key } of events) {
    const siteId = msg.event.siteId;
    // De-dup: already processed in the last 7 days, or earlier in this very batch (STAGE-1 D5).
    if (snapshot.seen.has(key) || keysThisBatch.has(key)) {
      result.duplicates += 1;
      continue;
    }
    keysThisBatch.add(key);
    const group = groupFor(key);

    // Today's hash first, then yesterday's: a visit that crosses UTC midnight is one session.
    const prev = lookup(siteId, msg.visitor.hash) ?? lookup(siteId, msg.visitor.prevHash);

    // Stage 7 precision pass. A visitor already quarantined keeps its first verdict.
    const verdict = prev?.quarantine ?? precisionVerdict(msg.event);
    if (verdict) {
      const e = msg.event;
      addDrop(group, { siteId, at: e.receivedAt, reason: verdict.reason, detail: verdict.detail, country: e.country ?? '', asn: e.asn ?? 0 });
      remember(siteId, key, group);
      result.precisionDrops += 1;
      processedKeys.push({ siteId, key });
      // Referrer spam only carries its referrer on the FIRST hit; remember the verdict for this visitor
      // (same 30 min sliding TTL as a session) so its later hits are dropped too. Bot and headless verdicts
      // are NOT remembered: they are recomputed on every hit anyway, and a visitor hash (IP + UA) can be
      // shared by real people behind one carrier/office address (Stage 7 review). The session itself is
      // NOT advanced: nothing of a dropped event reaches a count.
      if (verdict.reason !== 'referrer_spam') continue;
      let record: SessionRecord | null = null;
      let visitor = msg.visitor.hash;
      if (prev) {
        record = { ...prev, quarantine: { reason: verdict.reason, detail: verdict.detail } };
        visitor = prev.state.visitor;
      } else {
        try {
          record = { ...advanceRecord(null, msg).record, quarantine: { reason: verdict.reason, detail: verdict.detail } };
        } catch {
          record = null; // an unreadable time: the drop is still itemised, there is just no quarantine
        }
      }
      if (record) {
        cache.set(`${siteId}:${visitor}`, record);
        dirty.set(`${siteId}:${visitor}`, { siteId, visitor, record });
      }
      continue;
    }

    try {
      // A late event (more than 30 min before the current session started) is a session of its own.
      const late = !!prev && msg.event.occurredAt < prev.state.start - LIMITS.sessionGapMs;
      const dKey = `${siteId}:${prev?.state.visitor ?? msg.visitor.hash}`;
      const adv = late ? advanceRecord(detached.get(dKey) ?? null, msg) : advanceRecord(prev, msg);
      // Build everything first, then push: a throw must never leave half an event behind.
      const er = eventRow(msg, { id: adv.record.state.id, started: adv.started, visitor: adv.visitor });
      const sr = sessionRows(siteId, adv.previous, adv.record);
      const g = groupRows(group);
      g.events.push(er);
      g.sessions.push(...sr);
      remember(siteId, key, group);
      if (late) detached.set(dKey, adv.record);
      else {
        cache.set(`${siteId}:${adv.visitor}`, adv.record);
        dirty.set(`${siteId}:${adv.visitor}`, { siteId, visitor: adv.visitor, record: adv.record });
      }
      processedKeys.push({ siteId, key });
      if (adv.started) result.sessionsStarted += 1;
      result.events += 1;
    } catch (error) {
      // One unreadable event (for example a time ClickHouse cannot hold) must not take the batch down.
      // It is counted and itemised, never silently lost, and marked seen so a retry does not repeat it.
      result.poison += 1;
      processedKeys.push({ siteId, key });
      remember(siteId, key, group);
      addDrop(group, { siteId, at: msg.event.receivedAt, reason: 'consumer_invalid', detail: error instanceof Error ? error.name : 'unknown', country: '', asn: 0 });
    }
  }

  result.dropsRecorded = dropsCount;

  // Intents first, so a failure from here on can be retried under the same tokens.
  if (intentsToWrite.length > 0 && ports.state.intend) await ports.state.intend(intentsToWrite, now);

  // (d) events, (e) sessions, then the itemised drops. ONE insert per table per group (normally one group;
  // a retry that also carries new messages has two). Earlier groups go first.
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === ownGroup ? 1 : b === ownGroup ? -1 : a < b ? -1 : 1));
  for (const [group, rows] of ordered) {
    if (rows.events.length > 0) await ports.clickhouse.insert('events', rows.events, await batchToken([group], 'events'));
  }
  for (const [group, rows] of ordered) {
    if (rows.sessions.length > 0) await ports.clickhouse.insert('sessions', rows.sessions, await batchToken([group], 'sessions'));
  }
  for (const [group, rows] of ordered) {
    const dropped = aggregateDrops(rows.drops);
    if (dropped.length > 0) await ports.clickhouse.insert('dropped_hits', dropped, await batchToken([group], 'dropped_hits'));
  }

  // (f) rollups fire inside ClickHouse. (g) State + de-dup markers are committed last, together.
  if (dirty.size > 0 || processedKeys.length > 0) await ports.state.commit([...dirty.values()], processedKeys, now);

  return result;
}

export type { QueueMessage };
