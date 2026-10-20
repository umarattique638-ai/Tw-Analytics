import { VERIFY_EMAIL_HOURS } from '../lib/constants';
import { clearSessionCookie, setSessionCookie } from '../http/cookies';
import { actorOf, body, clientIp, str } from '../http/request';
import type { Ctx } from '../http/types';
import type { Services } from '../services';
import type { Started } from '../services/auth.service';
import { credentialsInput, forgotInput, resetInput, signupInput } from '../validators/auth.validator';
import { userView } from '../views/json';

/** Sign up, confirm the e-mail, log in, forgot / reset password (public), and log out (signed in). */
export function createAuthController({ auth, config }: Services) {
  /** The new session goes to the client as a cookie, and as a Bearer token when asked for. */
  const handOver = (c: Ctx, started: Started, wantToken: boolean) => {
    setSessionCookie(c, started.token, started.expires, config.secureCookies);
    return wantToken ? { token: started.token, expiresAt: started.expires.toISOString() } : {};
  };

  return {
    async signup(c: Ctx) {
      const input = signupInput(await body(c));
      const out = await auth.signup(input, clientIp(c));
      // No session yet: the account can log in once the e-mailed link is opened.
      if ('verify' in out) {
        return c.json({ user: userView(out.user), verificationRequired: true, email: out.user.email, sent: out.verify.sent, hours: VERIFY_EMAIL_HOURS }, 201);
      }
      return c.json({ user: userView(out.user), ...handOver(c, out.session, input.wantToken) }, 201);
    },

    async login(c: Ctx) {
      const b = await body(c);
      const { user, session } = await auth.login(credentialsInput(b), clientIp(c));
      return c.json({ user: userView(user), ...handOver(c, session, b.token === true) });
    },

    async verifyEmail(c: Ctx) {
      const { email } = await auth.verifyEmail(str((await body(c)).token));
      return c.json({ ok: true, email });
    },

    async resendVerification(c: Ctx) {
      const out = await auth.resendVerification(credentialsInput(await body(c)), clientIp(c));
      return c.json({ ok: true, ...out });
    },

    async forgot(c: Ctx) {
      const { email } = forgotInput(await body(c));
      return c.json({ ok: true, ...(await auth.forgot(email, clientIp(c))) });
    },

    async resetValid(c: Ctx) {
      return c.json({ valid: await auth.resetValid(c.req.query('token') ?? '') });
    },

    async reset(c: Ctx) {
      const input = resetInput(await body(c));
      const { user, session } = await auth.resetPassword(input);
      return c.json({ user: userView(user), ...handOver(c, session, input.wantToken) });
    },

    async logout(c: Ctx) {
      await auth.logout(actorOf(c), c.get('token'));
      clearSessionCookie(c, config.secureCookies);
      return c.json({ ok: true });
    },
  };
}
export type AuthController = ReturnType<typeof createAuthController>;
