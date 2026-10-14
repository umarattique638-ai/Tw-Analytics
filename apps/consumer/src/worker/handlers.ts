import { createR2Archive } from '../adapters/r2-archive';
import { archiveDeadLetters, replayDeadLetters } from '../dlq';
import type { DeadLetterBucket } from '../dlq';
import type { InboundMessage, Options, Ports } from '../pipeline/ports';
import { processBatch } from '../process';
import { clickhouseFromEnv, stateFromEnv } from './env';
import type { Env, Overrides, QueueBatchLike } from './env';
import { retryDelaySeconds, safeReason } from './errors';

/**
 * Failure policy: if anything throws, the WHOLE batch is retried with a delay (Cloudflare docs: a failing
 * batch is retried as a whole, and without a dead_letter_queue repeatedly failing messages are discarded,
 * so wrangler.toml defines one). processBatch never throws on a single bad message, so a retry means a
 * real outage (ClickHouse, config, missing archive), not one poison message.
 */
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
