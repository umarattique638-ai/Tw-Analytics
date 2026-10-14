import type { InboundDrop, InboundEvent } from './classify';
import type { Ports, StateLoad, StateSnapshot } from './ports';

/**
 * Step (c): one state load for the whole batch (sessions of the visitors, de-dup markers of the messages).
 * Store errors are NOT caught: they retry the batch.
 */
export async function loadState(events: readonly InboundEvent[], drops: readonly InboundDrop[], ports: Ports, now: number): Promise<StateSnapshot> {
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
  for (const d of drops) loadFor(d.item.siteId).dedupeKeys.push(d.key);
  return loads.size > 0 ? ports.state.load([...loads.values()], now) : { sessions: new Map(), seen: new Set<string>() };
}
