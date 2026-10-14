import type { DropOutcome, DropQueueMessage, QueueMessage } from '@tailwatch/contract';
import type { Env, ExecutionContextLike } from './env';
import { log } from './log';

/** One retry, then give up loudly. The browser has already been answered. */
export async function enqueue(env: Env, message: QueueMessage): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await env.EVENTS.send(message);
      return;
    } catch (error) {
      if (attempt === 1) log('queue_send_failed', error);
    }
  }
}

/** Drops being collected in this isolate, waiting for their single queue message. */
const pendingDrops = new Map<string, DropQueueMessage>();
const PENDING_DROPS_MAX = 500;

/**
 * Queues a drop message, or, with DROP_BATCH_MS, adds it to an identical one already waiting in this
 * isolate. The first drop of a kind sends the batched message after the window (ctx.waitUntil keeps the
 * invocation alive; the Free plan allows 30 s). Counts are kept, so nothing disappears from the feed.
 */
export function queueDrop(env: Env, ctx: ExecutionContextLike, message: QueueMessage): void {
  const windowMs = Number(env.DROP_BATCH_MS ?? 0);
  if (message.type !== 'drop' || !(windowMs > 0 && windowMs <= 25_000)) {
    ctx.waitUntil(enqueue(env, message));
    return;
  }
  const key = [message.siteId, message.reason, message.detail ?? '', message.country ?? '', message.asn ?? 0].join('|');
  const waiting = pendingDrops.get(key);
  if (waiting) {
    waiting.hits = (waiting.hits ?? 1) + 1;
    return;
  }
  if (pendingDrops.size >= PENDING_DROPS_MAX) {
    ctx.waitUntil(enqueue(env, message));
    return;
  }
  pendingDrops.set(key, { ...message, hits: 1 });
  ctx.waitUntil(
    new Promise((resolve) => setTimeout(resolve, windowMs)).then(() => {
      const batched = pendingDrops.get(key);
      pendingDrops.delete(key);
      return batched ? enqueue(env, batched) : undefined;
    }),
  );
}

/** The queue message for a drop; null for an unknown site (nothing to attribute it to). */
export function dropMessage(outcome: DropOutcome, at: number): QueueMessage | null {
  // not_found has no siteId on purpose: nothing to attribute it to.
  if (!outcome.siteId) return null;
  return {
    v: 1,
    type: 'drop',
    at,
    siteId: outcome.siteId,
    reason: outcome.reason,
    detail: outcome.detail,
    country: outcome.country,
    asn: outcome.asn,
  };
}
