import type { ErrorHandler, MiddlewareHandler, NotFoundHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '../lib/constants';
import { sha256Hex } from '../lib/secrets';
import type { ControlStore } from '../models/types';
import { HttpError, logError } from './errors';
import { sameSecret } from './request';
import type { Env } from './types';

/** HttpError -> its JSON; anything else is logged and answered with a generic 500. */
export const onError: ErrorHandler<Env> = (err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
  logError('api_error', { name: err.name, message: err.message });
  return c.json({ error: 'internal', message: 'Something went wrong on our side. Try again.' }, 500);
};

export const notFound: NotFoundHandler<Env> = (c) => c.json({ error: 'not_found', message: 'No such endpoint.' }, 404);

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

/** Signed-in routes: the session (cookie or Bearer token) -> user and workspace on the context. */
export function requireSession(store: ControlStore): MiddlewareHandler<Env> {
  return async (c, next) => {
    const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
    const token = bearer ?? getCookie(c, SESSION_COOKIE);
    if (!token) throw new HttpError(401, 'unauthorized', 'Log in first.');
    const session = await store.sessionById(sha256Hex(token));
    const user = session && (await store.userById(session.userId));
    if (!user || user.status !== 'active') throw new HttpError(401, 'unauthorized', 'Your session has ended. Log in again.');
    const [membership] = await store.membershipsOf(user._id);
    const tenant = membership && (await store.tenantById(membership.tenantId));
    if (!tenant || tenant.status !== 'active') throw new HttpError(403, 'no_tenant', 'This account has no active workspace.');
    c.set('user', user);
    c.set('tenant', tenant);
    c.set('token', token);
    await next();
  };
}

/** Scheduled jobs: only with `Authorization: Bearer <CRON_SECRET>`; otherwise the route does not exist. */
export function requireCron(cronSecret: string | null | undefined): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!cronSecret || !sameSecret(c.req.header('authorization') ?? '', `Bearer ${cronSecret}`)) {
      throw new HttpError(404, 'not_found', 'No such endpoint.');
    }
    await next();
  };
}
