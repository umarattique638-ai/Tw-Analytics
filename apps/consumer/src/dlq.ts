import { batchToken } from './core/batch';

/**
 * Dead letters (PLAN 9.3 A "dead-letter queue + replay tooling").
 *
 * A batch that still fails after max_retries lands on the dead-letter queue. On the Free plan a queue keeps
 * messages only 24 hours, so the consumer also listens to the DLQ and moves every dead letter into R2
 * (dlq/...), where it waits as long as needed. A cron trigger (wrangler.toml, every 15 minutes) then sends them back
 * into the main queue, a few files at a time. Each message carries how often it was replayed; after
 * MAX_REPLAYS it is parked in dlq-dead/ for a person to look at instead of looping forever.
 *
 * Replaying is safe: events are de-duplicated by their insert id (7 days) and an event that was being
 * inserted when it failed keeps its insert group (state intents), so nothing is counted twice.
 */

export const MAX_REPLAYS = 6;
/** Files per cron run: each costs about 3 subrequests (get, send, delete) and the Free plan allows 50. */
export const REPLAY_FILES_PER_RUN = 12;

export interface DeadLetterBucket {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  list(options: { prefix: string; limit: number }): Promise<{ objects: { key: string }[] }>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(key: string): Promise<void>;
}

export interface ReplayProducer {
  sendBatch(messages: { body: unknown }[]): Promise<void>;
}

interface Letter {
  id: string;
  timestamp: number;
  body: unknown;
}

const replaysOf = (body: unknown): number => {
  const n = typeof body === 'object' && body !== null ? (body as { replays?: unknown }).replays : undefined;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
};

/** DLQ batch -> R2. Returns how many were parked for good. Throws only if R2 fails (then the DLQ retries). */
export async function archiveDeadLetters(letters: readonly Letter[], bucket: DeadLetterBucket, now: number): Promise<{ stored: number; parked: number }> {
  if (letters.length === 0) return { stored: 0, parked: 0 };
  const day = new Date(now).toISOString().slice(0, 10);
  const token = await batchToken(letters.map((l) => l.id), 'dlq');
  const replayable = letters.filter((l) => replaysOf(l.body) < MAX_REPLAYS);
  const parked = letters.filter((l) => replaysOf(l.body) >= MAX_REPLAYS);
  const ndjson = (list: readonly Letter[]) => list.map((l) => JSON.stringify(l)).join('\n') + '\n';
  const meta = { httpMetadata: { contentType: 'application/x-ndjson' } };
  if (replayable.length) await bucket.put(`dlq/${day}/${token}.ndjson`, ndjson(replayable), meta);
  if (parked.length) await bucket.put(`dlq-dead/${day}/${token}.ndjson`, ndjson(parked), meta);
  return { stored: replayable.length, parked: parked.length };
}

/** Cron: R2 dlq/ -> main queue, with replays + 1. A file is deleted only after all its messages were sent. */
export async function replayDeadLetters(bucket: DeadLetterBucket, producer: ReplayProducer, limit = REPLAY_FILES_PER_RUN): Promise<{ files: number; messages: number }> {
  const { objects } = await bucket.list({ prefix: 'dlq/', limit });
  let messages = 0;
  for (const { key } of objects) {
    const object = await bucket.get(key);
    if (!object) continue;
    const letters = (await object.text())
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Letter;
        } catch {
          return null;
        }
      })
      .filter((l): l is Letter => l !== null && typeof l.body === 'object' && l.body !== null);
    // sendBatch takes at most 100 messages.
    for (let i = 0; i < letters.length; i += 100) {
      await producer.sendBatch(letters.slice(i, i + 100).map((l) => ({ body: { ...(l.body as object), replays: replaysOf(l.body) + 1 } })));
    }
    await bucket.delete(key);
    messages += letters.length;
  }
  return { files: objects.length, messages };
}
