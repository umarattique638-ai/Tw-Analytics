import { deleteCookie } from 'hono/cookie';
import { ObjectId } from 'mongodb';
import { signupAllowed } from '../config';
import { RESET_MINUTES, SESSION_COOKIE } from '../constants';
import { HttpError, errorText, logError } from '../http/errors';
import { EMAIL_RE, body, clientIp, str } from '../http/request';
import type { Api, Ctx } from '../http/types';
import { resetPasswordMail } from '../mail';
import { PASSWORD_MAX, PASSWORD_MIN, decoyHash, hashPassword, verifyPassword } from '../passwords';
import { newSessionToken, sha256Hex } from '../secrets';
import type { Services } from '../services';
import { DuplicateError } from '../store/types';
import type { TenantDoc, UserDoc } from '../store/types';
import { userView } from '../views';

const invalidPassword = () => new HttpError(400, 'invalid_password', `Use at least ${PASSWORD_MIN} characters.`);
const validPassword = (p: string) => p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;
const validEmail = (e: string) => EMAIL_RE.test(e) && e.length <= 320;

/** Sign up, log in, forgot / reset password (public), and log out (signed in). */
export function authRoutes(app: Api, s: Services) {
  const { store, config, limits, mailer, session, audit, now } = s;

  app.post('/auth/signup', async (c) => {
    const b = await body(c);
    const name = str(b.name).trim();
    const email = str(b.email).trim();
    const password = str(b.password);
    if (!name || name.length > 120) throw new HttpError(400, 'invalid_name', 'Enter your name (up to 120 characters).');
    if (!validEmail(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid e-mail address.');
    if (!validPassword(password)) throw invalidPassword();
    if (!signupAllowed(config.signupAllowlist, email)) {
      throw new HttpError(403, 'signup_closed', 'Sign-up on this server is by invitation only. Ask the owner to add your e-mail.');
    }
    if (!limits.signup.take(`ip:${clientIp(c)}`, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'Too many sign-ups from here. Try again later.');
    }
    const at = now();
    const user: UserDoc = {
      _id: new ObjectId(),
      email,
      emailNormalized: email.toLowerCase(),
      name,
      passwordHash: await hashPassword(password, config.scrypt),
      createdAt: at,
      updatedAt: at,
      status: 'active',
    };
    const tenant: TenantDoc = { _id: new ObjectId(), createdAt: at, updatedAt: at, status: 'active', plan: 'free', region: config.region };
    try {
      await store.createAccount({ user, tenant, membership: { _id: new ObjectId(), tenantId: tenant._id, userId: user._id, role: 'owner', createdAt: at } });
    } catch (error) {
      if (error instanceof DuplicateError && error.field === 'email') {
        throw new HttpError(409, 'email_taken', 'An account with this e-mail already exists. Log in instead.');
      }
      throw error;
    }
    const extra = await session.start(c as Ctx, user, b.token === true);
    await audit.write(tenant._id, user, 'account.created', null, `Created the account (${user.email})`);
    return c.json({ user: userView(user), ...extra }, 201);
  });

  app.post('/auth/login', async (c) => {
    const b = await body(c);
    const email = str(b.email).trim().toLowerCase();
    const password = str(b.password);
    if (!limits.login.take(`email:${email}`, Date.now()) || !limits.loginIp.take(`ip:${clientIp(c)}`, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
    }
    const user = email ? await store.userByEmail(email) : null;
    // Same work and the same answer whether the e-mail exists or not: no account oracle.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await decoyHash(config.scrypt)));
    if (!user || !ok || user.status !== 'active') {
      // A wrong password for a real account is shown in that account's activity log (someone tried).
      if (user && user.status === 'active') await audit.forUser(user, 'auth.login_failed', 'Failed sign-in: wrong password');
      throw new HttpError(401, 'invalid_credentials', 'Wrong e-mail or password.');
    }
    const extra = await session.start(c as Ctx, user, b.token === true);
    await audit.forUser(user, 'auth.login', 'Signed in');
    return c.json({ user: userView(user), ...extra });
  });

  /**
   * Forgot password. The answer is the same whether the e-mail has an account or not (no account
   * oracle), and takes at least the same time. The link carries a random token; only its SHA-256 is
   * stored, it works once, for RESET_MINUTES.
   */
  app.post('/auth/forgot', async (c) => {
    const started = Date.now();
    const b = await body(c);
    const email = str(b.email).trim();
    if (!validEmail(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid e-mail address.');
    if (!mailer.configured) {
      throw new HttpError(503, 'reset_unavailable', 'Password reset by e-mail is not set up on this server yet. Ask the owner to set TW_BREVO_API_KEY and TW_MAIL_FROM.');
    }
    const key = email.toLowerCase();
    if (!limits.forgot.take(`email:${key}`, Date.now()) || !limits.forgotIp.take(`ip:${clientIp(c)}`, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'Too many reset requests. Wait an hour and try again.');
    }
    const user = await store.userByEmail(key);
    if (user && user.status === 'active') {
      const token = newSessionToken();
      const at = now();
      await store.createPasswordReset({ _id: sha256Hex(token), userId: user._id, createdAt: at, expiresAt: new Date(at.getTime() + RESET_MINUTES * 60_000), usedAt: null });
      const link = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
      try {
        await mailer.send(resetPasswordMail(user.email, user.name, link, RESET_MINUTES));
      } catch (error) {
        // Logged for the owner, never shown: telling the visitor would reveal that the account exists.
        logError('mail_failed', { kind: 'password_reset', message: errorText(error) });
      }
    }
    const wait = 700 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return c.json({ ok: true, minutes: RESET_MINUTES });
  });

  /** Is this reset link still good? Lets the page say "expired" before the user types a new password. */
  app.get('/auth/reset', async (c) => {
    const token = c.req.query('token') ?? '';
    const reset = token ? await store.passwordReset(sha256Hex(token), now()) : null;
    return c.json({ valid: !!reset });
  });

  /** New password from a reset link: every other session ends (all devices), and this browser is signed in. */
  app.post('/auth/reset', async (c) => {
    const b = await body(c);
    const token = str(b.token);
    const password = str(b.password);
    if (!validPassword(password)) throw invalidPassword();
    const expired = () => new HttpError(400, 'reset_invalid', 'This reset link has expired or was already used. Ask for a new one.');
    if (!token) throw expired();
    const at = now();
    const reset = await store.usePasswordReset(sha256Hex(token), at);
    const user = reset && (await store.userById(reset.userId));
    if (!reset || !user || user.status !== 'active') throw expired();
    await store.setPassword(user._id, await hashPassword(password, config.scrypt), at);
    await store.deleteSessionsOf(user._id);
    await store.deletePasswordResetsOf(user._id);
    // `token` in this body is the reset token, so a client that wants a Bearer token asks with `session: true`.
    const extra = await session.start(c as Ctx, user, b.session === true);
    await audit.forUser(user, 'auth.password_reset', 'Changed the password with an e-mailed reset link (signed out on every device)');
    return c.json({ user: userView(user), ...extra });
  });
}

/** Log out: registered after the session middleware (signed-in routes). */
export function logoutRoute(app: Api, { store, config, audit }: Services) {
  app.post('/auth/logout', async (c) => {
    await store.deleteSession(sha256Hex(c.get('token')));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies });
    await audit.record(c, 'auth.logout', null, 'Signed out');
    return c.json({ ok: true });
  });
}
