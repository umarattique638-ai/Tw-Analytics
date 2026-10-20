import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { createApp, SESSION_COOKIE } from '../src/app';
import type { AnalyticsReader } from '../src/repositories/clickhouse';
import { defaultConfig } from '../src/config';
import { MemoryEraser } from '../src/repositories/eraser';
import type { DataTable } from '../src/repositories/eraser';
import { ERASURE_SETTLE_DAYS, retentionCutoff } from '../src/services/jobs.service';
import { MemoryKv, kvName } from '../src/repositories/kv';
import type { SiteConfigSink } from '../src/repositories/kv';
import { MemoryMailer } from '../src/services/mail';
import type { StatsReader } from '../src/repositories/stats';
import { MemoryStore } from '../src/repositories/memory-store';
import { addSite, fakeVerifier } from './helpers/install';

/**
 * Phase 3 (PLAN 9.2): activity log, retention pruning, export-then-erase.
 * Exit test this covers: "delete their account with data provably gone".
 */
const FAST = { N: 1024, r: 8, p: 1 };
const HOST = 'app.test';
const SECRET = 'cron-secret-0123456789';
const DAY = 86_400_000;

class FlakyKv implements SiteConfigSink {
  inner = new MemoryKv();
  down = false;
  async put(n: string, v: string, o?: { ttlSeconds?: number }) {
    if (this.down) throw new Error('Cloudflare KV PUT 503: unavailable');
    return this.inner.put(n, v, o);
  }
  async delete(n: string) {
    if (this.down) throw new Error('Cloudflare KV DELETE 503: unavailable');
    return this.inner.delete(n);
  }
  async get(n: string) {
    return this.inner.get(n);
  }
}

const analytics: AnalyticsReader = { recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }) };

