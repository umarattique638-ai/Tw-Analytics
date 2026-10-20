import { deleteCookie, setCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '../lib/constants';
import type { Ctx } from './types';

/** The session token as an httpOnly cookie (clients without cookies get it as a Bearer token instead). */
export function setSessionCookie(c: Ctx, token: string, expires: Date, secure: boolean) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    expires,
  });
}

/** Signed out (or the account is gone): the browser forgets the session cookie. */
export function clearSessionCookie(c: Ctx, secure: boolean) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure });
}
