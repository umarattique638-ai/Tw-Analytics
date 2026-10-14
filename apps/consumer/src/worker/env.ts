import { createClickHousePort } from '../adapters/clickhouse';
import type { R2BucketLike } from '../adapters/r2-archive';
import type { ReplayProducer } from '../dlq';
import type { ArchivePort, ClickHousePort, StatePort } from '../pipeline/ports';
import { createDurableState } from '../state/port';
import type { DurableNamespaceLike } from '../state/port';

/**
 * What Cloudflare passes in. The types are small structural copies, so this also typechecks in the Node
 * test project (same trick as the collector's Env).
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

export interface QueueMessageLike {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: unknown;
  readonly attempts: number;
}

export interface QueueBatchLike {
  /** Which queue the batch came from (the main queue or its dead-letter queue). */
  readonly queue?: string;
  readonly messages: readonly QueueMessageLike[];
  retryAll(options?: { delaySeconds?: number }): void;
}

/** Tests replace the real ports with fakes. */
export interface Overrides {
  clickhouse?: ClickHousePort;
  state?: StatePort;
  archive?: ArchivePort;
  now?: () => number;
}

/** The ClickHouse port from the settings; missing settings fail the batch (and it is retried). */
export function clickhouseFromEnv(env: Env): ClickHousePort {
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

/** The Durable Object state store. */
export function stateFromEnv(env: Env): StatePort {
  // No silent in-memory fallback: per-isolate memory would split sessions and forget de-dup markers.
  if (!env.SESSIONS) throw new Error('state_not_configured');
  const shards = Number(env.SESSION_SHARDS ?? '8');
  return createDurableState(env.SESSIONS, { shards: Number.isInteger(shards) && shards > 0 ? shards : 8 });
}
