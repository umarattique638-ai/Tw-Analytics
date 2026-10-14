import { setCookie } from 'hono/cookie';
import type { ApiConfig } from '../config';
import { SESSION_COOKIE } from '../constants';
import type { Ctx } from '../http/types';
import { newSessionToken, sha256Hex } from '../secrets';
import type { ControlStore, UserDoc } from '../store/types';

/** Signing in: a random token, stored only as its SHA-256, sent as an httpOnly cookie (and as a Bearer token on request). */
export function createSessionService(store: ControlStore, config: ApiConfig, now: () => Date) {
  return {
    async start(c: Ctx, user: UserDoc, wantToken: boolean) {
      const token = newSessionToken();
      const created = now();
      const expires = new Date(created.getTime() + config.sessionDays * 86_400_000);
      await store.createSession({ _id: sha256Hex(token), userId: user._id, createdAt: created, expiresAt: expires });
      setCookie(c, SESSION_COOKIE, token, {
        httpOnly: true,
        secure: config.secureCookies,
        sameSite: 'Lax',
        path: '/',
        expires,
      });
      return wantToken ? { token, expiresAt: expires.toISOString() } : {};
    },
  };
}
export type SessionService = ReturnType<typeof createSessionService>;
