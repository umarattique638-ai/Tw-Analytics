import { ObjectId } from 'mongodb';
import { signupAllowed } from '../config';
import { RESET_MINUTES, VERIFY_EMAIL_HOURS } from '../lib/constants';
import { HttpError, errorText, logError } from '../http/errors';
import { decoyHash, hashPassword, verifyPassword } from '../lib/passwords';
import { newSessionToken, sha256Hex } from '../lib/secrets';
import { DuplicateError } from '../repositories/control-store';
import type { TenantDoc } from '../models/tenant.model';
import type { UserDoc } from '../models/user.model';
import { resetPasswordMail, verifyEmailMail } from '../views/emails';
import type { CredentialsInput, ResetInput, SignupInput } from '../validators/auth.validator';
import type { Actor, Services } from './types';

/** A session that just started (the controller hands the token to the client). */
export interface Started {
  token: string;
  expires: Date;
}

/**
 * Sign up, confirm the e-mail, log in, forgot / reset password, log out.
 *
 * E-mail verification (decision 27): a new account cannot log in until the link e-mailed at sign-up is
 * opened. It needs a working mailer; without one (or with TW_EMAIL_VERIFICATION=off) accounts are verified
 * at once, so sign-up never breaks. Accounts made before this existed have no emailVerifiedAt: verified.
 */
