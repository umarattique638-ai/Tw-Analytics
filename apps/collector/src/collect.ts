import { checkWire, parseWire } from '@tailwatch/contract';
import { allowed, edgeMeta } from './edge';
import type { Env, ExecutionContextLike } from './env';
import { queryPayload, readBody } from './http/body';
import { dropHeaders, noContent, outcomeResponse, pixelResponse, rateLimitedOutcome } from './http/responses';
import { visitorHashes } from './identity';
import { log } from './log';
import { dropMessage, enqueue, queueDrop } from './queue';
import { readSiteConfig } from './site-config';

/**
 * One hit (POST /e, or GET /e.gif when `pixel`). The steps run cheapest first; the browser is answered
 * before the hit is hashed and queued, and every accept or drop looks the same from outside.
 */
export async function collect(request: Request, env: Env, ctx: ExecutionContextLike, pixel: boolean): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip');

  // 1. Cheapest check first: per-client limiter, before the body is even read.
  if (ip && !(await allowed(env.RATE_LIMITER_IP, `ip:${ip}`))) {
    return outcomeResponse(rateLimitedOutcome(), pixel, env);
  }

  // 2. Size cap, counted on the stream (413 before parsing).
  const body = pixel ? queryPayload(request) : await readBody(request);
  if (body === null) {
    return outcomeResponse({ kind: 'reject', status: 413, reason: 'oversized', error: 'body_too_large' }, pixel, env);
  }

  // 3. Parse + shape check (400 / 413).
  const parsed = parseWire(body);
  if (!parsed.ok) return outcomeResponse(parsed.outcome, pixel, env);

  // 4. Per-site limiter, before the KV lookup so unknown-key floods cannot reach the Queue.
  if (!(await allowed(env.RATE_LIMITER, `site:${parsed.payload.s}`))) {
    return outcomeResponse(rateLimitedOutcome(), pixel, env);
  }

  // 5. Site lookup, host check, GPC, cheap bot reject (contract).
  const site = await readSiteConfig(env, parsed.payload.s);
  const receivedAt = Date.now();
  const outcome = checkWire(request.headers, parsed, edgeMeta(request, site, receivedAt));

  if (outcome.kind === 'drop') {
    // A site being set up stores nothing, not even its drops (decision 25).
    const message = site?.setup ? null : dropMessage(outcome, receivedAt);
    if (message) queueDrop(env, ctx, message);
    return outcomeResponse(outcome, pixel, env);
  }
  if (outcome.kind !== 'accept') return outcomeResponse(outcome, pixel, env);

  // 5b. Being set up (decision 25): accepted, but nothing is queued, so nothing is stored.
  if (site?.setup) return outcomeResponse(outcome, pixel, env);

  // 6. Privacy: no event is queued without a per-site secret and a client address.
  //    The raw IP lives only inside this hash computation.
  if (!site?.identitySecret || !ip) {
    const message = dropMessage(
      {
        kind: 'drop',
        status: 204,
        reason: 'identity_unavailable',
        headers: { 'x-tw-dropped': 'identity_unavailable' },
        siteId: outcome.event.siteId,
        country: outcome.event.country,
        asn: outcome.event.asn,
      },
      receivedAt,
    );
    if (message) queueDrop(env, ctx, message);
    return pixel ? pixelResponse() : noContent(dropHeaders(env, 'identity_unavailable'));
  }

  // 7. Respond now, hash + enqueue after (ctx.waitUntil).
  const secret = site.identitySecret;
  const userAgent = request.headers.get('user-agent') ?? '';
  ctx.waitUntil(
    visitorHashes(secret, outcome.event.receivedAt, ip, userAgent, String(outcome.event.siteId))
      .then((visitor) => enqueue(env, { v: 1, type: 'event', event: outcome.event, visitor }))
      .catch((error) => log('hash_failed', error)),
  );
  return outcomeResponse(outcome, pixel, env);
}
