import { describe, expect, it } from 'vitest';
import type { DropQueueMessage, EventQueueMessage, ValidatedEvent } from '@tailwatch/contract';
import { processBatch } from '../src/process';
import type { ClickHouseTable, InboundMessage, Ports } from '../src/process';
import { createMemoryState } from '../src/state/memory';
import type { SessionRecord } from '../src/core/rows';

const T = Date.UTC(2026, 9, 1, 12, 0, 0);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function ev(over: Partial<ValidatedEvent> = {}, visitor = { hash: 'V1', prevHash: 'V0' }, id = 'm1'): InboundMessage {
  const event: ValidatedEvent = {
    siteId: 7, name: 'pageview', url: 'https://example.com/a', host: 'example.com', path: '/a', seq: 1,
    createdAt: T, occurredAt: T, receivedAt: T + 20, backfill: false, trackerVersion: 1, flags: 0, props: {}, warnings: [], extra: {}, userAgent: UA, country: 'IN', ...over,
  };
  const body: EventQueueMessage = { v: 1, type: 'event', event, visitor };
  return { id, timestamp: T + 30, body };
}
const drop = (over: Partial<DropQueueMessage> = {}, id = 'd1'): InboundMessage => ({ id, timestamp: T, body: { v: 1, type: 'drop', at: T, siteId: 7, reason: 'bot', country: 'IN', asn: 16509, ...over } });

function harness(opts: { archiveFails?: boolean; chFailsOnce?: boolean; commitFailsOnce?: boolean; loadFails?: boolean; noArchive?: boolean } = {}) {
  const calls: string[] = [];
  const inserts: { table: ClickHouseTable; rows: any[]; token: string }[] = [];
  const archived: { key: string; body: string }[] = [];
  const memory = createMemoryState();
  let chFailed = false;
  let commitFailed = false;
  const ports: Ports = {
    clickhouse: {
      async insert(table, rows, token) {
        calls.push(`ch:${table}`);
        if (opts.chFailsOnce && !chFailed) { chFailed = true; throw new Error('ch down'); }
        inserts.push({ table, rows: [...rows], token });
      },
    },
    state: {
      async load(requests, now) {
        calls.push('state:load');
        if (opts.loadFails) throw new Error('state down');
        return memory.load(requests, now);
      },
      async commit(updates, marks, now) {
        calls.push('state:commit');
        if (opts.commitFailsOnce && !commitFailed) { commitFailed = true; throw new Error('commit down'); }
        return memory.commit(updates, marks, now);
      },
    },
    ...(opts.noArchive ? {} : {
      archive: { async put(key: string, body: string) { calls.push('archive'); if (opts.archiveFails) throw new Error('r2 down'); archived.push({ key, body }); } },
    }),
    now: () => T,
    log: () => undefined,
  };
  const stored = async (site: number, visitor: string): Promise<SessionRecord | undefined> =>
    (await memory.load([{ siteId: site, visitors: [visitor], dedupeKeys: [] }], T)).sessions.get(`${site}:${visitor}`);
  return { ports, calls, inserts, archived, memory, stored };
}
const OPT = { requireArchive: true };
const rowsOf = (h: ReturnType<typeof harness>, t: ClickHouseTable) => h.inserts.filter((i) => i.table === t).flatMap((i) => i.rows);

describe('PLAN 3.1 order (a)-(g)', () => {
  it('archives first, loads state, inserts events then sessions, and commits state last', async () => {
    const h = harness();
    await processBatch([ev()], h.ports, OPT);
    expect(h.calls).toEqual(['archive', 'state:load', 'ch:events', 'ch:sessions', 'state:commit']);
  });

  it('archives the untransformed batch under raw/{date}/{hour}/{batch token}.ndjson', async () => {
    const h = harness();
    const m = [ev(), ev({ seq: 2 }, undefined, 'm2')];
    const r = await processBatch(m, h.ports, OPT);
    expect(r.archiveKey).toMatch(/^raw\/2026-10-01\/12\/[0-9a-f]{64}\.ndjson$/);
    const lines = h.archived[0]!.body.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].body).toEqual(m[0]!.body);
  });

  it('a redelivered batch writes the SAME archive key (overwrite, not a second copy)', async () => {
    const a = harness();
    const b = harness();
    const m = [ev(), ev({ seq: 2 }, undefined, 'm2')];
    await processBatch(m, a.ports, OPT);
    await processBatch([...m].reverse(), b.ports, OPT);
    expect(a.archived[0]!.key).toBe(b.archived[0]!.key);
  });

  it('if the archive fails, nothing else happens and the batch is retried', async () => {
    const h = harness({ archiveFails: true });
    await expect(processBatch([ev()], h.ports, OPT)).rejects.toThrow('r2 down');
    expect(h.calls).toEqual(['archive']);
    expect(h.memory.size()).toEqual({ sessions: 0, dedupe: 0 });
  });

  it('refuses to run without an archive in production mode, runs without one only when explicitly allowed', async () => {
    await expect(processBatch([ev()], harness({ noArchive: true }).ports, OPT)).rejects.toThrow('archive_required_but_missing');
    const h = harness({ noArchive: true });
    const r = await processBatch([ev()], h.ports, { requireArchive: false });
    expect(r.archiveKey).toBeNull();
    expect(r.events).toBe(1);
  });
});

