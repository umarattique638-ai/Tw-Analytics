import { LIMITS } from '@tailwatch/contract';
import { advanceRecord, eventRow, sessionRows } from '../core/rows';
import type { SessionRecord } from '../core/rows';
import { precisionVerdict } from '../precision';
import type { InboundDrop, InboundEvent } from './classify';
import type { BatchWork } from './work';

/** Drop messages (and poison) become dropped_hits rows, once per queue message id. */
export function recordDrops(work: BatchWork, drops: readonly InboundDrop[]): void {
  for (const { key, item } of drops) {
    if (work.isDuplicate(key)) continue;
    const group = work.groups.of(key);
    work.addDrop(group, item);
    work.done(item.siteId, key, group);
  }
}

/** Every event of the batch, in order: de-dup, precision pass, then the session it belongs to. */
export function recordEvents(work: BatchWork, events: readonly InboundEvent[]): void {
  for (const ev of events) {
    if (work.isDuplicate(ev.key)) continue;
    recordEvent(work, ev, work.groups.of(ev.key));
  }
}

function recordEvent(work: BatchWork, { msg, key }: InboundEvent, group: string): void {
  const siteId = msg.event.siteId;
  // Today's hash first, then yesterday's: a visit that crosses UTC midnight is one session.
  const prev = work.session(siteId, msg.visitor.hash) ?? work.session(siteId, msg.visitor.prevHash);

  // Stage 7 precision pass. A visitor already quarantined keeps its first verdict.
  const verdict = prev?.quarantine ?? precisionVerdict(msg.event);
  if (verdict) {
    const e = msg.event;
    work.addDrop(group, { siteId, at: e.receivedAt, reason: verdict.reason, detail: verdict.detail, country: e.country ?? '', asn: e.asn ?? 0 });
    work.done(siteId, key, group);
    work.result.precisionDrops += 1;
    if (verdict.reason === 'referrer_spam') quarantine(work, msg, prev, verdict);
    return;
  }

  try {
    // A late event (more than 30 min before the current session started) is a session of its own.
    const late = !!prev && msg.event.occurredAt < prev.state.start - LIMITS.sessionGapMs;
    const dKey = `${siteId}:${prev?.state.visitor ?? msg.visitor.hash}`;
    const adv = late ? advanceRecord(work.detached.get(dKey) ?? null, msg) : advanceRecord(prev, msg);
    // Build everything first, then push: a throw must never leave half an event behind.
    const er = eventRow(msg, { id: adv.record.state.id, started: adv.started, visitor: adv.visitor });
    const sr = sessionRows(siteId, adv.previous, adv.record);
    const rows = work.group(group);
    rows.events.push(er);
    rows.sessions.push(...sr);
    if (late) work.detached.set(dKey, adv.record);
    else work.setSession(siteId, adv.visitor, adv.record);
    work.done(siteId, key, group);
    if (adv.started) work.result.sessionsStarted += 1;
    work.result.events += 1;
  } catch (error) {
    // One unreadable event (for example a time ClickHouse cannot hold) must not take the batch down.
    // It is counted and itemised, never silently lost, and marked seen so a retry does not repeat it.
    work.result.poison += 1;
    work.done(siteId, key, group);
    work.addDrop(group, { siteId, at: msg.event.receivedAt, reason: 'consumer_invalid', detail: error instanceof Error ? error.name : 'unknown', country: '', asn: 0 });
  }
}

/**
 * Referrer spam only carries its referrer on the FIRST hit; remember the verdict for this visitor (same
 * 30 min sliding TTL as a session) so its later hits are dropped too. Bot and headless verdicts are NOT
 * remembered: they are recomputed on every hit anyway, and a visitor hash (IP + UA) can be shared by real
 * people behind one carrier/office address (Stage 7 review). The session itself is NOT advanced: nothing
 * of a dropped event reaches a count.
 */
function quarantine(work: BatchWork, msg: InboundEvent['msg'], prev: SessionRecord | null, verdict: { reason: string; detail: string }): void {
  const siteId = msg.event.siteId;
  const mark = { quarantine: { reason: verdict.reason, detail: verdict.detail } };
  let record: SessionRecord | null = null;
  let visitor = msg.visitor.hash;
  if (prev) {
    record = { ...prev, ...mark };
    visitor = prev.state.visitor;
  } else {
    try {
      record = { ...advanceRecord(null, msg).record, ...mark };
    } catch {
      record = null; // an unreadable time: the drop is still itemised, there is just no quarantine
    }
  }
  if (record) work.setSession(siteId, visitor, record);
}