export function createAuthService(s: Services) {
  const { store, config, limits, mailer, session, audit, now } = s;
  const mustVerify = () => config.requireEmailVerification && mailer.configured;
  const unverified = (u: UserDoc) => u.emailVerifiedAt === null && mustVerify();

  /** A fresh link (earlier ones stop working). True when the e-mail went out. */
  const sendVerification = async (user: UserDoc): Promise<boolean> => {
    const token = newSessionToken();
    const at = now();
    await store.deleteEmailVerificationsOf(user._id);
    await store.createEmailVerification({ _id: sha256Hex(token), userId: user._id, createdAt: at, expiresAt: new Date(at.getTime() + VERIFY_EMAIL_HOURS * 3_600_000), usedAt: null });
    const link = `${config.publicUrl}/verify-email?token=${encodeURIComponent(token)}`;
    try {
      await mailer.send(verifyEmailMail(user.email, user.name, link, VERIFY_EMAIL_HOURS));
      return true;
    } catch (error) {
      logError('mail_failed', { kind: 'verify_email', message: errorText(error) });
      return false;
    }
  };

  /** Same work and the same answer whether the e-mail exists or not: no account oracle. */
  const checkCredentials = async (input: CredentialsInput) => {
    const user = input.email ? await store.userByEmail(input.email) : null;
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await decoyHash(config.scrypt)));
    return { user, ok };
  };

  return {
    /**
     * A new account and workspace. With e-mail verification on, no session yet: the account can log in once
     * the e-mailed link is opened (`sent` says whether that e-mail went out).
     */
    async signup(input: SignupInput, ip: string): Promise<{ user: UserDoc; verify: { sent: boolean } } | { user: UserDoc; session: Started }> {
      const { name, email, password } = input;
      if (!signupAllowed(config.signupAllowlist, email)) {
        throw new HttpError(403, 'signup_closed', 'Sign-up on this server is by invitation only. Ask the owner to add your e-mail.');
      }
      if (!limits.signup.take(`ip:${ip}`, Date.now())) {
        throw new HttpError(429, 'rate_limited', 'Too many sign-ups from here. Try again later.');
      }
      const at = now();
      const user: UserDoc = {
        _id: new ObjectId(),
        email,
        emailNormalized: email.toLowerCase(),
        name,
        passwordHash: await hashPassword(password, config.scrypt),
        emailVerifiedAt: mustVerify() ? null : at,
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
      await audit.write(tenant._id, user, 'account.created', null, `Created the account (${user.email})`);
      if (user.emailVerifiedAt === null) return { user, verify: { sent: await sendVerification(user) } };
      return { user, session: await session.start(user) };
    },

    /** Log in. A wrong password for a real account is shown in that account's activity log (someone tried). */
    async login(input: CredentialsInput, ip: string): Promise<{ user: UserDoc; session: Started }> {
      if (!limits.login.take(`email:${input.email}`, Date.now()) || !limits.loginIp.take(`ip:${ip}`, Date.now())) {
        throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
      }
      const { user, ok } = await checkCredentials(input);
      if (!user || !ok || user.status !== 'active') {
        if (user && user.status === 'active') await audit.forUser(user, 'auth.login_failed', 'Failed sign-in: wrong password');
        throw new HttpError(401, 'invalid_credentials', 'Wrong e-mail or password.');
      }
      // Only said after the right password, so it reveals nothing about other people's addresses.
      if (unverified(user)) {
        throw new HttpError(403, 'email_unverified', `Confirm your e-mail first: open the link we sent to ${user.email}. Nothing arrived? Use "Send it again".`);
      }
      const started = await session.start(user);
      await audit.forUser(user, 'auth.login', 'Signed in');
      return { user, session: started };
    },

    /**
     * The link from the sign-up e-mail: the address is proven and the account can log in. It does NOT sign
     * this browser in (owner decision 2026-10-15): the dashboard sends the user to Log in, e-mail filled in.
     */
    async verifyEmail(token: string): Promise<{ email: string }> {
      const invalid = () => new HttpError(400, 'verify_invalid', 'This link has expired or was already used. Log in to get a new one.');
      if (!token) throw invalid();
      const at = now();
      const link = await store.useEmailVerification(sha256Hex(token), at);
      const user = link && (await store.userById(link.userId));
      if (!link || !user || user.status !== 'active') throw invalid();
      if (user.emailVerifiedAt === null) {
        await store.markEmailVerified(user._id, at);
        await audit.forUser(user, 'auth.email_verified', `Confirmed the e-mail address ${user.email}`);
      }
      await store.deleteEmailVerificationsOf(user._id);
      return { email: user.email };
    },

    /**
     * "Send the link again", from the login page. Asks for the password too, so it can neither tell anyone
     * which addresses have accounts nor be used to flood someone's inbox.
     */
    async resendVerification(input: CredentialsInput, ip: string): Promise<{ alreadyVerified: true } | { email: string; hours: number }> {
      if (!mailer.configured) throw new HttpError(503, 'mail_unavailable', 'E-mail is not set up on this server yet.');
      if (!limits.verifyMail.take(`email:${input.email}`, Date.now()) || !limits.verifyMailIp.take(`ip:${ip}`, Date.now())) {
        throw new HttpError(429, 'rate_limited', 'Too many e-mails asked for. Wait an hour and try again.');
      }
      const { user, ok } = await checkCredentials(input);
      if (!user || !ok || user.status !== 'active') throw new HttpError(401, 'invalid_credentials', 'Wrong e-mail or password.');
      if (!unverified(user)) return { alreadyVerified: true };
      if (!(await sendVerification(user))) throw new HttpError(503, 'mail_failed', 'The e-mail could not be sent right now. Try again in a few minutes.');
      return { email: user.email, hours: VERIFY_EMAIL_HOURS };
    },

    /**
     * Forgot password (owner decision 2026-10-15): an address without an account is told so ("No account
     * uses this e-mail"), instead of the same answer for every address. The trade-off: anyone can learn
     * whether an address has an account here; the per-address and per-IP limits below slow that down.
     * The link carries a random token; only its SHA-256 is stored, it works once, for RESET_MINUTES.
     */
    async forgot(email: string, ip: string): Promise<{ minutes: number }> {
      if (!mailer.configured) {
        throw new HttpError(503, 'reset_unavailable', 'Password reset by e-mail is not set up on this server yet. Ask the owner to set TW_BREVO_API_KEY and TW_MAIL_FROM.');
      }
      const key = email.toLowerCase();
      if (!limits.forgot.take(`email:${key}`, Date.now()) || !limits.forgotIp.take(`ip:${ip}`, Date.now())) {
        throw new HttpError(429, 'rate_limited', 'Too many reset requests. Wait an hour and try again.');
      }
      const user = await store.userByEmail(key);
      if (!user || user.status !== 'active') {
        throw new HttpError(404, 'email_not_found', 'No account uses this e-mail. Check the spelling, or sign up.');
      }
      const token = newSessionToken();
      const at = now();
      await store.createPasswordReset({ _id: sha256Hex(token), userId: user._id, createdAt: at, expiresAt: new Date(at.getTime() + RESET_MINUTES * 60_000), usedAt: null });
      const link = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
      try {
        await mailer.send(resetPasswordMail(user.email, user.name, link, RESET_MINUTES));
      } catch (error) {
        logError('mail_failed', { kind: 'password_reset', message: errorText(error) });
        throw new HttpError(503, 'mail_failed', 'The e-mail could not be sent right now. Try again in a few minutes.');
      }
      return { minutes: RESET_MINUTES };
    },

    /** Is this reset link still good? Lets the page say "expired" before the user types a new password. */
    async resetValid(token: string): Promise<boolean> {
      const reset = token ? await store.passwordReset(sha256Hex(token), now()) : null;
      return !!reset;
    },

    /** New password from a reset link: every other session ends (all devices), and a new one starts here. */
    async resetPassword(input: ResetInput): Promise<{ user: UserDoc; session: Started }> {
      const expired = () => new HttpError(400, 'reset_invalid', 'This reset link has expired or was already used. Ask for a new one.');
      if (!input.token) throw expired();
      const at = now();
      const reset = await store.usePasswordReset(sha256Hex(input.token), at);
      const user = reset && (await store.userById(reset.userId));
      if (!reset || !user || user.status !== 'active') throw expired();
      await store.setPassword(user._id, await hashPassword(input.password, config.scrypt), at);
      // The reset link reached this inbox: the address is proven as well.
      if (user.emailVerifiedAt === null) await store.markEmailVerified(user._id, at);
      await store.deleteSessionsOf(user._id);
      await store.deletePasswordResetsOf(user._id);
      const started = await session.start(user);
      await audit.forUser(user, 'auth.password_reset', 'Changed the password with an e-mailed reset link (signed out on every device)');
      return { user, session: started };
    },

    /** Log out: this session ends. */
    async logout(actor: Actor, token: string): Promise<void> {
      await session.end(token);
      await audit.record(actor, 'auth.logout', null, 'Signed out');
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