describe('batching and idempotency', () => {
  it('many events become ONE insert per table and ONE state load + commit, never row by row', async () => {
    const h = harness();
    const msgs = Array.from({ length: 50 }, (_, i) => ev({ seq: i + 1, occurredAt: T + i * 1000 }, { hash: `V${i}`, prevHash: `P${i}` }, `m${i}`));
    await processBatch(msgs, h.ports, OPT);
    expect(h.inserts.filter((i) => i.table === 'events')).toHaveLength(1);
    expect(h.inserts.filter((i) => i.table === 'sessions')).toHaveLength(1);
    expect(h.calls.filter((c) => c.startsWith('state:'))).toEqual(['state:load', 'state:commit']);
    expect(rowsOf(h, 'events')).toHaveLength(50);
  });

  it('uses an explicit deterministic dedup token per table, equal on redelivery, different per table', async () => {
    const a = harness(); const b = harness();
    const msgs = [ev(), ev({ seq: 2, occurredAt: T + 1000 }, undefined, 'm2')];
    await processBatch(msgs, a.ports, OPT);
    await processBatch([...msgs].reverse(), b.ports, OPT);
    const tok = (h: typeof a, t: ClickHouseTable) => h.inserts.find((i) => i.table === t)!.token;
    expect(tok(a, 'events')).toBe(tok(b, 'events'));
    expect(tok(a, 'events')).not.toBe(tok(a, 'sessions'));
    expect(tok(a, 'events')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a ClickHouse failure leaves the state untouched and the retry produces identical rows and tokens', async () => {
    const h = harness({ chFailsOnce: true });
    const msgs = [ev(), ev({ seq: 2, occurredAt: T + 60_000 }, undefined, 'm2')];
    await expect(processBatch(msgs, h.ports, OPT)).rejects.toThrow('ch down');
    expect(h.memory.size()).toEqual({ sessions: 0, dedupe: 0 });
    await processBatch(msgs, h.ports, OPT);
    const clean = harness();
    await processBatch(msgs, clean.ports, OPT);
    expect(h.inserts).toEqual(clean.inserts);
  });

  it('a state-commit failure after the inserts: the retry re-sends identical rows with identical tokens (ClickHouse drops them)', async () => {
    const h = harness({ commitFailsOnce: true });
    const msgs = [ev(), ev({ seq: 2, occurredAt: T + 60_000 }, undefined, 'm2')];
    await expect(processBatch(msgs, h.ports, OPT)).rejects.toThrow('commit down');
    await processBatch(msgs, h.ports, OPT);
    const [first, second] = [h.inserts.slice(0, 2), h.inserts.slice(2, 4)];
    expect(second).toEqual(first); // same rows, same tokens -> ClickHouse's block de-dup keeps one copy
    expect((await h.stored(7, 'V1'))?.state.pageviews).toBe(2);
  });

  it('an empty batch does nothing', async () => {
    const h = harness();
    expect(await processBatch([], h.ports, OPT)).toMatchObject({ events: 0 });
    expect(h.calls).toEqual([]);
  });

  it('a state store outage retries the batch instead of being treated as poison', async () => {
    const h = harness({ loadFails: true });
    await expect(processBatch([ev()], h.ports, OPT)).rejects.toThrow('state down');
    expect(h.inserts).toHaveLength(0);
  });
});

describe('de-duplication (STAGE-1 D5)', () => {
  it('a redelivered message (same id) after a successful commit adds no rows and no session change', async () => {
    const h = harness();
    await processBatch([ev()], h.ports, OPT);
    h.inserts.length = 0;
    const r = await processBatch([ev()], h.ports, OPT);
    expect(r).toMatchObject({ events: 0, duplicates: 1 });
    expect(h.inserts).toHaveLength(0);
    expect((await h.stored(7, 'V1'))?.state.pageviews).toBe(1);
  });

  it('the same insert id in a DIFFERENT message (tracker retry) is dropped, across batches', async () => {
    const h = harness();
    await processBatch([ev({ insertId: 'abc' }, undefined, 'm1')], h.ports, OPT);
    const r = await processBatch([ev({ insertId: 'abc' }, undefined, 'm-retry')], h.ports, OPT);
    expect(r).toMatchObject({ events: 0, duplicates: 1 });
  });

  it('the same insert id twice inside one batch keeps only the first', async () => {
    const h = harness();
    const r = await processBatch([ev({ insertId: 'abc' }, undefined, 'm1'), ev({ insertId: 'abc' }, undefined, 'm2')], h.ports, OPT);
    expect(r).toMatchObject({ events: 1, duplicates: 1 });
    expect(rowsOf(h, 'events')).toHaveLength(1);
  });

  it('the same insert id on two different sites is two events (keys are site-scoped)', async () => {
    const h = harness();
    const r = await processBatch([ev({ insertId: 'abc', siteId: 1 }, undefined, 'm1'), ev({ insertId: 'abc', siteId: 2 }, undefined, 'm2')], h.ports, OPT);
    expect(r).toMatchObject({ events: 2, duplicates: 0 });
  });

  it('markers expire after 7 days', async () => {
    const h = harness();
    await processBatch([ev({ insertId: 'abc' })], h.ports, OPT);
    const later = { ...h.ports, now: () => T + 7 * 86_400_000 + 1 };
    const r = await processBatch([ev({ insertId: 'abc' }, undefined, 'm-late')], later, OPT);
    expect(r).toMatchObject({ events: 1, duplicates: 0 });
  });
});

describe('sessions', () => {
  it('chains several events of one visitor inside a batch, whatever order they arrive in', async () => {
    const h = harness();
    await processBatch([ev({ seq: 2, occurredAt: T + 60_000, path: '/b' }, undefined, 'm2'), ev()], h.ports, OPT);
    const sess = rowsOf(h, 'sessions');
    expect(sess.map((r) => [r.sign, r.version, r.pageviews])).toEqual([[1, 1, 1], [-1, 1, 1], [1, 2, 2]]);
    const events = rowsOf(h, 'events');
    expect(events.map((r) => r.is_session_start)).toEqual([1, 0]);
    expect(new Set(events.map((r) => r.session_id)).size).toBe(1);
    expect((await h.stored(7, 'V1'))!.state.pageviews).toBe(2);
  });

  it('continues a session from the store in a later batch (cancel old, add new)', async () => {
    const h = harness();
    await processBatch([ev()], h.ports, OPT);
    h.inserts.length = 0;
    await processBatch([ev({ seq: 2, occurredAt: T + 120_000 }, undefined, 'm2')], h.ports, OPT);
    expect(rowsOf(h, 'sessions').map((r) => [r.sign, r.version])).toEqual([[-1, 1], [1, 2]]);
  });

  it("finds a session through yesterday's hash and keeps one visitor across UTC midnight", async () => {
    const h = harness();
    const late = Date.UTC(2026, 9, 1, 23, 55);
    await processBatch([ev({ occurredAt: late, receivedAt: late }, { hash: 'DAY1', prevHash: 'DAY0' })], h.ports, OPT);
    h.inserts.length = 0;
    await processBatch([ev({ seq: 2, occurredAt: late + 600_000, receivedAt: late + 600_000 }, { hash: 'DAY2', prevHash: 'DAY1' }, 'm2')], h.ports, OPT);
    const e = rowsOf(h, 'events')[0];
    expect(e.visitor_hash).toBe('DAY1');
    expect(e.is_session_start).toBe(0);
  });

  it('two sites with the same visitor hash never share a session', async () => {
    const h = harness();
    await processBatch([ev({ siteId: 1 }), ev({ siteId: 2, seq: 2, occurredAt: T + 1000 }, undefined, 'm2')], h.ports, OPT);
    expect(rowsOf(h, 'events').map((r) => r.is_session_start)).toEqual([1, 1]);
  });
});

describe('drops are itemised, poison does not break the batch', () => {
  it('drop messages become dropped_hits rows with hits aggregated per minute', async () => {
    const h = harness();
    await processBatch([drop({}, 'd1'), drop({}, 'd2'), drop({ reason: 'gpc', asn: undefined }, 'd3')], h.ports, OPT);
    const rows = rowsOf(h, 'dropped_hits');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.reason === 'bot')).toMatchObject({ hits: 2, site_id: 7, asn: 16509, country_code: 'IN' });
    expect(rows.find((r) => r.reason === 'gpc')).toMatchObject({ hits: 1, asn: 0 });
  });

  it('a batch of only drops never touches the state store', async () => {
    const h = harness();
    await processBatch([drop()], h.ports, OPT);
    expect(h.calls).toEqual(['archive', 'ch:dropped_hits']);
  });

  it('a message with a timestamp ClickHouse cannot hold is itemised, marked seen, and the rest still lands', async () => {
    const h = harness();
    const r = await processBatch([ev({ occurredAt: 1e300 }, undefined, 'bad'), ev({ seq: 2 }, { hash: 'V2', prevHash: 'P2' }, 'good')], h.ports, OPT);
    expect(r).toMatchObject({ events: 1, poison: 1 });
    expect(rowsOf(h, 'events')).toHaveLength(1);
    expect(rowsOf(h, 'dropped_hits')[0]).toMatchObject({ reason: 'consumer_invalid', detail: 'RangeError', site_id: 7 });
    expect(h.memory.size().dedupe).toBe(2);
  });

  it('garbage bodies are counted, unknown versions are ignored, neither throws', async () => {
    const h = harness();
    const r = await processBatch([
      { id: 'a', timestamp: T, body: 'nope' },
      { id: 'b', timestamp: T, body: { v: 2, type: 'event' } },
      { id: 'c', timestamp: T, body: { v: 1, type: 'event', event: {} } },
      ev(),
    ], h.ports, OPT);
    expect(r).toMatchObject({ events: 1, poison: 2, ignored: 1 });
  });

  it('an unreadable event that still names its site is itemised for that site', async () => {
    const h = harness();
    await processBatch([{ id: 'x', timestamp: T, body: { v: 1, type: 'event', event: { siteId: 9 } } }], h.ports, OPT);
    expect(rowsOf(h, 'dropped_hits')[0]).toMatchObject({ site_id: 9, reason: 'consumer_invalid', detail: 'bad_event_shape' });
  });
});

