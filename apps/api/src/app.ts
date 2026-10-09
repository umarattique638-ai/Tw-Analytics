/**
 * TailWatch API, v1. ONE backend for every client (PLAN 2.1: "one API serving wp-admin + cloud
 * dashboard + mobile app"): the dashboard uses the session cookie, the WordPress plugin and the mobile
 * app send the same session as `Authorization: Bearer <token>`. Every rule lives here; clients only
 * display what this returns (snippets included).
 *
 * Stage 5 surface (BUILD-ORDER Part 1 ①-⑤): auth, tenants, sites with timezone, key issue and rotation,
 * KV sync on write, the verifier, the snippet generator. Stage 6 adds the Query API under /api/v1 too.
 */
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { ObjectId } from 'mongodb';
import type { AnalyticsReader } from './analytics';
import type { ApiConfig } from './config';
import { signupAllowed } from './config';
import { allowedHostsFor, canonicalTimezone, normalizeDomain } from './domain';
import { KvSyncError, syncSite } from './kv';
import { UnconfiguredMailer, resetPasswordMail } from './mail';
import type { Mailer } from './mail';
import type { SiteConfigSink } from './kv';
import { PASSWORD_MAX, PASSWORD_MIN, decoyHash, hashPassword, verifyPassword } from './passwords';
import { newIdentitySecret, newKeyId, newPublicKey, newSessionToken, sha256Hex } from './secrets';
import { snippetsFor } from './snippets';
import { RANGE_KEYS, resolveRange } from './stats';
import type { RangeKey, StatsReader } from './stats';
import { DuplicateError } from './store/types';
import type { ControlStore, ExportDoc, KeyDoc, SiteDoc, SitePatch, TenantDoc, UserDoc } from './store/types';
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

function exportView(e: ExportDoc) {
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

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

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

  /** Mongo first (source of truth), then KV. A KV failure is reported, never hidden: the site works once synced. */
  const sync = async (site: SiteDoc) => {
    try {
      await syncSite(kv, site);
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof KvSyncError ? error.message : 'KV sync failed';
      console.error(JSON.stringify({ tw: 'kv_sync_failed', site: site._id, message }));
      return { ok: false as const, message: `${message}. The site is saved; use "Retry activation".` };
    }
  };

  const patchSite = async (c: Ctx, site: SiteDoc, patch: SitePatch) => {
    const updated = await store.updateSite(c.get('tenant')._id, site._id, site.updatedAt, patch, now());
    if (!updated) throw new HttpError(409, 'conflict', 'This site changed in another tab. Reload and try again.');
    return updated;
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
    if (!user || !ok || user.status !== 'active') throw new HttpError(401, 'invalid_credentials', 'Wrong e-mail or password.');
    const extra = await startSession(c as Ctx, user, b.token === true);
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
    return c.json({ user: userView(user), ...extra });
  });

  // ---------------------------------------------------------------- signed in

  app.use('/auth/logout', auth);
  app.use('/me', auth);
  app.use('/sites', auth);
  app.use('/sites/*', auth);

  app.post('/auth/logout', async (c) => {
    await store.deleteSession(sha256Hex(c.get('token')));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: config.secureCookies });
    return c.json({ ok: true });
  });

  app.get('/me', (c) => {
    const t = c.get('tenant');
    return c.json({ user: userView(c.get('user')), tenant: { id: t._id.toHexString(), plan: t.plan, region: t.region } });
  });

  app.get('/sites', async (c) => {
    const sites = await store.sitesOf(c.get('tenant')._id);
    return c.json({ sites: sites.map(siteView) });
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
      site = await patchSite(c, existing, {
        status: 'active',
        timezone,
        allowedHosts: allowedHostsFor(domain),
        identitySecret: newIdentitySecret(),
        keys: [...existing.keys.map((k) => ({ ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at })), key()],
      });
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
      try {
        await store.insertSite(site);
      } catch (error) {
        if (error instanceof DuplicateError && error.field === 'domain') throw new HttpError(409, 'domain_taken', `${domain} is already one of your sites.`);
        throw error;
      }
    }
    return c.json({ site: siteView(site), sync: await sync(site) }, 201);
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
    const updated = await patchSite(c, site, patch);
    return c.json({ site: siteView(updated), sync: patch.status ? await sync(updated) : { ok: true } });
  });

  app.delete('/sites/:id', async (c) => {
    const site = await loadSite(c);
    const at = now();
    const updated = await patchSite(c, site, {
      status: 'deleted',
      keys: site.keys.map((k) => ({ ...k, status: 'revoked' as const, revokedAt: k.revokedAt ?? at })),
    });
    // Collected data is not deleted here (the dashboard says so); retention / erasure is Phase 3.
    return c.json({ ok: true, sync: await sync(updated) });
  });

  app.post('/sites/:id/keys', async (c) => {
    // Rotation, step 1: add a new active key. Both keys work until the old one is revoked (step 2),
    // so nothing is lost while the customer swaps the snippet.
    const site = await loadSite(c);
    if (site.keys.filter((k) => k.status === 'active').length >= 3) {
      throw new HttpError(409, 'too_many_keys', 'Revoke an old key before adding another.');
    }
    const updated = await patchSite(c, site, {
      keys: [...site.keys, { id: newKeyId(), publicKey: newPublicKey(), createdAt: now(), revokedAt: null, status: 'active' }],
    });
    return c.json({ site: siteView(updated), sync: await sync(updated) }, 201);
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
    return c.json({ site: siteView(updated), sync: await sync(updated) });
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
    const gone = await store.deleteExport(c.get('tenant')._id, site._id, exportId(c));
    if (!gone) throw new HttpError(404, 'not_found', 'No such report.');
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
    const updated = await patchSite(c, site, { allowedHosts: [...site.allowedHosts, host] });
    return c.json({ site: siteView(updated), sync: await sync(updated) });
  });

  return app;
}
