import { dedupeKey } from '@tailwatch/contract';
import type { DropQueueMessage, EventQueueMessage } from '@tailwatch/contract';
import type { DropItem } from './drops';
import type { BatchResult, InboundMessage } from './ports';

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
export function classify(m: InboundMessage): Classified {
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

/** An event with its de-dup key. */
export interface InboundEvent {
  id: string;
  msg: EventQueueMessage;
  key: string;
}

/** A drop (from the collector, or a poison message) keyed by its queue message id, so a redelivery is not counted twice. */
export interface InboundDrop {
  key: string;
  item: DropItem;
}

/** A batched drop from the collector stands for `hits` identical drops; anything odd counts as one. */
const hitsOf = (n: number | undefined) => (Number.isInteger(n) && n! > 0 && n! <= 1_000_000 ? n! : 1);

/** Step (b): sorts the batch into events and drops; ignored and poison messages are counted on `result`. */
export function splitBatch(messages: readonly InboundMessage[], result: BatchResult): { events: InboundEvent[]; drops: InboundDrop[] } {
  const events: InboundEvent[] = [];
  const drops: InboundDrop[] = [];
  for (const c of messages.map(classify)) {
    if (c.kind === 'event') {
      events.push({ id: c.id, msg: c.msg, key: dedupeKey(c.msg.event.siteId, c.msg.event.insertId, c.id) });
    } else if (c.kind === 'drop') {
      const m = c.msg;
      drops.push({ key: `d:${c.id}`, item: { siteId: m.siteId, at: m.at, reason: m.reason, detail: m.detail ?? '', country: m.country ?? '', asn: m.asn ?? 0, hits: hitsOf(m.hits) } });
    } else if (c.kind === 'ignored') {
      result.ignored += 1;
    } else {
      result.poison += 1;
      if (c.siteId !== undefined) drops.push({ key: `d:${c.id}`, item: { siteId: c.siteId, at: c.at, reason: 'consumer_invalid', detail: c.code, country: '', asn: 0 } });
    }
  }
  return { events, drops };
}
