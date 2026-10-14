/**
 * TailWatch collector (Cloudflare Worker): receives hits from tw.js, checks them against the contract,
 * answers at once, and queues events and drops for the consumer.
 *
 *   router.ts       which path does what
 *   collect.ts      one hit, step by step (limits, size, parse, site, checks, privacy, queue)
 *   http/           reading the body, building responses
 *   site-config.ts  the site of a public key (Cloudflare KV)
 *   edge.ts         Cloudflare request data and rate limiters
 *   identity.ts     daily visitor hashes (the IP never leaves this step)
 *   queue.ts        sending events and (batched) drops to the queue
 */
import type { Env, ExecutionContextLike } from './env';
import { dropHeaders, noContent } from './http/responses';
import { log } from './log';
import { route } from './router';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      // Safety net: whatever goes wrong inside, the browser never sees a 5xx or our internals.
      log('unhandled', error);
      return noContent(dropHeaders(env, 'internal'));
    }
  },
} satisfies ExportedHandler<Env>;