function setup(options: { eraser?: boolean; stats?: boolean } = {}) {
  const store = new MemoryStore();
  const kv = new FlakyKv();
  const eraser = new MemoryEraser();
  const mailer = new MemoryMailer();
  // A clock the test can move forward (days), every call a later millisecond.
  const clock = { t: Date.parse('2026-10-12T09:00:00Z') };
  const exported: { site: number; from: string; to: string }[] = [];
  const stats = {
    async exportSite(site: number, tz: string, from: string, to: string) {
      exported.push({ site, from, to });
      return { from, to, timezone: tz, days: [{ date: to, visitors: 3, sessions: 4, pageviews: 9 }], pages: [{ path: '/', pageviews: 9, visitorsEstimated: 3 }], events: [], blocked: [] };
    },
  } as unknown as StatsReader;
  const app = createApp({
    store,
    kv,
    analytics,
    stats: options.stats === false ? null : stats,
    mailer,
    eraser: options.eraser === false ? null : eraser,
    config: defaultConfig({ collectorUrl: 'https://collector.test', secureCookies: false, scrypt: FAST, cronSecret: SECRET }),
    verifier: fakeVerifier(kv.inner.entries, 'https://collector.test'),
    now: () => new Date((clock.t += 1)),
  });

  const client = () => {
    let cookie = '';
    const call = async (method: string, path: string, json?: unknown, headers: Record<string, string> = {}) => {
      const res = await app.request(`http://${HOST}/api/v1${path}`, {
        method,
        headers: { host: HOST, ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set?.startsWith(`${SESSION_COOKIE}=`)) cookie = set.split(';')[0]!;
      const text = await res.text();
      let parsed: any = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }
      return { status: res.status, body: parsed, raw: text, setCookie: set, headers: res.headers };
    };
    return {
      get: (p: string, h?: Record<string, string>) => call('GET', p, undefined, h),
      post: (p: string, j: unknown = {}) => call('POST', p, j),
      patch: (p: string, j: unknown) => call('PATCH', p, j),
      del: (p: string) => call('DELETE', p, {}),
      raw: (method: string, p: string, j: unknown) => call(method, p, j),
    };
  };
  const cron = async (path: string) => {
    const r = await app.request(`http://${HOST}/api/v1${path}`, { headers: { host: HOST, authorization: `Bearer ${SECRET}` } });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { store, kv, eraser, mailer, clock, exported, app, client, cron };
}

async function account(s: ReturnType<typeof setup>, email = 'umar@example.com', domains = ['shop.example.com']) {
  const c = s.client();
  expect((await c.post('/auth/signup', { name: 'Umar', email, password: 'correct horse' })).status).toBe(201);
  const sites = [];
  for (const domain of domains) {
    const r = await addSite(c.post, s.kv.inner.entries, domain, 'Asia/Karachi');
    expect(r.status).toBe(201);
    sites.push(r.body.site);
  }
  return { c, sites };
}

const row = (table: DataTable, site: number, at: number) => ({ table, site, at: new Date(at) });

// ------------------------------------------------------------------------------------------ activity log

describe('activity log', () => {
  it('records who did what, newest first, readable sentences, no IP address', async () => {
    const s = setup();
    const { c, sites } = await account(s);
    const id = sites[0].id;
    await c.patch(`/sites/${id}`, { timezone: 'Europe/London' });
    await c.patch(`/sites/${id}`, { retentionDays: 90 });
    await c.patch(`/sites/${id}`, { status: 'paused' });
    await c.patch(`/sites/${id}`, { status: 'active' });
    const added = await c.post(`/sites/${id}/keys`);
    const oldKey = added.body.site.keys[0];
    await c.post(`/sites/${id}/keys/${oldKey.id}/revoke`);
    await c.post(`/sites/${id}/allowed-hosts`, { host: 'checkout.partner.com' });

    const r = await c.get('/audit');
    expect(r.status).toBe(200);
    const actions = r.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toEqual([
      'host.allowed',
      'key.revoked',
      'key.created',
      'site.resumed',
      'site.paused',
      'site.retention_changed',
      'site.timezone_changed',
      'site.created',
      'account.created',
    ]);
    const byAction = Object.fromEntries(r.body.entries.map((e: { action: string }) => [e.action, e]));
    expect(byAction['site.timezone_changed'].summary).toBe('Changed the timezone of shop.example.com from Asia/Karachi to Europe/London');
    expect(byAction['site.retention_changed'].summary).toContain('from 395 to 90 days (older data is deleted within a week)');
    expect(byAction['key.revoked'].summary).toBe(`Revoked key ${oldKey.publicKey.slice(0, 11)}… of shop.example.com`);
    expect(byAction['key.revoked'].summary).not.toContain(oldKey.publicKey);
    expect(byAction['site.created']).toMatchObject({ siteId: id, domain: 'shop.example.com', actor: { kind: 'user', name: 'Umar', you: true } });
    // Data minimisation: nothing but the fields of the schema (no IP, no user agent).
    expect(Object.keys(s.store.audit[0]!).sort()).toEqual(['_id', 'action', 'actorId', 'actorKind', 'actorName', 'at', 'expiresAt', 'siteId', 'summary', 'tenantId']);
    expect(s.store.audit[0]!.expiresAt.getTime() - s.store.audit[0]!.at.getTime()).toBe(400 * DAY);
  });

  it('a change that did nothing is not logged; a refused change is not logged', async () => {
    const s = setup();
    const { c, sites } = await account(s);
    await c.patch(`/sites/${sites[0].id}`, { timezone: 'Asia/Karachi' }); // same as before
    expect((await c.patch(`/sites/${sites[0].id}`, { retentionDays: 45 })).status).toBe(400);
    expect((await c.get('/audit')).body.entries.map((e: { action: string }) => e.action)).toEqual(['site.created', 'account.created']);
  });

  it('logins, failed logins (someone tried your password), logout and password reset are in the log', async () => {
    const s = setup();
    await account(s);
    const other = s.client();
    expect((await other.post('/auth/login', { email: 'umar@example.com', password: 'wrong guess!' })).status).toBe(401);
    expect((await other.post('/auth/login', { email: 'nobody@example.com', password: 'wrong guess!' })).status).toBe(401);
    expect((await other.post('/auth/login', { email: 'umar@example.com', password: 'correct horse' })).status).toBe(200);
    await other.post('/auth/logout');
    await s.client().post('/auth/forgot', { email: 'umar@example.com' });
    const link = s.mailer.sent[0]!.text.match(/token=([\w%-]+)/)![1]!;
    expect((await s.client().post('/auth/reset', { token: decodeURIComponent(link), password: 'a new password' })).status).toBe(200);

    const owner = s.client();
    await owner.post('/auth/login', { email: 'umar@example.com', password: 'a new password' });
    const actions = (await owner.get('/audit')).body.entries.map((e: { action: string }) => e.action);
    expect(actions.slice(0, 5)).toEqual(['auth.login', 'auth.password_reset', 'auth.logout', 'auth.login', 'auth.login_failed']);
    expect(s.store.audit.filter((e) => e.action === 'auth.login_failed')).toHaveLength(1); // the unknown e-mail has no log
  });

  it('pages with a cursor, filters by site, and never shows another workspace', async () => {
    const s = setup();
    const { c, sites } = await account(s, 'umar@example.com', ['a.example.com', 'b.example.com']);
    for (let i = 0; i < 7; i++) await c.patch(`/sites/${sites[0].id}`, { timezone: i % 2 ? 'Asia/Karachi' : 'Europe/London' });
    const first = await c.get('/audit?limit=4');
    expect(first.body.entries).toHaveLength(4);
    expect(first.body.next).toMatch(/^\d+\.[0-9a-f]{24}$/);
    const all: string[] = first.body.entries.map((e: { id: string }) => e.id);
    for (let next = first.body.next; next; ) {
      const page = await c.get(`/audit?limit=4&before=${next}`);
      all.push(...page.body.entries.map((e: { id: string }) => e.id));
      next = page.body.next;
    }
    expect(all).toHaveLength(10); // account + 2 sites + 7 changes
    expect(new Set(all).size).toBe(10);
    const onlyB = await c.get(`/audit?site=${sites[1].id}`);
    expect(onlyB.body.entries.map((e: { action: string }) => e.action)).toEqual(['site.created']);

    const stranger = (await account(s, 'someone@else.com', [])).c;
    expect((await stranger.get('/audit')).body.entries.map((e: { action: string }) => e.action)).toEqual(['account.created']);
    expect((await stranger.get(`/audit?site=${sites[0].id}`)).body.entries).toEqual([]);
  });

  it('needs a login', async () => {
    expect((await setup().client().get('/audit')).status).toBe(401);
  });
});

// ------------------------------------------------------------------------------------------ retention

describe('retention', () => {
  it('a site keeps 395 days by default; the owner chooses 30, 90, 180 or 395', async () => {
    const s = setup();
    const { c, sites } = await account(s);
    expect(sites[0].retentionDays).toBe(395);
    const me = await c.get('/me');
    expect(me.body.retention).toEqual({ choices: [30, 90, 180, 395], max: 395, default: 395 });
    expect(me.body.role).toBe('owner');
    expect((await c.patch(`/sites/${sites[0].id}`, { retentionDays: 30 })).body.site.retentionDays).toBe(30);
    for (const bad of [0, 31, 400, -1, '90 days', null]) {
      const r = await c.patch(`/sites/${sites[0].id}`, { retentionDays: bad });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('invalid_retention');
    }
  });

  it('the cutoff is UTC midnight, N days back', () => {
    expect(retentionCutoff(new Date('2026-10-12T23:59:00Z'), 30).toISOString()).toBe('2026-09-12T00:00:00.000Z');
    expect(retentionCutoff(new Date('2026-10-12T00:00:00Z'), 1).toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });

  it('the nightly run deletes only what is older than each site\'s retention, says so in the log, then has nothing to do', async () => {
    const s = setup();
    const { c, sites } = await account(s, 'umar@example.com', ['short.example.com', 'long.example.com']);
    const [short, long] = sites;
    await c.patch(`/sites/${short.id}`, { retentionDays: 30 });
    const now = s.clock.t;
    s.eraser.rows.push(
      row('events', short.id, now - 40 * DAY),
      row('events', short.id, now - 35 * DAY),
      row('sessions', short.id, now - 40 * DAY),
      row('rollup_15m_pages', short.id, now - 40 * DAY),
      row('events', short.id, now - 5 * DAY), // kept
      row('events', long.id, now - 40 * DAY), // kept: 395 days
      row('events', long.id, now - 405 * DAY), // gone
      row('events', 999, now - 900 * DAY), // another account's site: never touched
    );

    const run = await s.cron('/internal/maintenance');
    expect(run.status).toBe(200);
    expect(run.body.retention).toMatchObject({ configured: true, sitesPruned: 2, rows: 5 });
    expect(s.eraser.rows.map((r) => [r.table, r.site, Math.round((now - r.at.getTime()) / DAY)])).toEqual([
      ['events', short.id, 5],
      ['events', long.id, 40],
      ['events', 999, 900],
    ]);
    // Only tables that had old rows got a delete (dropped_hits had none).
    expect(s.eraser.removes.every((r) => !r.tables.includes('dropped_hits'))).toBe(true);

    const log = (await c.get('/audit')).body.entries.filter((e: { action: string }) => e.action === 'data.pruned');
    expect(log.map((e: { summary: string }) => e.summary).sort()).toEqual([
      expect.stringMatching(/^Removed data of long\.example\.com older than 395 days \(before .+\): 1 event$/),
      expect.stringMatching(/^Removed data of short\.example\.com older than 30 days \(before .+\): 2 events, 1 session row, 1 page-total row$/),
    ]);
    expect(log[0].actor).toEqual({ kind: 'system', name: 'TailWatch', you: false });

    const before = s.eraser.removes.length;
    const again = await s.cron('/internal/maintenance');
    expect(again.body.retention).toMatchObject({ sitesPruned: 0, rows: 0 });
    expect(s.eraser.removes.length).toBe(before);
  });

  it('a deleted site keeps its data for its retention too, then it is pruned', async () => {
    const s = setup();
    const { c, sites } = await account(s);
    await c.patch(`/sites/${sites[0].id}`, { retentionDays: 30 });
    await c.del(`/sites/${sites[0].id}`);
    s.eraser.rows.push(row('events', sites[0].id, s.clock.t - 40 * DAY), row('events', sites[0].id, s.clock.t - DAY));
    await s.cron('/internal/maintenance');
    expect(s.eraser.rows).toHaveLength(1);
  });

  it('weekly batches: rows just past the retention wait until some are 6 days past, then all go in one delete', async () => {
    const s = setup();
    const { c, sites } = await account(s);
    await c.patch(`/sites/${sites[0].id}`, { retentionDays: 30 });
    s.eraser.rows.push(row('events', sites[0].id, s.clock.t - 33 * DAY), row('events', sites[0].id, s.clock.t - 35 * DAY));
    await s.cron('/internal/maintenance');
    expect(s.eraser.removes).toHaveLength(0); // 3 and 5 days past: not yet
    s.clock.t += 2 * DAY;
    await s.cron('/internal/maintenance');
    expect(s.eraser.removes).toHaveLength(1);
    expect(s.eraser.rows).toHaveLength(0); // both went, in one delete
  });

  it('only the owner or an admin can change retention (it deletes data)', async () => {
    const s = setup();
    const { sites } = await account(s);
    const viewer = s.client();
    await viewer.post('/auth/signup', { name: 'Ali', email: 'ali@example.com', password: 'correct horse' });
    const ali = s.store.users.find((u) => u.email === 'ali@example.com')!;
    const owner = s.store.memberships.find((m) => m.role === 'owner' && !m.userId.equals(ali._id))!;
    s.store.memberships = s.store.memberships.filter((m) => !m.userId.equals(ali._id));
    s.store.memberships.push({ _id: new ObjectId(), tenantId: owner.tenantId, userId: ali._id, role: 'viewer', createdAt: new Date() });
    const r = await viewer.patch(`/sites/${sites[0].id}`, { retentionDays: 30 });
    expect(r.status).toBe(403);
    expect(s.store.sites[0]!.retentionDays).toBe(395);
  });

  it('without the ClickHouse delete user nothing is pruned, and the run says so', async () => {
    const s = setup({ eraser: false });
    await account(s);
    expect((await s.cron('/internal/maintenance')).body.retention).toEqual({ configured: false, sitesPruned: 0, rows: 0 });
  });

  it('the maintenance route does not exist without the cron secret', async () => {
    const s = setup();
    const r = await s.app.request(`http://${HOST}/api/v1/internal/maintenance`, { headers: { host: HOST, authorization: 'Bearer wrong-secret-000000' } });
    expect(r.status).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------ export

describe('download your data', () => {
  it('one JSON file: account, every site (deleted ones too), analytics over the stored history, reports, activity; no secrets', async () => {
    const s = setup();
    const { c, sites } = await account(s, 'umar@example.com', ['a.example.com', 'b.example.com']);
    await c.patch(`/sites/${sites[0].id}`, { retentionDays: 90 });
    await c.del(`/sites/${sites[1].id}`);
    const r = await c.get('/account/export');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment; filename="tailwatch-export-2026-10-12\.json"$/);
    const data = r.body;
    expect(data.format).toBe('tailwatch-export/1');
    expect(data.user).toMatchObject({ name: 'Umar', email: 'umar@example.com' });
    expect(data.sites.map((x: { domain: string; status: string }) => [x.domain, x.status])).toEqual([
      ['a.example.com', 'active'],
      ['b.example.com', 'deleted'],
    ]);
    expect(data.sites[0].analytics.days[0]).toEqual({ date: '2026-10-12', visitors: 3, sessions: 4, pageviews: 9 });
    expect(s.exported).toEqual([
      { site: sites[0].id, from: '2026-07-14', to: '2026-10-12' }, // 90 days back, local dates
      { site: sites[1].id, from: '2025-09-12', to: '2026-10-12' }, // 395
    ]);
    expect(data.activity.length).toBeGreaterThan(0);
    for (const site of s.store.sites) expect(r.raw).not.toContain(site.identitySecret);
    expect(r.raw).not.toContain('passwordHash');
    expect((await c.get('/audit')).body.entries[0].action).toBe('account.exported');
  });

  it('is sent gzip-compressed to a browser (Vercel response size limit), and lists reports without repeating them', async () => {
    const s = setup();
    const { c } = await account(s);
    const login = await c.post('/auth/login', { email: 'umar@example.com', password: 'correct horse' });
    const cookie = login.setCookie!.split(';')[0]!;
    const res = await s.app.request(`http://${HOST}/api/v1/account/export`, { headers: { host: HOST, cookie, 'accept-encoding': 'gzip, deflate, br' } });
    expect(res.headers.get('content-encoding')).toBe('gzip');
    const json = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
    expect(json.sites[0].domain).toBe('shop.example.com');
    expect(JSON.stringify(json)).not.toContain('"csv"');
  });

  it('works without the analytics database (analytics: null, said in the notes)', async () => {
    const s = setup({ stats: false });
    const { c } = await account(s);
    const data = (await c.get('/account/export')).body;
    expect(data.sites[0].analytics).toBeNull();
    expect(data.notes.join(' ')).toContain('not configured');
  });
});

// ------------------------------------------------------------------------------------------ delete + erase

describe('delete the account (export-then-erase)', () => {
  const PASSWORD = 'correct horse';

  it('needs the typed confirmation and the password; nothing changes until both are right', async () => {
    const s = setup();
    const { c } = await account(s);
    expect((await c.post('/account/delete', { password: PASSWORD, confirm: 'delete' })).body.error).toBe('confirm_required');
    expect((await c.post('/account/delete', { password: 'wrong one!', confirm: 'DELETE' })).status).toBe(401);
    expect(s.store.users).toHaveLength(1);
    expect(s.store.erasures).toHaveLength(0);
    expect((await setup().client().post('/account/delete', { password: PASSWORD, confirm: 'DELETE' })).status).toBe(401);
  });

  it('only the owner can delete the workspace', async () => {
    const s = setup();
    await account(s);
    const viewer = s.client();
    await viewer.post('/auth/signup', { name: 'Ali', email: 'ali@example.com', password: PASSWORD });
    // Make Ali a viewer of Umar's workspace (invites come later in Phase 3): replace his own membership.
    const ali = s.store.users.find((u) => u.email === 'ali@example.com')!;
    const umarTenant = s.store.memberships.find((m) => m.role === 'owner' && !m.userId.equals(ali._id))!.tenantId;
    s.store.memberships = s.store.memberships.filter((m) => !m.userId.equals(ali._id));
    s.store.memberships.push({ _id: new ObjectId(), tenantId: umarTenant, userId: ali._id, role: 'viewer', createdAt: new Date() });
    const r = await viewer.post('/account/delete', { password: PASSWORD, confirm: 'DELETE' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('owner_only');
  });

  it('removes the account at once, stops collection, erases ClickHouse rows, and proves it before saying done', async () => {
    const s = setup();
    const { c, sites } = await account(s, 'umar@example.com', ['a.example.com', 'b.example.com']);
    await c.post(`/sites/${sites[0].id}/keys`); // a second key
    await c.post(`/sites/${sites[0].id}/exports`, { range: '7d' }).catch(() => undefined);
    const other = await account(s, 'someone@else.com', ['other.example.com']);
    const keys = s.store.sites.filter((x) => x._id !== other.sites[0].id).flatMap((x) => x.keys.map((k) => k.publicKey));
    expect(keys).toHaveLength(3);
    for (const k of keys) expect(await s.kv.get(kvName(k))).not.toBeNull();
    const t = s.clock.t;
    s.eraser.rows.push(
      row('events', sites[0].id, t - DAY),
      row('sessions', sites[0].id, t - DAY),
      row('events', sites[1].id, t - 2 * DAY),
      row('rollup_15m_pages', sites[1].id, t - DAY),
      row('events', other.sites[0].id, t - DAY),
    );
    s.mailer.sent.length = 0;

    const r = await c.post('/account/delete', { password: PASSWORD, confirm: 'DELETE' });
    expect(r.status).toBe(200);
    expect(r.body.erasure).toMatchObject({ sites: 2, trackingStopped: true, dataDeleteSent: true, finishesWithinDays: ERASURE_SETTLE_DAYS + 1 });
    expect(r.setCookie).toMatch(/^tw_session=;/);

    // MongoDB: nothing of this account is left; the other account is untouched.
    expect(s.store.users.map((u) => u.email)).toEqual(['someone@else.com']);
    expect(s.store.tenants).toHaveLength(1);
    expect(s.store.memberships).toHaveLength(1);
    expect(s.store.sites.map((x) => x.domain)).toEqual(['other.example.com']);
    expect(s.store.exports).toHaveLength(0);
    expect(s.store.audit.every((e) => e.tenantId.equals(s.store.tenants[0]!._id))).toBe(true);
    expect(s.store.sessions.every((x) => x.userId.equals(s.store.users[0]!._id))).toBe(true);
    // The collector no longer accepts any key of the account.
    for (const k of keys) expect(await s.kv.get(kvName(k))).toBeNull();
    // ClickHouse: deletes sent for both sites, the other account's rows stay.
    expect(s.eraser.rows.map((x) => x.site)).toEqual([other.sites[0].id]);
    expect(s.mailer.sent.map((m) => m.subject)).toEqual(['Your TailWatch account was deleted']);
    // Old session is dead; the e-mail address can sign up again.
    expect((await c.get('/me')).status).toBe(401);

    // Not complete before the settle time, even though the count is already zero.
    const e0 = s.store.erasures[0]!;
    expect(e0).toMatchObject({ status: 'pending', email: 'umar@example.com', rowsFound: { events: 2, sessions: 1, dropped_hits: 0, rollup_15m_pages: 1 } });
    expect(e0.kvDoneAt).not.toBeNull();
    await s.cron('/internal/maintenance');
    expect(s.store.erasures[0]!.status).toBe('pending');

    // A late event (a queue retry) lands after the delete: the next nights delete it again.
    s.eraser.rows.push(row('events', sites[0].id, s.clock.t));
    s.clock.t += ERASURE_SETTLE_DAYS * DAY;
    let run = await s.cron('/internal/maintenance');
    expect(run.body.erasures).toMatchObject({ advanced: 1, completed: 0 });
    expect(s.eraser.rows.map((x) => x.site)).toEqual([other.sites[0].id]);
    run = await s.cron('/internal/maintenance');
    expect(run.body.erasures).toMatchObject({ advanced: 1, completed: 1 });

    const done = s.store.erasures[0]!;
    expect(done).toMatchObject({ status: 'completed', email: null, name: null, lastError: null });
    expect(done.completedAt).not.toBeNull();
    expect(s.mailer.sent.map((m) => m.subject)).toEqual(['Your TailWatch account was deleted', 'Your TailWatch data has been erased']);
    expect(s.mailer.sent[1]!.text).toContain('4 stored rows');
    // The receipt holds no personal data.
    expect(JSON.stringify(done)).not.toContain('umar');

    // Watched for 30 days: a very late row (a dead letter replayed by hand) and a key written back by a
    // request that raced the deletion are removed again, without another e-mail.
    s.eraser.rows.push(row('events', sites[1].id, s.clock.t));
    await s.kv.put(kvName(keys[0]!), '{"stale":true}');
    s.clock.t += DAY; // the next night
    run = await s.cron('/internal/maintenance');
    expect(run.body.erasures).toMatchObject({ advanced: 1, completed: 0 });
    expect(s.eraser.rows.map((x) => x.site)).toEqual([other.sites[0].id]);
    expect(await s.kv.get(kvName(keys[0]!))).toBeNull();
    expect(s.store.erasures[0]!.rowsAfterCompletion).toBe(1);
    expect(s.mailer.sent).toHaveLength(2);
    s.clock.t += 31 * DAY;
    // The watch is over: nothing to do, and the record itself is removed.
    expect((await s.cron('/internal/maintenance')).body.erasures).toMatchObject({ advanced: 0, removed: 1 });
    expect(s.store.erasures).toHaveLength(0);

    expect((await s.client().post('/auth/signup', { name: 'Umar', email: 'umar@example.com', password: PASSWORD })).status).toBe(201);
  });

  it('Cloudflare or ClickHouse down at that moment: the account is still deleted, the nightly job finishes the rest', async () => {
    const s = setup();
    const { c, sites } = await account(s);
    const key = s.store.sites[0]!.keys[0]!.publicKey;
    s.eraser.rows.push(row('events', sites[0].id, s.clock.t - DAY));
    s.kv.down = true;
    s.eraser.down = true;
    const r = await c.post('/account/delete', { password: PASSWORD, confirm: 'DELETE' });
    expect(r.status).toBe(200);
    expect(r.body.erasure).toMatchObject({ trackingStopped: false, dataDeleteSent: false });
    expect(s.store.users).toHaveLength(0);
    expect(s.store.erasures[0]!.lastError).toMatch(/Cloudflare KV.*ClickHouse: ClickHouse 503/);
    expect(await s.kv.get(kvName(key))).not.toBeNull();

    s.kv.down = false;
    s.eraser.down = false;
    s.clock.t += ERASURE_SETTLE_DAYS * DAY;
    await s.cron('/internal/maintenance');
    expect(await s.kv.get(kvName(key))).toBeNull();
    expect(s.eraser.rows).toHaveLength(0);
    await s.cron('/internal/maintenance');
    expect(s.store.erasures[0]!.status).toBe('completed');
  });

  it('without the ClickHouse delete user the erasure waits (and says why) instead of claiming success', async () => {
    const s = setup({ eraser: false });
    const { c } = await account(s);
    await c.post('/account/delete', { password: PASSWORD, confirm: 'DELETE' });
    s.clock.t += 10 * DAY;
    await s.cron('/internal/maintenance');
    expect(s.store.erasures[0]).toMatchObject({ status: 'pending', lastError: expect.stringContaining('TW_CH_PRUNE_PASSWORD') });
  });

  it('a site created by a request that raced the deletion is found and erased too', async () => {
    const s = setup();
    const { c, sites } = await account(s);
    const tenantId = s.store.tenants[0]!._id;
    const site = { ...s.store.sites[0]! };
    await c.post('/account/delete', { password: PASSWORD, confirm: 'DELETE' });
    // The racing request's site lands after the transaction (same workspace id, a live key).
    const orphan = { ...site, _id: 9001, domain: 'late.example.com', tenantId, keys: [{ ...site.keys[0]!, id: 'k9', publicKey: 'tw_pub_' + 'L'.repeat(32) }] };
    s.store.sites.push(orphan);
    await s.kv.put(kvName(orphan.keys[0]!.publicKey), '{}');
    s.eraser.rows.push(row('events', 9001, s.clock.t));
    await s.cron('/internal/maintenance');
    expect(s.store.sites).toHaveLength(0);
    expect(await s.kv.get(kvName(orphan.keys[0]!.publicKey))).toBeNull();
    expect(s.eraser.rows).toHaveLength(0);
    expect(s.store.erasures[0]!.siteIds).toEqual([sites[0].id, 9001]);
  });

  it('an account without sites completes after the settle time', async () => {
    const s = setup();
    const { c } = await account(s, 'umar@example.com', []);
    await c.post('/account/delete', { password: PASSWORD, confirm: 'DELETE' });
    s.clock.t += ERASURE_SETTLE_DAYS * DAY;
    await s.cron('/internal/maintenance');
    expect(s.store.erasures[0]!.status).toBe('completed');
  });
});

describe('delete a site: keep its data, or erase it now', () => {
  it('keep (default): tracking stops, the data stays for the retention, adding the domain again brings it back', async () => {
    const s = setup();
    const { c, sites } = await account(s);
    s.eraser.rows.push(row('events', sites[0].id, s.clock.t));
    const r = await c.del(`/sites/${sites[0].id}`);
    expect(r.body).toMatchObject({ ok: true, erased: false });
    expect(s.store.sites[0]!.status).toBe('deleted');
    expect(s.eraser.rows).toHaveLength(1);
    expect(s.store.erasures).toHaveLength(0);
  });

  it('erase now: the site, its reports and every collected row go at once; the nightly job checks and watches', async () => {
    const s = setup();
    const { c, sites } = await account(s, 'umar@example.com', ['shop.example.com', 'blog.example.com']);
    const [shop, blog] = sites;
    s.eraser.rows.push(row('events', shop.id, s.clock.t), row('sessions', shop.id, s.clock.t), row('events', blog.id, s.clock.t));
    const at = new Date(s.clock.t);
    await s.store.insertExport({
      _id: new ObjectId(), tenantId: s.store.tenants[0]!._id, siteId: shop.id, range: '7d', from: '2026-10-05', to: '2026-10-11', timezone: 'Asia/Karachi',
      filename: 'shop.csv', rows: 1, bytes: 10, csv: 'date,visitors', createdBy: s.store.users[0]!._id, createdAt: at, expiresAt: new Date(at.getTime() + 90 * DAY),
    });

    const r = await c.raw('DELETE', `/sites/${shop.id}`, { eraseData: true });
    expect(r.body).toMatchObject({ ok: true, erased: true, sync: { ok: true } });
    expect(s.store.sites.map((x) => x.domain)).toEqual(['blog.example.com']);
    expect(s.store.exports).toHaveLength(0);
    expect(s.eraser.rows.map((x) => x.site)).toEqual([blog.id]);
    expect(s.kv.inner.entries.has(`site:${shop.publicKey}`)).toBe(false);
    expect(s.store.erasures[0]).toMatchObject({ siteIds: [shop.id], email: null, status: 'pending' });
    expect((await c.get('/audit')).body.entries[0].summary).toContain('all its collected data');

    // A late row (a queue retry) is removed by the nightly job, which then completes the erasure.
    s.eraser.rows.push(row('events', shop.id, s.clock.t));
    s.clock.t += ERASURE_SETTLE_DAYS * DAY;
    await s.cron('/internal/maintenance');
    expect(s.eraser.rows.map((x) => x.site)).toEqual([blog.id]);
    await s.cron('/internal/maintenance');
    expect(s.store.erasures[0]!.status).toBe('completed');
    expect(s.mailer.sent).toHaveLength(0); // no "account erased" mail for a site
  });

  it('erase needs the ClickHouse delete user; without it nothing changes', async () => {
    const s = setup({ eraser: false });
    const { c, sites } = await account(s);
    const r = await c.raw('DELETE', `/sites/${sites[0].id}`, { eraseData: true });
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('erase_unavailable');
    expect(s.store.sites[0]!.status).toBe('active');
  });
});
