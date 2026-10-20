import type { ApiConfig } from '../config';
import { newSessionToken, sha256Hex } from '../lib/secrets';
import type { ControlStore } from '../repositories/control-store';
import type { UserDoc } from '../models/user.model';

/**
 * Login sessions: a random token, stored only as its SHA-256. The controller hands the token to the
 * client (httpOnly cookie, and as a Bearer token on request: http/cookies.ts).
 */
export function createSessionService(store: ControlStore, config: ApiConfig, now: () => Date) {
  return {
    /** A new session for this user, valid for `sessionDays`. */
    async start(user: UserDoc): Promise<{ token: string; expires: Date }> {
      const token = newSessionToken();
      const created = now();
      const expires = new Date(created.getTime() + config.sessionDays * 86_400_000);
      await store.createSession({ _id: sha256Hex(token), userId: user._id, createdAt: created, expiresAt: expires });
      return { token, expires };
    },

    /** This session ends (log out). */
    async end(token: string): Promise<void> {
      await store.deleteSession(sha256Hex(token));
    },
  };
}
export type SessionService = ReturnType<typeof createSessionService>;
