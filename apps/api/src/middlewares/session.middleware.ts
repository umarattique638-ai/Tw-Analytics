import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { HttpError } from '../http/errors';
import type { Env } from '../http/types';
import { SESSION_COOKIE } from '../lib/constants';
import { sha256Hex } from '../lib/secrets';
import type { ControlStore } from '../repositories/control-store';

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
