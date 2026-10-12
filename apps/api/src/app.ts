/**
 * TailWatch API, v1. ONE backend for every client (PLAN 2.1: "one API serving wp-admin + cloud
 * dashboard + mobile app"): the dashboard uses the session cookie, the WordPress plugin and the mobile
 * app send the same session as `Authorization: Bearer <token>`. Every rule lives here; clients only
 * display what this returns (snippets included).
 *
 * Stage 5 surface (BUILD-ORDER Part 1 ①-⑤): auth, tenants, sites with timezone, key issue and rotation,
 * KV sync on write, the verifier, the snippet generator. Stage 6 adds the Query API under /api/v1 too.
 */
import { timingSafeEqual } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ObjectId } from 'mongodb';
import type { AnalyticsReader } from './analytics';
import type { ApiConfig } from './config';
import { RETENTION_CHOICES, signupAllowed } from './config';
import { allowedHostsFor, canonicalTimezone, normalizeDomain } from './domain';
import type { AnalyticsEraser } from './eraser';
import { ERASURE_SETTLE_DAYS, ERASURE_WATCH_DAYS, advanceErasure, pruneRetention } from './jobs';
import { deleteKeys, expectedEntries, kvProblem, putKeys, syncSite } from './kv';
import { UnconfiguredMailer, accountDeletedMail, resetPasswordMail } from './mail';
import type { Mailer } from './mail';
import type { SiteConfigSink } from './kv';
import { PASSWORD_MAX, PASSWORD_MIN, decoyHash, hashPassword, verifyPassword } from './passwords';
import { newIdentitySecret, newKeyId, newPublicKey, newSessionToken, sha256Hex } from './secrets';
import { snippetsFor } from './snippets';
import { RANGE_KEYS, addDays, localDate, resolveRange } from './stats';
import type { RangeKey, SiteExport, StatsReader } from './stats';
import { DuplicateError } from './store/types';
import type { AuditAction, AuditDoc, ControlStore, ErasureDoc, ExportDoc, KeyDoc, KvIssueDoc, SiteDoc, SitePatch, TenantDoc, UserDoc } from './store/types';
import { VerifyInputError, runActiveCheck } from './verifier';
import type { VerifierOptions } from './verifier';

export interface Deps {
  store: ControlStore;
  kv: SiteConfigSink;
  analytics: AnalyticsReader;
  /** Query API (Stage 6). Null when ClickHouse is not configured for the API. */
  stats?: StatsReader | null;
  config: ApiConfig;
  /** Outgoing e-mail (password reset). Missing: reset by e-mail is "not set up". */
  mailer?: Mailer;
  /** Deletes ClickHouse rows (retention, account erasure). Null when TW_CH_PRUNE_PASSWORD is not set. */
  eraser?: AnalyticsEraser | null;
  now?: () => Date;
  verifier?: VerifierOptions;
}

export const SESSION_COOKIE = 'tw_session';
/** "Has any event arrived in the last 30 min?" (BUILD-ORDER ⑤, passive check). */
export const PASSIVE_WINDOW_MINUTES = 30;
/** A "forgot password" link works this long. */
export const RESET_MINUTES = 60;
/** Reports (saved CSV exports) are deleted this many days after they were made (TTL index). */
export const EXPORT_KEEP_DAYS = 90;
/** Saved reports per site at one time: enough for daily exports for the whole 90 days, and then some. */
export const EXPORT_MAX = 200;
/** Activity-log entries are deleted this many days after they were written (TTL index). */
export const AUDIT_KEEP_DAYS = 400;
/** What the account deletion form must receive, typed by the user. */
export const DELETE_CONFIRMATION = 'DELETE';

type Vars = { user: UserDoc; tenant: TenantDoc; token: string };
type Ctx = Context<{ Variables: Vars }>;

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Fixed-window limiter in memory: enough for one API process (a shared store comes with scale-out). */
class Limiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  take(key: string, now: number): boolean {
    const h = this.hits.get(key);
    if (!h || h.until <= now) {
      if (this.hits.size > 10_000) this.hits.clear();
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      return true;
    }
    h.n += 1;
    return h.n <= this.max;
  }
}