describe('Stage 7: precision pass + session quarantine', () => {
  const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
  const HINTS = { chUa: '"Chromium";v="126", "Google Chrome";v="126"', chPlatform: '"Windows"', chMobile: '?0', lang: true, https: true };

  it('a bots.yml match is itemised in dropped_hits with the bot name, nothing reaches events or sessions', async () => {
    const h = harness();
    const r = await processBatch([ev({ userAgent: GOOGLEBOT, country: 'US', asn: 15169 })], h.ports, OPT);
    expect(r).toMatchObject({ events: 0, precisionDrops: 1, dropsRecorded: 1, sessionsStarted: 0 });
    expect(rowsOf(h, 'events')).toEqual([]);
    expect(rowsOf(h, 'sessions')).toEqual([]);
    expect(rowsOf(h, 'dropped_hits')).toEqual([
      expect.objectContaining({ site_id: 7, reason: 'bot', detail: 'bots_yml:Googlebot', country_code: 'US', asn: 15169, hits: 1 }),
    ]);
  });

  it('referrer spam is its own reason, with the listed domain', async () => {
    const h = harness();
    await processBatch([ev({ referrer: 'https://www.semalt.com/', hints: HINTS })], h.ports, OPT);
    expect(rowsOf(h, 'dropped_hits')[0]).toMatchObject({ reason: 'referrer_spam', detail: 'semalt.com' });
  });

  it('a flagged visitor stays dropped for the session window: its follow-up events never leak into counts', async () => {
    const h = harness();
    // Hit 1 carries the spam referrer; hits 2-3 (SPA navigation, engagement) carry none.
    await processBatch([ev({ referrer: 'https://semalt.com/', hints: HINTS })], h.ports, OPT);
    await processBatch(
      [ev({ seq: 2, path: '/b', occurredAt: T + 5_000, hints: HINTS }, undefined, 'm2'), ev({ seq: 3, name: 'engagement', occurredAt: T + 9_000, engagementMs: 4000, hints: HINTS }, undefined, 'm3')],
      h.ports,
      OPT,
    );
    expect(rowsOf(h, 'events')).toEqual([]);
    const drops = rowsOf(h, 'dropped_hits');
    expect(drops.reduce((n, d) => n + d.hits, 0)).toBe(3);
    expect(new Set(drops.map((d) => `${d.reason}:${d.detail}`))).toEqual(new Set(['referrer_spam:semalt.com']));
  });

  it('another visitor on the same site is not affected by the quarantine', async () => {
    const h = harness();
    await processBatch([ev({ userAgent: GOOGLEBOT })], h.ports, OPT);
    const r = await processBatch([ev({ hints: HINTS }, { hash: 'V9', prevHash: 'V8' }, 'm2')], h.ports, OPT);
    expect(r.events).toBe(1);
  });

  it('a tracker retry of a dropped hit is a duplicate, not a second drop (insert_id de-dup covers drops too)', async () => {
    const h = harness();
    await processBatch([ev({ userAgent: GOOGLEBOT, insertId: 'abc' })], h.ports, OPT);
    const r = await processBatch([ev({ userAgent: GOOGLEBOT, insertId: 'abc' }, undefined, 'm-retry')], h.ports, OPT);
    expect(r).toMatchObject({ duplicates: 1, precisionDrops: 0 });
  });

  it('a real browser (with hints) is untouched', async () => {
    const h = harness();
    const r = await processBatch([ev({ hints: HINTS, referrer: 'https://www.google.com/' })], h.ports, OPT);
    expect(r).toMatchObject({ events: 1, precisionDrops: 0, dropsRecorded: 0 });
  });
});
