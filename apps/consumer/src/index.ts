import { ClickHouseError, createClickHousePort } from './adapters/clickhouse';
import { createR2Archive } from './adapters/r2-archive';
import type { R2BucketLike } from './adapters/r2-archive';
import { archiveDeadLetters, replayDeadLetters } from './dlq';
import type { DeadLetterBucket, ReplayProducer } from './dlq';
import { processBatch } from './process';
import type { ArchivePort, ClickHousePort, InboundMessage, Options, Ports, StatePort } from './process';
import { StateStoreError, createDurableState } from './state/port';
import type { DurableNamespaceLike } from './state/port';

/** The Durable Object class must be exported from the Worker's main module (wrangler.toml). */
export { SessionStateObject } from './state/object';

/**
 * Cloudflare Queue consumer entry point (PLAN 3.1 step 3).
 *
 * The types below are small structural copies of what Cloudflare passes in, so this file also typechecks
 * in the Node test project (same trick as the collector's Env).
 *
 * Failure policy: if anything throws, the WHOLE batch is retried with a delay (Cloudflare docs: a failing
 * batch is retried as a whole, and without a dead_letter_queue repeatedly failing messages are discarded,
 * so wrangler.toml defines one). processBatch never throws on a single bad message, so a retry means a
 * real outage (ClickHouse, config, missing archive), not one poison message.
 */

export interface Env {
  CLICKHOUSE_URL?: string;
  CLICKHOUSE_USER?: string;
  /** SECRET: `wrangler secret put CLICKHOUSE_PASSWORD`. Never in wrangler.toml, never in chat. */
  CLICKHOUSE_PASSWORD?: string;
  CLICKHOUSE_DATABASE?: string;
  /** Anything other than the exact string "false" means the R2 archive is required (fail closed). */
  REQUIRE_ARCHIVE?: string;
  /** "true" switches ClickHouse inserts to async inserts. Default is sync. */
  ASYNC_INSERT?: string;
  /** R2 bucket for the raw archive (PLAN 3.1 a). */
  ARCHIVE?: R2BucketLike;
  /** Durable Object namespace of SessionStateObject: sessions + de-dup (STAGE-1 D4). */
  SESSIONS?: DurableNamespaceLike;
  /** Number of state shards (default 8). Changing it restarts open sessions, see state/port.ts. */
  SESSION_SHARDS?: string;
  /** Name of the dead-letter queue this Worker also consumes (wrangler.toml). */
  DLQ_NAME?: string;
  /** Producer binding to the main queue, used by the hourly dead-letter replay. */
  REPLAY?: ReplayProducer;
}

interface QueueMessageLike {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: unknown;
  readonly attempts: number;
}

interface QueueBatchLike {
  /** Which queue the batch came from (the main queue or its dead-letter queue). */
  readonly queue?: string;
  readonly messages: readonly QueueMessageLike[];
  retryAll(options?: { delaySeconds?: number }): void;
}

export interface Overrides {
  clickhouse?: ClickHousePort;
  state?: StatePort;
  archive?: ArchivePort;
  now?: () => number;
}

/** 15 s, 30 s, 60 s ... capped at 15 minutes. `attempts` starts at 1 on the first delivery. */
export function retryDelaySeconds(attempts: number): number {
  const n = Number.isFinite(attempts) && attempts >= 1 ? Math.floor(attempts) : 1;
  return Math.min(15 * 2 ** Math.min(n - 1, 10), 900);
}

function clickhouseFromEnv(env: Env): ClickHousePort {
  if (!env.CLICKHOUSE_URL || !env.CLICKHOUSE_USER || !env.CLICKHOUSE_PASSWORD) {
    throw new Error('consumer_not_configured');
  }
  return createClickHousePort({
    url: env.CLICKHOUSE_URL,
    user: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DATABASE,
    asyncInsert: env.ASYNC_INSERT === 'true',
  });
}

