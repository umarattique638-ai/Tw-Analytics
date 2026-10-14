import { batchToken } from '../core/batch';
import { aggregateDrops } from './drops';
import { insertOrder } from './groups';
import type { Ports } from './ports';
import type { BatchWork } from './work';

/**
 * Steps (d) to (g). Intents first, so a failure from here on can be retried under the same tokens. Then
 * events, sessions and the itemised drops: ONE insert per table per group (normally one group; a retry
 * that also carries new messages has two), earlier groups first. Rollups (f) fire inside ClickHouse.
 * Session state and de-dup markers are committed LAST, together.
 */
export async function writeBatch(work: BatchWork, ports: Ports, now: number): Promise<void> {
  if (work.intents.length > 0 && ports.state.intend) await ports.state.intend(work.intents, now);

  const ordered = insertOrder(work.rows, work.groups.own);
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

  if (work.dirty.size > 0 || work.processedKeys.length > 0) await ports.state.commit([...work.dirty.values()], work.processedKeys, now);
}
