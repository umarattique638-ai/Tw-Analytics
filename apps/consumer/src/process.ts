import type { QueueMessage } from '@tailwatch/contract';
import { archiveBatch } from './pipeline/archive';
import { splitBatch } from './pipeline/classify';
import { planGroups, sortEvents } from './pipeline/groups';
import { emptyResult } from './pipeline/ports';
import type { BatchResult, InboundMessage, Options, Ports } from './pipeline/ports';
import { recordDrops, recordEvents } from './pipeline/sessionise';
import { loadState } from './pipeline/state';
import { BatchWork } from './pipeline/work';
import { writeBatch } from './pipeline/write';

export type {
  ArchivePort,
  BatchResult,
  ClickHousePort,
  ClickHouseTable,
  InboundMessage,
  Options,
  Ports,
  StateLoad,
  StatePort,
  StateSnapshot,
  StateUpdate,
} from './pipeline/ports';
export type { QueueMessage };

/**
 * Consumer batch processing, in the exact order of PLAN 3.1 step 3 (one file per step in pipeline/):
 *
 *   (a) R2 archive of the untransformed batch      <- FIRST, before anything else        archive.ts
 *   (b) classify + enrich in memory; drops are recorded WITH A REASON, never discarded.   classify.ts
 *       Stage 7: the precision pass (bots.yml, headless scoring, referrer spam, src/precision) runs per
 *       event after the de-dup check, and a flagged visitor stays quarantined for the session window.
 *   (c) load session state and de-dup markers (Durable Object, STAGE-1 D4), drop duplicates (D5)
 *                                                                                         state.ts, sessionise.ts
 *   (d) ClickHouse INSERT INTO events          (one batch, explicit dedup token)          write.ts
 *   (e) ClickHouse INSERT INTO sessions        (cancel + new row, VersionedCollapsingMergeTree)
 *       ClickHouse INSERT INTO dropped_hits    (the customer's warnings feed)
 *   (f) rollups: materialized views in ClickHouse, no code here
 *   (g) commit session state + de-dup markers together, LAST                              write.ts
 *
 * Every external system is a port (pipeline/ports.ts), so the pipeline has no Cloudflare or ClickHouse
 * types in it and is tested with fakes (the same lock-in rule as the collector).
 *
 * Idempotency:
 *   - The state is committed last. If anything fails before that, a retry recomputes the same rows.
 *   - Insert groups (2026-10-09 review, pipeline/groups.ts): before inserting, every event's de-dup key is
 *     written to the state store with the insert group it goes out in (an "intent"). A retry finds that
 *     group and re-inserts the event under the SAME token, so ClickHouse drops the block even when the
 *     queue redelivers the message mixed with other, newer messages (which used to change the token and
 *     duplicate rows). New events of the retry go out in a second insert with their own token.
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
export async function processBatch(messages: readonly InboundMessage[], ports: Ports, options: Options): Promise<BatchResult> {
  const result = emptyResult();
  if (messages.length === 0) return result;
  const now = ports.now();

  await archiveBatch(messages, ports, options, result); //   (a)
  const { events, drops } = splitBatch(messages, result); // (b)
  const snapshot = await loadState(events, drops, ports, now); // (c)
  const groups = await planGroups(messages, snapshot);
  sortEvents(events, groups);

  const work = new BatchWork(snapshot, groups, result);
  recordDrops(work, drops);
  recordEvents(work, events);
  result.dropsRecorded = work.dropsRecorded;

  await writeBatch(work, ports, now); //                     (d) (e) (g)
  return result;
}