function stateFromEnv(env: Env): StatePort {
  // No silent in-memory fallback: per-isolate memory would split sessions and forget de-dup markers.
  if (!env.SESSIONS) throw new Error('state_not_configured');
  const shards = Number(env.SESSION_SHARDS ?? '8');
  return createDurableState(env.SESSIONS, { shards: Number.isInteger(shards) && shards > 0 ? shards : 8 });
}

const SAFE_MESSAGES: ReadonlySet<string> = new Set(['consumer_not_configured', 'state_not_configured', 'archive_required_but_missing']);

/** What may be logged about a failure: our own codes only, never anything that could carry request data. */
function safeReason(error: unknown): string {
  if (error instanceof StateStoreError) return error.message;
  if (error instanceof ClickHouseError) {
    return error.code === null ? error.message : `${error.message}:code_${error.code}`;
  }
  if (error instanceof Error && SAFE_MESSAGES.has(error.message)) return error.message;
  return error instanceof Error ? error.name : 'unknown';
}

export async function handleQueue(batch: QueueBatchLike, env: Env, overrides: Overrides = {}): Promise<void> {
  const attempts = batch.messages.reduce((max, m) => Math.max(max, Number.isFinite(m.attempts) ? m.attempts : 1), 1);

  try {
    const ports: Ports = {
      clickhouse: overrides.clickhouse ?? clickhouseFromEnv(env),
      state: overrides.state ?? stateFromEnv(env),
      archive: overrides.archive ?? (env.ARCHIVE ? createR2Archive(env.ARCHIVE) : undefined),
      now: overrides.now ?? Date.now,
      log: (event, fields) => console.log(JSON.stringify({ tw: event, ...fields })),
    };
    const options: Options = { requireArchive: env.REQUIRE_ARCHIVE !== 'false' };

    const inbound: InboundMessage[] = batch.messages.map((m) => ({
      id: m.id,
      timestamp: m.timestamp.getTime(),
      body: m.body,
    }));

    const result = await processBatch(inbound, ports, options);
    ports.log('consumer_batch', {
      events: result.events,
      duplicates: result.duplicates,
      drops: result.dropsRecorded,
      poison: result.poison,
      ignored: result.ignored,
      sessions_started: result.sessionsStarted,
      precision_drops: result.precisionDrops,
    });
  } catch (error) {
    const delaySeconds = retryDelaySeconds(attempts);
    console.error(JSON.stringify({ tw: 'consumer_batch_failed', reason: safeReason(error), attempts, delaySeconds }));
    batch.retryAll({ delaySeconds });
  }
}

/** Dead letters go to R2 (kept beyond the DLQ's 24 h) and are replayed by the cron below. */
export async function handleDeadLetters(batch: QueueBatchLike, env: Env, now = Date.now()): Promise<void> {
  try {
    if (!env.ARCHIVE) throw new Error('archive_required_but_missing');
    const letters = batch.messages.map((m) => ({ id: m.id, timestamp: m.timestamp.getTime(), body: m.body }));
    const r = await archiveDeadLetters(letters, env.ARCHIVE as unknown as DeadLetterBucket, now);
    console.log(JSON.stringify({ tw: 'dlq_archived', stored: r.stored, parked: r.parked }));
  } catch (error) {
    console.error(JSON.stringify({ tw: 'dlq_archive_failed', reason: safeReason(error) }));
    batch.retryAll({ delaySeconds: 300 });
  }
}

export async function handleScheduled(env: Env): Promise<void> {
  if (!env.ARCHIVE || !env.REPLAY) return;
  try {
    const r = await replayDeadLetters(env.ARCHIVE as unknown as DeadLetterBucket, env.REPLAY);
    if (r.files) console.log(JSON.stringify({ tw: 'dlq_replayed', files: r.files, messages: r.messages }));
  } catch (error) {
    console.error(JSON.stringify({ tw: 'dlq_replay_failed', reason: safeReason(error) }));
  }
}

export default {
  async queue(batch: QueueBatchLike, env: Env): Promise<void> {
    if (batch.queue && batch.queue === (env.DLQ_NAME ?? 'tailwatch-events-dlq')) return handleDeadLetters(batch, env);
    await handleQueue(batch, env);
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await handleScheduled(env);
  },
};