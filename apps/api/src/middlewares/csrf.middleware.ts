import type { MiddlewareHandler } from 'hono';
import { HttpError } from '../http/errors';
import type { Env } from '../http/types';

/**
 * CSRF: a cookie-authenticated write must be a same-origin JSON request. Browsers cannot send a
 * cross-site application/json body without a preflight we never answer, and Origin must match.
 * Every answer is `no-store`: it is per user.
 */
export const csrfGuard: MiddlewareHandler<Env> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !c.req.header('authorization')) {
    if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) {
      throw new HttpError(400, 'json_required', 'Send a JSON body (Content-Type: application/json).');
    }
    const origin = c.req.header('origin');
    if (origin && origin !== 'null') {
      let host = '';
      try {
        host = new URL(origin).host;
      } catch {
        // fall through: mismatch
      }
      if (host !== c.req.header('host')) throw new HttpError(403, 'bad_origin', 'Cross-site request refused.');
    }
  }
  c.header('cache-control', 'no-store');
  await next();
};