/** What clients see of a site. Never the identity secret. */
function siteView(site: SiteDoc) {
  const active = site.keys.filter((k) => k.status === 'active');
  return {
    id: site._id,
    domain: site.domain,
    timezone: site.timezone,
    allowedHosts: site.allowedHosts,
    status: site.status,
    region: site.region,
    verifiedAt: site.verifiedAt?.toISOString() ?? null,
    createdAt: site.createdAt.toISOString(),
    retentionDays: site.retentionDays,
    /** The key new snippets use: the newest active one. */
    publicKey: active[active.length - 1]?.publicKey ?? null,
    keys: site.keys.map((k) => ({
      id: k.id,
      publicKey: k.publicKey,
      status: k.status,
      createdAt: k.createdAt.toISOString(),
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
  };
}

function exportView(e: Omit<ExportDoc, 'csv'>) {
  return {
    id: e._id.toHexString(),
    range: e.range,
    from: e.from,
    to: e.to,
    timezone: e.timezone,
    filename: e.filename,
    rows: e.rows,
    bytes: e.bytes,
    createdAt: e.createdAt.toISOString(),
    expiresAt: e.expiresAt.toISOString(),
  };
}

const userView = (u: UserDoc) => ({ id: u._id.toHexString(), email: u.email, name: u.name ?? null });

/** "tw_pub_AbC1…": enough to tell keys apart in the activity log, never the whole key. */
const shortKey = (k: string) => `${k.slice(0, 11)}…`;
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Cursor of the activity log: "<ms>.<id>" of the last entry shown. */
const auditCursor = (e: AuditDoc) => `${e.at.getTime()}.${e._id.toHexString()}`;
function parseAuditCursor(raw: string | undefined): { at: Date; id: ObjectId } | undefined {
  const m = /^(\d{1,15})\.([0-9a-f]{24})$/.exec(raw ?? '');
  return m ? { at: new Date(Number(m[1])), id: new ObjectId(m[2]) } : undefined;
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Constant-time string comparison (the cron secret). */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The client's address for rate limiting only (never stored). Behind a hosting proxy (Render) the real
 * address is the LAST X-Forwarded-For entry: the proxy appends it, and anything before it the client
 * could have written itself.
 */
function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (!xff) return 'local';
  const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? 'local';
}

export function createApp(deps: Deps) {
  const { store, kv, analytics, config } = deps;
  const now = deps.now ?? (() => new Date());
  const loginLimiter = new Limiter(10, 15 * 60_000);
  const signupLimiter = new Limiter(20, 60 * 60_000);
  /** Per address, across e-mails: stops one machine from guessing many accounts' passwords. */
  const loginIpLimiter = new Limiter(30, 15 * 60_000);
  /** Reset e-mails: a few per address an hour, so the form cannot be used to flood someone's inbox. */
  const forgotLimiter = new Limiter(3, 60 * 60_000);
  const forgotIpLimiter = new Limiter(10, 60 * 60_000);
  const mailer = deps.mailer ?? new UnconfiguredMailer();
  /** The verifier fetches other people's servers: a few checks a minute per account and per address. */
  const verifyLimiter = new Limiter(20, 10 * 60_000);
  const verifyIpLimiter = new Limiter(40, 10 * 60_000);
  /** Password checks of "delete account": its own counter, so it can neither lock out nor bypass sign-in. */
  const deleteLimiter = new Limiter(5, 15 * 60_000);

  const app = new Hono<{ Variables: Vars }>().basePath('/api/v1');

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
    console.error(JSON.stringify({ tw: 'api_error', name: err.name, message: err.message }));
    return c.json({ error: 'internal', message: 'Something went wrong on our side. Try again.' }, 500);
  });
  app.notFound((c) => c.json({ error: 'not_found', message: 'No such endpoint.' }, 404));

  // CSRF: a cookie-authenticated write must be a same-origin JSON request. Browsers cannot send a
  // cross-site application/json body without a preflight we never answer, and Origin must match.
  app.use('*', async (c, next) => {
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
  });

  const startSession = async (c: Ctx, user: UserDoc, wantToken: boolean) => {
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
  };

  const auth: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
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

  const loadSite = async (c: Ctx) => {
    const id = Number(c.req.param('id'));
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(404, 'not_found', 'No such site.');
    const site = await store.site(c.get('tenant')._id, id);
    if (!site) throw new HttpError(404, 'not_found', 'No such site.');
    return site;
  };

  /**
   * KV sync (PROJECT-NOTES decision 18). Two directions, two rules:
   *  - GRANT (new site, new key, resume, extra host): Cloudflare KV first. If KV refuses, nothing is changed
   *    and the customer sees why (503). So a key or host is never shown before the collector accepts it.
   *  - REVOKE (revoke key, pause, delete): MongoDB first, then KV. A KV failure is remembered in kv_outbox,
   *    shown in the dashboard, and retried by the reconciler until KV matches MongoDB again.
   */
  const activateFirst = async (site: SiteDoc, onlyKeys?: string[]) => {
    try {
      if (onlyKeys) await putKeys(kv, site, onlyKeys);
      else await syncSite(kv, site);
    } catch (error) {
      const message = kvProblem(error);
      console.error(JSON.stringify({ tw: 'kv_activate_failed', site: site._id, message }));
      throw new HttpError(503, 'activation_failed', `${message} Nothing was changed.`);
    }
  };

  const sync = async (site: SiteDoc) => {
    try {
      await syncSite(kv, site);
      await store.clearKvIssue(site._id);
      return { ok: true as const };
    } catch (error) {
      const message = kvProblem(error);
      console.error(JSON.stringify({ tw: 'kv_sync_failed', site: site._id, message }));
      await store.recordKvIssue(site._id, site.tenantId, message, now());
      return { ok: false as const, pending: true, message: `${message} Your change is saved and reaches the collector automatically once Cloudflare accepts it.` };
    }
  };

  /**
   * Undo of a half-done grant: KV is rewritten from the site as MongoDB has it NOW (re-read), never from the
   * copy loaded at the start of the request: a key revoked meanwhile must not be written back.
   */
  const resyncFresh = async (siteId: number, keysIfGone: string[] = []) => {
    const fresh = await store.siteById(siteId);
    if (fresh) await sync(fresh);
    // The site was deleted meanwhile (its account was deleted in another tab): what we just activated must go.
    else if (keysIfGone.length) await deleteKeys(kv, keysIfGone);
  };

  /** Re-sync sites with an outstanding KV issue from MongoDB (the source of truth). Returns how many are fixed. */
  const reconcileIssues = async (tenantId: ObjectId | null, limit: number) => {
    let fixed = 0;
    for (const issue of await store.kvIssues(tenantId, limit)) {
      const site = await store.siteById(issue._id);
      if (!site) {
        await store.clearKvIssue(issue._id);
        continue;
      }
      if ((await sync(site)).ok) fixed += 1;
    }
    return fixed;
  };

  /** Dashboard loads retry a tenant's KV issues by themselves, at most once a minute per server instance. */
  const lastAutoRetry = new Map<string, number>();
  const issuesOf = async (tenantId: ObjectId): Promise<KvIssueDoc[]> => {
    let issues = await store.kvIssues(tenantId, 20);
    const key = tenantId.toHexString();
    if (issues.length && Date.now() - (lastAutoRetry.get(key) ?? 0) > 60_000) {
      lastAutoRetry.set(key, Date.now());
      if (lastAutoRetry.size > 10_000) lastAutoRetry.clear();
      // A few only: this runs inside a dashboard request (Vercel limit 30 s); "Retry now" and the cron do more.
      await reconcileIssues(tenantId, 3);
      issues = await store.kvIssues(tenantId, 20);
    }
    return issues;
  };
  const issueView = async (issue: KvIssueDoc) => {
    const site = await store.siteById(issue._id);
    return { siteId: issue._id, domain: site?.domain ?? String(issue._id), deleted: site?.status === 'deleted', error: issue.error, since: issue.createdAt.toISOString(), attempts: issue.attempts };
  };

  const patchSite = async (c: Ctx, site: SiteDoc, patch: SitePatch) => {
    const updated = await store.updateSite(c.get('tenant')._id, site._id, site.updatedAt, patch, now());
    if (!updated) throw new HttpError(409, 'conflict', 'This site changed in another tab. Reload and try again.');
    return updated;
  };

  /**
   * Activity log (Phase 3). Written after the change succeeded; a failure to write it is logged and never
   * undoes or fails the change itself (the customer's action matters more than its log line).
   */
  const audit = async (tenantId: ObjectId, actor: UserDoc | null, action: AuditAction, siteId: number | null, summary: string) => {
    const at = now();
    try {
      await store.insertAudit({
        _id: new ObjectId(),
        tenantId,
        at,
        actorKind: actor ? 'user' : 'system',
        actorId: actor?._id ?? null,
        actorName: (actor ? actor.name || actor.email : 'TailWatch').slice(0, 120),
        action,
        siteId,
        summary: summary.slice(0, 300),
        expiresAt: new Date(at.getTime() + AUDIT_KEEP_DAYS * 86_400_000),
      });
    } catch (error) {
      console.error(JSON.stringify({ tw: 'audit_failed', action, message: error instanceof Error ? error.message : String(error) }));
    }
  };
  /** The signed-in user did something (to a site, or to the account when site is null). */
  const record = (c: Ctx, action: AuditAction, site: SiteDoc | null, summary: string) => audit(c.get('tenant')._id, c.get('user'), action, site?._id ?? null, summary);
  /** For a user who is not signed in yet (login, password reset): finds the workspace, never throws. */
  const auditUser = async (user: UserDoc, action: AuditAction, summary: string) => {
    try {
      const tenantId = (await store.membershipsOf(user._id))[0]?.tenantId;
      if (tenantId) await audit(tenantId, user, action, null, summary);
    } catch (error) {
      console.error(JSON.stringify({ tw: 'audit_failed', action, message: error instanceof Error ? error.message : String(error) }));
    }
  };

  // ---------------------------------------------------------------- public

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/meta', (c) => c.json({ collector: config.collectorUrl, region: config.region, passwordMin: PASSWORD_MIN }));

  app.post('/auth/signup', async (c) => {
    const b = await body(c);
    const name = str(b.name).trim();
    const email = str(b.email).trim();
    const password = str(b.password);
    if (!name || name.length > 120) throw new HttpError(400, 'invalid_name', 'Enter your name (up to 120 characters).');
    if (!EMAIL_RE.test(email) || email.length > 320) throw new HttpError(400, 'invalid_email', 'Enter a valid e-mail address.');
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new HttpError(400, 'invalid_password', `Use at least ${PASSWORD_MIN} characters.`);
    }
    if (!signupAllowed(config.signupAllowlist, email)) {
      throw new HttpError(403, 'signup_closed', 'Sign-up on this server is by invitation only. Ask the owner to add your e-mail.');
    }
    if (!signupLimiter.take(`ip:${clientIp(c)}`, Date.now())) {
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
    const extra = await startSession(c as Ctx, user, b.token === true);
    await audit(tenant._id, user, 'account.created', null, `Created the account (${user.email})`);
    return c.json({ user: userView(user), ...extra }, 201);
  });

  app.post('/auth/login', async (c) => {
    const b = await body(c);
    const email = str(b.email).trim().toLowerCase();
    const password = str(b.password);
    if (!loginLimiter.take(`email:${email}`, Date.now()) || !loginIpLimiter.take(`ip:${clientIp(c)}`, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
    }
    const user = email ? await store.userByEmail(email) : null;
    // Same work and the same answer whether the e-mail exists or not: no account oracle.
    const ok = await verifyPassword(password, user?.passwordHash ?? (await decoyHash(config.scrypt)));
    if (!user || !ok || user.status !== 'active') {
      // A wrong password for a real account is shown in that account's activity log (someone tried).
      if (user && user.status === 'active') await auditUser(user, 'auth.login_failed', 'Failed sign-in: wrong password');
      throw new HttpError(401, 'invalid_credentials', 'Wrong e-mail or password.');
    }
    const extra = await startSession(c as Ctx, user, b.token === true);
    await auditUser(user, 'auth.login', 'Signed in');
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
    if (!EMAIL_RE.test(email) || email.length > 320) throw new HttpError(400, 'invalid_email', 'Enter a valid e-mail address.');
    if (!mailer.configured) {
      throw new HttpError(503, 'reset_unavailable', 'Password reset by e-mail is not set up on this server yet. Ask the owner to set TW_BREVO_API_KEY and TW_MAIL_FROM.');
    }
    const key = email.toLowerCase();
    if (!forgotLimiter.take(`email:${key}`, Date.now()) || !forgotIpLimiter.take(`ip:${clientIp(c)}`, Date.now())) {
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
        console.error(JSON.stringify({ tw: 'mail_failed', kind: 'password_reset', message: error instanceof Error ? error.message : String(error) }));
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
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new HttpError(400, 'invalid_password', `Use at least ${PASSWORD_MIN} characters.`);
    }
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
    const extra = await startSession(c as Ctx, user, b.session === true);
    await auditUser(user, 'auth.password_reset', 'Changed the password with an e-mailed reset link (signed out on every device)');
    return c.json({ user: userView(user), ...extra });
  });

  // ---------------------------------------------------------------- signed in

  app.use('/auth/logout', auth);
  app.use('/me', auth);
  app.use('/sites', auth);
  app.use('/sites/*', auth);
  app.use('/audit', auth);
  app.use('/account/*', auth);

  app.post('/auth/logout', async (c) => {
    await store.deleteSession(sha256Hex(c.get('token')));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies });
    await record(c, 'auth.logout', null, 'Signed out');
    return c.json({ ok: true });
  });

  app.get('/me', async (c) => {
    const t = c.get('tenant');
    const user = c.get('user');
    const role = (await store.membershipsOf(user._id)).find((m) => m.tenantId.equals(t._id))?.role ?? 'viewer';
    return c.json({
      user: userView(user),
      tenant: { id: t._id.toHexString(), plan: t.plan, region: t.region },
      role,
      retention: { choices: RETENTION_CHOICES.filter((d) => d <= config.retentionDays), max: config.retentionDays, default: config.retentionDays },
    });
  });

  app.get('/sites', async (c) => {
    const tenantId = c.get('tenant')._id;
    const issues = await issuesOf(tenantId);
    const sites = await store.sitesOf(tenantId);
    return c.json({ sites: sites.map(siteView), kvIssues: await Promise.all(issues.map(issueView)) });
  });

  /** "Retry now" on the dashboard's Cloudflare warning: re-sync every site of this account with an issue. */
  app.post('/sites/sync-all', async (c) => {
    const tenantId = c.get('tenant')._id;
    await reconcileIssues(tenantId, 10);
    const issues = await store.kvIssues(tenantId, 50);
    return c.json({ kvIssues: await Promise.all(issues.map(issueView)) });
  });

  /** What adding this domain would register: the form shows it before submit (rules stay here). */
  app.get('/sites/preview', (c) => {
    const domain = normalizeDomain(c.req.query('domain') ?? '');
    if (!domain) throw new HttpError(400, 'invalid_domain', 'Enter a domain like example.com (no IP addresses or localhost).');
    return c.json({ domain, allowedHosts: allowedHostsFor(domain) });
  });

  app.post('/sites', async (c) => {
    const b = await body(c);
    const domain = normalizeDomain(str(b.domain));
    if (!domain) throw new HttpError(400, 'invalid_domain', 'Enter a domain like example.com (no IP addresses or localhost).');
    const timezone = canonicalTimezone(str(b.timezone));
    if (!timezone) throw new HttpError(400, 'invalid_timezone', 'Choose a timezone from the list.');
    const tenant = c.get('tenant');
    const at = now();
    const key = (): KeyDoc => ({ id: newKeyId(), publicKey: newPublicKey(), createdAt: at, revokedAt: null, status: 'active' });

    const existing = await store.siteByDomain(tenant._id, domain);
    let site: SiteDoc;
    if (existing && existing.status !== 'deleted') {
      throw new HttpError(409, 'domain_taken', `${domain} is already one of your sites.`);
    } else if (existing) {
      // Re-adding a deleted domain restores it: same site id, so its history comes back. Fresh key and
      // secret, because the old ones were revoked on delete.
      const fresh = key();
      const patch: SitePatch = {
        status: 'active',
        timezone,
        allowedHosts: allowedHostsFor(domain),
        identitySecret: newIdentitySecret(),
        keys: [...existing.keys.map((k) => ({ ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at })), fresh],
      };
      await activateFirst({ ...existing, ...patch } as SiteDoc, [fresh.publicKey]);
      try {
        site = await patchSite(c, existing, patch);
      } catch (error) {
        await deleteKeys(kv, [fresh.publicKey]);
        await resyncFresh(existing._id, existing.keys.map((k) => k.publicKey));
        throw error;
      }
    } else {
      site = {
        _id: await store.nextSiteId(config.siteIdFloor),
        tenantId: tenant._id,
        domain,
        timezone,
        allowedHosts: allowedHostsFor(domain),
        retentionDays: config.retentionDays,
        status: 'active',
        region: tenant.region,
        verifiedAt: null,
        identitySecret: newIdentitySecret(),
        keys: [key()],
        createdAt: at,
        updatedAt: at,
      };
      await activateFirst(site);
      try {
        await store.insertSite(site);
      } catch (error) {
        await deleteKeys(kv, site.keys.map((k) => k.publicKey));
        if (error instanceof DuplicateError && error.field === 'domain') throw new HttpError(409, 'domain_taken', `${domain} is already one of your sites.`);
        throw error;
      }
    }
    if (existing) await record(c, 'site.restored', site, `Added ${domain} again (its earlier data is back; new key ${shortKey(site.keys[site.keys.length - 1]!.publicKey)})`);
    else await record(c, 'site.created', site, `Added ${domain} (timezone ${timezone})`);
    return c.json({ site: siteView(site), sync: { ok: true } }, 201);
  });

  app.get('/sites/:id', async (c) => {
    const site = await loadSite(c);
    const view = siteView(site);
    return c.json({ site: view, snippets: view.publicKey ? snippetsFor(config.collectorUrl, view.publicKey) : [] });
  });

  app.patch('/sites/:id', async (c) => {
    const site = await loadSite(c);
    const b = await body(c);
    const patch: SitePatch = {};
    if (b.timezone !== undefined) {
      const tz = canonicalTimezone(str(b.timezone));
      if (!tz) throw new HttpError(400, 'invalid_timezone', 'Choose a timezone from the list.');
      patch.timezone = tz;
    }
    if (b.status !== undefined) {
      if (b.status !== 'active' && b.status !== 'paused') throw new HttpError(400, 'invalid_status', 'Status is active or paused.');
      patch.status = b.status;
    }
    if (b.retentionDays !== undefined) {
      // Shortening retention deletes data: owners and admins only (viewers come with invites).
      const role = (await store.membershipsOf(c.get('user')._id)).find((m) => m.tenantId.equals(c.get('tenant')._id))?.role;
      if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'not_allowed', 'Only the owner or an admin can change how long data is kept.');
      const days = Number(b.retentionDays);
      const allowed = RETENTION_CHOICES.filter((d) => d <= config.retentionDays) as number[];
      if (!allowed.includes(days)) throw new HttpError(400, 'invalid_retention', `Keep data for ${allowed.join(', ')} days.`);
      patch.retentionDays = days;
    }
    /** One activity line per thing that really changed. */
    const log = async (updated: SiteDoc) => {
      if (patch.timezone && patch.timezone !== site.timezone) await record(c, 'site.timezone_changed', updated, `Changed the timezone of ${site.domain} from ${site.timezone} to ${patch.timezone}`);
      if (patch.retentionDays && patch.retentionDays !== site.retentionDays) {
        const shorter = patch.retentionDays < site.retentionDays;
        await record(
          c,
          'site.retention_changed',
          updated,
          `Changed how long ${site.domain} keeps data from ${site.retentionDays} to ${patch.retentionDays} days${shorter ? ' (older data is deleted within a week)' : ''}`,
        );
      }
      if (patch.status && patch.status !== site.status) await record(c, patch.status === 'paused' ? 'site.paused' : 'site.resumed', updated, `${patch.status === 'paused' ? 'Paused' : 'Resumed'} tracking on ${site.domain}`);
    };
    if (patch.status === 'active' && site.status !== 'active') {
      // Resume = grant: the collector must accept the key again before the dashboard says so.
      await activateFirst({ ...site, ...patch } as SiteDoc);
      const updated = await patchSite(c, site, patch).catch(async (error) => {
        await resyncFresh(site._id, site.keys.map((k) => k.publicKey));
        throw error;
      });
      await log(updated);
      return c.json({ site: siteView(updated), sync: { ok: true } });
    }
    const updated = await patchSite(c, site, patch);
    const synced = patch.status ? await sync(updated) : { ok: true };
    await log(updated);
    return c.json({ site: siteView(updated), sync: synced });
  });

  app.delete('/sites/:id', async (c) => {
    const site = await loadSite(c);
    const at = now();
    const updated = await patchSite(c, site, {
      status: 'deleted',
      keys: site.keys.map((k) => ({ ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at })),
    });
    // Collected data is not deleted here (the dashboard says so): it follows the site's retention, and
    // re-adding the domain brings it back. Deleting the ACCOUNT erases it (POST /account/delete).
    const synced = await sync(updated);
    await record(c, 'site.deleted', updated, `Deleted ${site.domain} (tracking stopped; collected data is kept for ${site.retentionDays} days)`);
    return c.json({ ok: true, sync: synced });
  });

  app.post('/sites/:id/keys', async (c) => {
    // Rotation, step 1: add a new active key. Both keys work until the old one is revoked (step 2),
    // so nothing is lost while the customer swaps the snippet.
    const site = await loadSite(c);
    if (site.keys.filter((k) => k.status === 'active').length >= 3) {
      throw new HttpError(409, 'too_many_keys', 'Revoke an old key before adding another.');
    }
    const fresh: KeyDoc = { id: newKeyId(), publicKey: newPublicKey(), createdAt: now(), revokedAt: null, status: 'active' };
    // Grant: the new key is written to KV first, so it is never shown (or put in a snippet) before it works.
    await activateFirst({ ...site, keys: [...site.keys, fresh] }, [fresh.publicKey]);
    let updated: SiteDoc;
    try {
      updated = await patchSite(c, site, { keys: [...site.keys, fresh] });
    } catch (error) {
      await deleteKeys(kv, [fresh.publicKey]);
      await resyncFresh(site._id, site.keys.map((k) => k.publicKey));
      throw error;
    }
    await record(c, 'key.created', updated, `Added key ${shortKey(fresh.publicKey)} to ${site.domain}`);
    return c.json({ site: siteView(updated), sync: { ok: true } }, 201);
  });

  app.post('/sites/:id/keys/:keyId/revoke', async (c) => {
    const site = await loadSite(c);
    const keyId = c.req.param('keyId');
    const target = site.keys.find((k) => k.id === keyId);
    if (!target) throw new HttpError(404, 'not_found', 'No such key.');
    if (target.status === 'active' && site.keys.filter((k) => k.status === 'active').length === 1) {
      throw new HttpError(409, 'last_key', 'This is the only active key. Add a new key first, update your snippet, then revoke this one.');
    }
    const at = now();
    const updated = await patchSite(c, site, {
      keys: site.keys.map((k) => (k.id === keyId ? { ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at } : k)),
    });
    const synced = await sync(updated);
    if (target.status === 'active') await record(c, 'key.revoked', updated, `Revoked key ${shortKey(target.publicKey)} of ${site.domain}`);
    return c.json({ site: siteView(updated), sync: synced });
  });

  app.post('/sites/:id/sync', async (c) => {
    const site = await loadSite(c);
    return c.json({ sync: await sync(site) });
  });

  /** Passive check + the "waiting for your first pageview" poll (BUILD-ORDER ④/⑤). */
  app.get('/sites/:id/status', async (c) => {
    let site = await loadSite(c);
    let activity;
    try {
      activity = await analytics.recent(site._id, PASSIVE_WINDOW_MINUTES);
    } catch (error) {
      console.error(JSON.stringify({ tw: 'analytics_failed', message: error instanceof Error ? error.message : String(error) }));
      throw new HttpError(503, 'analytics_unavailable', 'We could not read your analytics right now. Try again in a moment.');
    }
    if (activity.pageviews > 0 && !site.verifiedAt) {
      site = (await store.updateSite(c.get('tenant')._id, site._id, site.updatedAt, { verifiedAt: now() }, now())) ?? site;
    }
    return c.json({ windowMinutes: PASSIVE_WINDOW_MINUTES, verifiedAt: site.verifiedAt?.toISOString() ?? null, ...activity });
  });

  /** Active check: fetch the customer's page and say exactly what is wrong. */
  app.post('/sites/:id/verify', async (c) => {
    const site = await loadSite(c);
    if (!verifyLimiter.take(`t:${c.get('tenant')._id.toHexString()}`, Date.now()) || !verifyIpLimiter.take(`ip:${clientIp(c)}`, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'Too many checks. Wait a few minutes and try again.');
    }
    const b = await body(c);
    try {
      const result = await runActiveCheck(site, str(b.url) || undefined, {
        allowPrivate: config.verifierAllowPrivate,
        ...deps.verifier,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof VerifyInputError) throw new HttpError(400, 'invalid_url', error.message);
      throw error;
    }
  });

  // ---------------------------------------------------------------- Stage 6: Query API

  const statsFor = () => {
    if (!deps.stats) throw new HttpError(503, 'analytics_unavailable', 'Reports are not configured: set TW_CH_URL and TW_CH_READ_PASSWORD for the API.');
    return deps.stats;
  };
  const rangeOf = (c: Ctx, site: SiteDoc) => {
    const key = (c.req.query('range') ?? '7d') as RangeKey;
    if (!RANGE_KEYS.includes(key)) throw new HttpError(400, 'invalid_range', `range is one of ${RANGE_KEYS.join(', ')}.`);
    return resolveRange(key, site.timezone, now());
  };
  const reading = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      console.error(JSON.stringify({ tw: 'stats_failed', message: error instanceof Error ? error.message : String(error) }));
      throw new HttpError(503, 'analytics_unavailable', 'We could not read your analytics right now. Try again in a moment.');
    }
  };

  app.get('/sites/:id/stats/overview', async (c) => {
    const site = await loadSite(c);
    const range = rangeOf(c, site);
    return c.json(await reading(() => statsFor().overview(site._id, range)));
  });

  app.get('/sites/:id/stats/live', async (c) => {
    const site = await loadSite(c);
    return c.json(await reading(() => statsFor().live(site._id, now())));
  });

  app.get('/sites/:id/stats/events', async (c) => {
    const site = await loadSite(c);
    const range = rangeOf(c, site);
    return c.json(await reading(() => statsFor().events(site._id, range, now())));
  });

  app.get('/sites/:id/stats/drops', async (c) => {
    const site = await loadSite(c);
    const range = rangeOf(c, site);
    return c.json(await reading(() => statsFor().drops(site._id, range)));
  });

  /** One row per local day (or hour for today): the same numbers as the chart. */
  /** The CSV of the Visitors over time chart for a range: one row per local day, or per hour for Today. */
  const buildCsv = async (site: SiteDoc, range: ReturnType<typeof rangeOf>) => {
    const o = await reading(() => statsFor().overview(site._id, range));
    const lines = [range.hourly ? 'hour_start_utc,local_hour,visitors,sessions,pageviews' : 'date,visitors,sessions,pageviews'];
    for (const r of o.series) {
      lines.push(range.hourly ? `${new Date(Number(r.bucket) * 1000).toISOString()},${r.label},${r.visitors},${r.sessions},${r.pageviews}` : `${r.bucket},${r.visitors},${r.sessions},${r.pageviews}`);
    }
    const safe = (v: string) => v.replace(/[^A-Za-z0-9._-]+/g, '-');
    return { csv: lines.join('\n') + '\n', rows: o.series.length, filename: `${safe(site.domain)}-${safe(range.from)}-${safe(range.to)}.csv` };
  };
  const csvResponse = (c: Context, csv: string, filename: string) => {
    c.header('content-type', 'text/csv; charset=utf-8');
    c.header('content-disposition', `attachment; filename="${filename}"`);
    return c.body(csv);
  };

  /** Direct download, not saved (API clients). The dashboard saves every export as a report (below). */
  app.get('/sites/:id/export.csv', async (c) => {
    const site = await loadSite(c);
    const out = await buildCsv(site, rangeOf(c, site));
    return csvResponse(c, out.csv, out.filename);
  });

  // ---------------------------------------------------------------- Reports: saved exports

  const exportId = (c: Ctx) => {
    const raw = c.req.param('exportId') ?? '';
    if (!/^[0-9a-f]{24}$/.test(raw)) throw new HttpError(404, 'not_found', 'No such report.');
    return new ObjectId(raw);
  };

  app.get('/sites/:id/exports', async (c) => {
    const site = await loadSite(c);
    const list = await store.exportsOf(c.get('tenant')._id, site._id, now(), EXPORT_MAX);
    return c.json({ keepDays: EXPORT_KEEP_DAYS, max: EXPORT_MAX, exports: list.map(exportView) });
  });

  /** Make a report: the CSV is built now, saved, and can be downloaded again until it expires. */
  app.post('/sites/:id/exports', async (c) => {
    const site = await loadSite(c);
    const b = await body(c);
    const key = str(b.range) as RangeKey;
    if (!RANGE_KEYS.includes(key)) throw new HttpError(400, 'invalid_range', `range is one of ${RANGE_KEYS.join(', ')}.`);
    const tenantId = c.get('tenant')._id;
    const at = now();
    if ((await store.countExports(tenantId, site._id, at)) >= EXPORT_MAX) {
      throw new HttpError(409, 'too_many_reports', `You have ${EXPORT_MAX} saved reports for this site. Delete some to make a new one.`);
    }
    const range = resolveRange(key, site.timezone, at);
    const out = await buildCsv(site, range);
    const doc: ExportDoc = {
      _id: new ObjectId(),
      tenantId,
      siteId: site._id,
      range: key,
      from: range.from,
      to: range.to,
      timezone: site.timezone,
      filename: out.filename,
      rows: out.rows,
      bytes: Buffer.byteLength(out.csv, 'utf8'),
      csv: out.csv,
      createdBy: c.get('user')._id,
      createdAt: at,
      expiresAt: new Date(at.getTime() + EXPORT_KEEP_DAYS * 86_400_000),
    };
    await store.insertExport(doc);
    await record(c, 'report.created', site, `Made a report of ${site.domain}: ${range.from === range.to ? range.from : `${range.from} to ${range.to}`}`);
    return c.json({ export: exportView(doc) }, 201);
  });

  app.get('/sites/:id/exports/:exportId/download', async (c) => {
    const site = await loadSite(c);
    const e = await store.exportById(c.get('tenant')._id, site._id, exportId(c), now());
    if (!e) throw new HttpError(404, 'not_found', 'This report no longer exists (deleted, or older than 90 days).');
    return csvResponse(c, e.csv, e.filename);
  });

  app.delete('/sites/:id/exports/:exportId', async (c) => {
    const site = await loadSite(c);
    const id = exportId(c);
    const report = await store.exportById(c.get('tenant')._id, site._id, id, now()).catch(() => null); // only for the log line
    const gone = await store.deleteExport(c.get('tenant')._id, site._id, id);
    if (!gone) throw new HttpError(404, 'not_found', 'No such report.');
    await record(c, 'report.deleted', site, `Deleted the report ${report?.filename ?? id.toHexString()}`);
    return c.json({ ok: true });
  });

  /** "Allow" on a hostname drop: that host is added to the site's accepted hosts (KV synced). */
  app.post('/sites/:id/allowed-hosts', async (c) => {
    const site = await loadSite(c);
    const b = await body(c);
    const host = str(b.host).trim().toLowerCase().replace(/\.$/, '');
    if (!/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host) || host.length > 253) {
      throw new HttpError(400, 'invalid_host', 'Enter a host name like shop.example.com.');
    }
    if (site.allowedHosts.includes(host)) return c.json({ site: siteView(site), sync: { ok: true } });
    if (site.allowedHosts.length >= 50) throw new HttpError(409, 'too_many_hosts', 'A site can accept at most 50 hosts.');
    const next: SiteDoc = { ...site, allowedHosts: [...site.allowedHosts, host] };
    await activateFirst(next);
    const updated = await patchSite(c, site, { allowedHosts: next.allowedHosts }).catch(async (error) => {
      await resyncFresh(site._id, site.keys.map((k) => k.publicKey));
      throw error;
    });
    await record(c, 'host.allowed', updated, `Allowed ${host} to send data for ${site.domain}`);
    return c.json({ site: siteView(updated), sync: { ok: true } });
  });

  // ---------------------------------------------------------------- Phase 3: activity log

  /** Newest first, 50 at a time; `before` continues from the last entry shown, `site` filters. */
  app.get('/audit', async (c) => {
    const tenantId = c.get('tenant')._id;
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const siteRaw = c.req.query('site');
    const siteId = siteRaw ? Number(siteRaw) : undefined;
    if (siteId !== undefined && (!Number.isSafeInteger(siteId) || siteId < 1)) throw new HttpError(400, 'invalid_site', 'site is a site id.');
    const entries = await store.auditOf(tenantId, { limit: limit + 1, siteId, before: parseAuditCursor(c.req.query('before')) });
    const page = entries.slice(0, limit);
    const domains = new Map((await store.sitesOf(tenantId, true)).map((s) => [s._id, s.domain]));
    const me = c.get('user')._id;
    return c.json({
      keepDays: AUDIT_KEEP_DAYS,
      entries: page.map((e) => ({
        id: e._id.toHexString(),
        at: e.at.toISOString(),
        action: e.action,
        actor: { kind: e.actorKind, name: e.actorName, you: !!e.actorId && e.actorId.equals(me) },
        siteId: e.siteId,
        domain: e.siteId !== null ? (domains.get(e.siteId) ?? null) : null,
        summary: e.summary,
      })),
      next: entries.length > limit ? auditCursor(page[page.length - 1]!) : null,
    });
  });

  // ---------------------------------------------------------------- Phase 3: export, then erase

  /**
   * "Download your data" (GDPR Art 20, and step 1 of deleting the account): one JSON file with the account,
   * every site (deleted ones too, their data is still stored), each site's analytics over its whole stored
   * history, the list of saved reports and the activity log. Read-only; never the identity secrets.
   * Sent gzip-compressed when the browser accepts it (every browser does): a big account stays far below
   * Vercel's response size limit. Saved reports are listed, not repeated (they are the same daily numbers).
   */
  app.get('/account/export', async (c) => {
    const tenant = c.get('tenant');
    const user = c.get('user');
    const at = now();
    const sites = await store.sitesOf(tenant._id, true);
    // Three sites at a time (5 queries each): enough for speed, gentle on ClickHouse. Vercel stops a
    // request at 30 s: a very large account gets a clear answer instead of a cut-off file.
    const analytics: (SiteExport | null)[] = [];
    const deadline = Date.now() + 22_000;
    for (let i = 0; i < sites.length; i += 3) {
      if (Date.now() > deadline) {
        throw new HttpError(503, 'export_too_large', 'Your account has too much data to download at once. Write to us and we send you the file.');
      }
      analytics.push(
        ...(await Promise.all(
          sites.slice(i, i + 3).map((site) => {
            if (!deps.stats) return Promise.resolve(null);
            const to = localDate(at, site.timezone);
            return reading(() => deps.stats!.exportSite(site._id, site.timezone, addDays(to, -site.retentionDays), to));
          }),
        )),
      );
    }
    const reportsBySite = await Promise.all(sites.map((site) => store.exportsOf(tenant._id, site._id, at, EXPORT_MAX)));
    const activity: AuditDoc[] = [];
    for (let before: { at: Date; id: ObjectId } | undefined; activity.length < 5000; ) {
      const page = await store.auditOf(tenant._id, { limit: 500, before });
      activity.push(...page);
      if (page.length < 500) break;
      const last = page[page.length - 1]!;
      before = { at: last.at, id: last._id };
    }
    const data = {
      format: 'tailwatch-export/1',
      exportedAt: at.toISOString(),
      notes: [
        "Days are local calendar days in each site's timezone. Visitors per day are exact; visitorsEstimated on pages is an estimate (PLAN 5). Pages: the 1,000 most viewed per site.",
        'TailWatch stores no IP address and no cookie id: visitors are a hash that changes every day, so there is nothing that identifies a person.',
        deps.stats ? "analytics covers each site's whole stored history (its retention)." : 'analytics is null: the analytics database is not configured on this server.',
      ],
      user: { name: user.name ?? null, email: user.email, createdAt: user.createdAt.toISOString() },
      workspace: { id: tenant._id.toHexString(), plan: tenant.plan, region: tenant.region, createdAt: tenant.createdAt.toISOString() },
      sites: sites.map((site, i) => ({
        id: site._id,
        domain: site.domain,
        status: site.status,
        timezone: site.timezone,
        retentionDays: site.retentionDays,
        allowedHosts: site.allowedHosts,
        createdAt: site.createdAt.toISOString(),
        verifiedAt: site.verifiedAt?.toISOString() ?? null,
        keys: site.keys.map((k) => ({ publicKey: k.publicKey, status: k.status, createdAt: k.createdAt.toISOString(), revokedAt: k.revokedAt?.toISOString() ?? null })),
        analytics: analytics[i] ?? null,
        reports: reportsBySite[i]!.map((r) => ({ filename: r.filename, range: r.range, from: r.from, to: r.to, rows: r.rows, createdAt: r.createdAt.toISOString() })),
      })),
      activity: activity.map((e) => ({ at: e.at.toISOString(), who: e.actorName, action: e.action, siteId: e.siteId, summary: e.summary })),
    };
    const json = JSON.stringify(data);
    await record(c, 'account.exported', null, `Downloaded all account data (${count(sites.length, 'site')})`);
    c.header('content-type', 'application/json; charset=utf-8');
    c.header('content-disposition', `attachment; filename="tailwatch-export-${localDate(at, 'UTC')}.json"`);
    if (/\bgzip\b/.test(c.req.header('accept-encoding') ?? '')) {
      c.header('content-encoding', 'gzip');
      c.header('vary', 'accept-encoding');
      return c.body(new Uint8Array(gzipSync(json)));
    }
    return c.body(json);
  });

  /**
   * Delete the account (owner only, password + typed confirmation). Everything in MongoDB goes at once, in
   * one transaction, and an erasure record remembers what is left: the sites' Cloudflare KV keys and their
   * ClickHouse rows. Both are started here (ClickHouse with a time limit: Vercel stops at 30 s); the
   * nightly job finishes, verifies after ERASURE_SETTLE_DAYS that nothing is left, e-mails the owner, and
   * keeps watching for ERASURE_WATCH_DAYS.
   */
  app.post('/account/delete', async (c) => {
    const b = await body(c);
    const user = c.get('user');
    const tenant = c.get('tenant');
    if (str(b.confirm) !== DELETE_CONFIRMATION) throw new HttpError(400, 'confirm_required', `Type ${DELETE_CONFIRMATION} to confirm.`);
    if (!deleteLimiter.take(`user:${user._id.toHexString()}`, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait 15 minutes and try again.');
    }
    if (!user.passwordHash || !(await verifyPassword(str(b.password), user.passwordHash))) {
      throw new HttpError(401, 'invalid_password', 'Wrong password.');
    }
    const members = await store.membersOf(tenant._id);
    if (members.find((m) => m.userId.equals(user._id))?.role !== 'owner') {
      throw new HttpError(403, 'owner_only', 'Only the owner of this workspace can delete it.');
    }
    const at = now();
    // siteIds and publicKeys are filled by the store from what its transaction deletes.
    const erasure = await store.eraseAccount(
      {
        _id: tenant._id,
        email: user.email,
        name: user.name ?? null,
        requestedAt: at,
        status: 'pending',
        kvDoneAt: null,
        dataDeleteSentAt: null,
        dataVerifiedAt: null,
        rowsFound: null,
        rowsAfterCompletion: 0,
        attempts: 0,
        lastError: null,
        completedAt: null,
        updatedAt: at,
      },
      members.map((m) => m.userId),
    );
    const sites = erasure.siteIds;
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies });
    console.log(JSON.stringify({ tw: 'account_deleted', erasure: tenant._id.toHexString(), sites: sites.length }));

    // The e-mail first: it must not depend on how fast Cloudflare or ClickHouse answer.
    if (mailer.configured) {
      try {
        await mailer.send(accountDeletedMail(user.email, user.name ?? null, sites.length, ERASURE_SETTLE_DAYS));
      } catch (error) {
        console.error(JSON.stringify({ tw: 'mail_failed', kind: 'account_deleted', message: error instanceof Error ? error.message : String(error) }));
      }
    }
    // Then the first step of the erasure (best effort; the nightly job retries everything).
    const progress = await advanceErasure({ store, kv, eraser: deps.eraser ?? null, mailer }, erasure, at, { finish: false, dataBudgetMs: 5_000 }).catch((error) => {
      console.error(JSON.stringify({ tw: 'erasure_start_failed', message: error instanceof Error ? error.message : String(error) }));
      return erasure;
    });
    return c.json({
      ok: true,
      erasure: {
        id: tenant._id.toHexString(),
        sites: sites.length,
        trackingStopped: !!progress.kvDoneAt,
        dataDeleteSent: !!progress.dataDeleteSentAt || (progress.rowsFound !== null && Object.values(progress.rowsFound).every((n) => n === 0)),
        finishesWithinDays: ERASURE_SETTLE_DAYS + 1,
      },
    });
  });

  // ---------------------------------------------------------------- scheduled: retention + erasures

  /**
   * The nightly maintenance run (Vercel Cron, CRON_SECRET), in a 25 s budget:
   *   1. account erasures: one step forward each (KV, ClickHouse deletes, verify, finish);
   *   2. retention: per site, rows older than its retention are deleted, and the workspace's activity log
   *      says so. Off (and reported) when TW_CH_PRUNE_PASSWORD is not set.
   */
  app.get('/internal/maintenance', async (c) => {
    if (!config.cronSecret || !sameSecret(c.req.header('authorization') ?? '', `Bearer ${config.cronSecret}`)) {
      throw new HttpError(404, 'not_found', 'No such endpoint.');
    }
    const deadline = Date.now() + 25_000;
    const eraser = deps.eraser ?? null;
    const jobDeps = { store, kv, eraser, mailer };
    const erasures = { advanced: 0, completed: 0, failed: 0 };
    for (const e of await store.activeErasures(new Date(now().getTime() - ERASURE_WATCH_DAYS * 86_400_000), 50)) {
      if (Date.now() > deadline) break;
      try {
        const next = await advanceErasure(jobDeps, e, now());
        erasures.advanced += 1;
        if (next.status === 'completed' && e.status === 'pending') erasures.completed += 1;
        if (next.lastError) erasures.failed += 1;
      } catch (error) {
        erasures.failed += 1;
        console.error(JSON.stringify({ tw: 'erasure_failed', erasure: e._id.toHexString(), message: error instanceof Error ? error.message : String(error) }));
      }
    }

    const retention: { configured: boolean; sitesPruned: number; rows: number; error?: string } = { configured: !!eraser, sitesPruned: 0, rows: 0 };
    if (eraser && Date.now() < deadline) {
      try {
        const at = now();
        for (const p of await pruneRetention(eraser, await store.allSites(), at, deadline)) {
          retention.sitesPruned += 1;
          const r = p.rows;
          retention.rows += r.events + r.sessions + r.dropped_hits + r.rollup_15m_pages;
          const parts = [
            r.events && count(r.events, 'event'),
            r.sessions && count(r.sessions, 'session row'),
            r.dropped_hits && count(r.dropped_hits, 'blocked-hit row'),
            r.rollup_15m_pages && count(r.rollup_15m_pages, 'page-total row'),
          ].filter(Boolean);
          await audit(
            p.site.tenantId,
            null,
            'data.pruned',
            p.site._id,
            `Removed data of ${p.site.domain} older than ${p.site.retentionDays} days (before ${dayFmt.format(p.cutoff)}): ${parts.join(', ')}`,
          );
        }
      } catch (error) {
        retention.error = error instanceof Error ? error.message.slice(0, 200) : String(error);
        console.error(JSON.stringify({ tw: 'retention_failed', message: retention.error }));
      }
    }
    console.log(JSON.stringify({ tw: 'maintenance', erasures, retention }));
    return c.json({ erasures, retention });
  });

  // ---------------------------------------------------------------- scheduled: KV reconcile

  /**
   * Makes Cloudflare KV match MongoDB for every site: first the known issues, then a full compare (read
   * each entry, write only what differs). Called by Vercel Cron once a day with CRON_SECRET; off without it.
   */
  app.get('/internal/reconcile', async (c) => {
    if (!config.cronSecret || !sameSecret(c.req.header('authorization') ?? '', `Bearer ${config.cronSecret}`)) {
      throw new HttpError(404, 'not_found', 'No such endpoint.');
    }
    // Vercel stops the function at 30 s: work in a 20 s budget, known issues first, then the full compare
    // in a random order, so that over a few days every site is checked even if one run cannot finish.
    const deadline = Date.now() + 20_000;
    const fixedIssues = await reconcileIssues(null, 50);
    let checked = 0;
    let repaired = 0;
    const failed: number[] = [];
    if (kv.get) {
      const all = await store.allSites();
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j]!, all[i]!];
      }
      for (const loaded of all) {
        if (Date.now() > deadline) break;
        try {
          let wrong = false;
          for (const [name, want] of expectedEntries(loaded)) {
            checked += 1;
            if ((await kv.get(name)) !== want) wrong = true;
          }
          if (wrong) {
            // Re-read: a change made while we were comparing must win over our snapshot.
            const fresh = await store.siteById(loaded._id);
            if (!fresh) continue;
            const r = await sync(fresh);
            if (r.ok) repaired += 1;
            else failed.push(fresh._id);
          }
        } catch (error) {
          failed.push(loaded._id);
          await store.recordKvIssue(loaded._id, loaded.tenantId, kvProblem(error), now());
        }
      }
    }
    console.log(JSON.stringify({ tw: 'kv_reconcile', fixedIssues, checked, repaired, failed: failed.length }));
    return c.json({ fixedIssues, checked, repaired, failed });
  });

  return app;
}
