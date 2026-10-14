/**
 * Cloudflare Queue consumer entry point (PLAN 3.1 step 3).
 *
 *   process.ts     processBatch: the pipeline, one step per file in pipeline/
 *   worker/        Cloudflare wiring: settings and ports (env.ts), the queue / dead-letter / cron
 *                  handlers (handlers.ts), retry delays and loggable error reasons (errors.ts)
 *   adapters/      ClickHouse and R2
 *   state/         sessions + de-dup markers in a Durable Object
 *   core/          row building and enrichment
 *   precision/     bot lists, headless scoring, referrer spam (Stage 7)
 *   dlq.ts         dead letters: archive to R2, replay hourly
 */
import type { Env, QueueBatchLike } from './worker/env';
import { handleDeadLetters, handleQueue, handleScheduled } from './worker/handlers';

/** The Durable Object class must be exported from the Worker's main module (wrangler.toml). */
export { SessionStateObject } from './state/object';
export type { Env, Overrides } from './worker/env';
export { handleDeadLetters, handleQueue, handleScheduled } from './worker/handlers';
export { retryDelaySeconds } from './worker/errors';

export default {
  async queue(batch: QueueBatchLike, env: Env): Promise<void> {
    if (batch.queue && batch.queue === (env.DLQ_NAME ?? 'tailwatch-events-dlq')) return handleDeadLetters(batch, env);
    await handleQueue(batch, env);
  },

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await handleScheduled(env);
  },
};
