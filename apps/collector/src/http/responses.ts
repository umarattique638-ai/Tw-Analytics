import type { Outcome } from '@tailwatch/contract';
import type { Env } from '../env';

/** A 1x1 transparent GIF (the <img> / noscript fallback, GET /e.gif). */
const PIXEL = new Uint8Array([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255,
  255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2,
  2, 68, 1, 0, 59,
]);

/** Any site may send hits; nothing is cached. */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'no-store',
};

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
export const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';
const RETRY_AFTER_SECONDS = '10';

export function response(status: number, body: BodyInit | null = null, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...CORS_HEADERS, ...headers } });
}

export const noContent = (headers: Record<string, string> = {}) => response(204, null, headers);

export function pixelResponse(): Response {
  return response(200, PIXEL, {
    'content-type': 'image/gif',
    'content-length': String(PIXEL.byteLength),
  });
}

/** The drop-reason header, only where the deployment opted in (STAGE-1 D2). */
export function dropHeaders(env: Env, reason: string): Record<string, string> {
  return env.EXPOSE_DROP_REASON === 'true' ? { 'x-tw-dropped': reason } : {};
}

/** The answer for a hit: the same for an accept and every drop (invariant 8), errors only for bad input. */
export function outcomeResponse(outcome: Outcome, pixel: boolean, env: Env): Response {
  switch (outcome.kind) {
    case 'accept':
      return pixel ? pixelResponse() : noContent();
    case 'duplicate':
      return pixel ? pixelResponse() : noContent();
    case 'drop':
      // Identical to an accept for the caller (invariant 8). The reason reaches the customer
      // through the queued drop message and dropped_hits, not through the response.
      return pixel ? pixelResponse() : noContent(dropHeaders(env, outcome.reason));
    case 'reject':
      return response(outcome.status, outcome.error, { 'content-type': TEXT_CONTENT_TYPE });
    case 'rate_limit':
      return response(429, outcome.error, {
        'content-type': TEXT_CONTENT_TYPE,
        'retry-after': outcome.headers['Retry-After'],
      });
    case 'quota_limited':
      return response(200, JSON.stringify({ quota_limited: outcome.quotaLimited }), {
        'content-type': JSON_CONTENT_TYPE,
      });
  }
}

export const rateLimitedOutcome = (): Outcome => ({
  kind: 'rate_limit',
  status: 429,
  reason: 'rate_limited',
  error: 'rate_limited',
  headers: { 'Retry-After': RETRY_AFTER_SECONDS },
});
