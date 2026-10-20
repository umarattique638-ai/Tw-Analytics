import { describe, expect, it } from 'vitest';
import { createApp, SESSION_COOKIE } from '../src/app';
import { defaultConfig, parseSuperAdmins } from '../src/config';
import { MemoryKv } from '../src/repositories/kv';
import { MemoryStore } from '../src/repositories/memory-store';
import type { StatsReader } from '../src/repositories/stats';
import { MemoryMailer } from '../src/services/mail';
import { addSite, fakeVerifier } from './helpers/install';

/** Super admin (/admin, owner 2026-10-20): every account, delete accounts and sites, download reports. */
const FAST = { N: 1024, r: 8, p: 1 };
const COLLECTOR = 'https://collector.test';
const HOST = 'app.test';
const ADMIN = 'team@tailwatch.test';

const stats = {
  overview: async () => ({ series: [{ bucket: '2026-10-19', label: 'Oct 19', visitors: 3, sessions: 4, pageviews: 9 }] }),
} as unknown as StatsReader;

function setup() {
  const store = new MemoryStore();
  const kv = new MemoryKv();
  const mailer = new MemoryMailer();
  const app = createApp({
    store,
    kv,
    mailer,
    analytics: { recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }) },
    stats,
    config: defaultConfig({ collectorUrl: COLLECTOR, secureCookies: false, scrypt: FAST, superAdmins: [ADMIN] }),
    verifier: fakeVerifier(kv.entries, COLLECTOR),
    now: (() => {
      let t = Date.now();
      return () => new Date((t += 1));
    })(),
  });
  const client = () => {
    let cookie = '';
    const call = async (method: string, path: string, json?: unknown) => {
      const res = await app.request(`http://${HOST}/api/v1${path}`, {
        method,
        headers: { host: HOST, ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set?.startsWith(`${SESSION_COOKIE}=`)) cookie = set.split(';')[0]!;
      const text = await res.text();
      const type = res.headers.get('content-type') ?? '';
      return { status: res.status, body: text && type.includes('json') ? JSON.parse(text) : null, raw: text, headers: res.headers };
    };
    return {
      get: (p: string) => call('GET', p),
      post: (p: string, j: unknown = {}) => call('POST', p, j),
      del: (p: string, j: unknown = {}) => call('DELETE', p, j),
      addSite: (domain: string) => addSite((p, j) => call('POST', p, j), kv.entries, domain, 'Asia/Karachi'),
    };
  };
  const signUp = async (email: string, name: string) => {
    const c = client();
    expect((await c.post('/auth/signup', { name, email, password: 'correct horse' })).status).toBe(201);
    return c;
  };
  return { store, kv, mailer, client, signUp };
}

describe('super admin', () => {
  it('who is one: TW_ADMIN_EMAILS, else TW_OWNER_EMAIL; plain addresses only', () => {
    expect(parseSuperAdmins(' A@X.com, @team.com, *, b@y.io ', 'owner@z.com')).toEqual(['a@x.com', 'b@y.io']);
    expect(parseSuperAdmins(undefined, 'Owner@Z.com')).toEqual(['owner@z.com']);
    expect(parseSuperAdmins('', null)).toEqual([]);
  });

  it('only super admins see /admin; everyone else gets "no such endpoint", and /me says which', async () => {
    const s = setup();
    const customer = await s.signUp('umar@shop.test', 'Umar');
    const team = await s.signUp(ADMIN, 'Team');
    expect((await customer.get('/me')).body.superAdmin).toBe(false);
    expect((await team.get('/me')).body.superAdmin).toBe(true);
    for (const path of ['/admin/overview', '/admin/accounts']) {
      const r = await customer.get(path);
      expect(r.status, path).toBe(404);
      expect(r.body.error).toBe('not_found');
    }
    expect((await s.client().get('/admin/overview')).status).toBe(401); // not signed in at all
    expect((await team.get('/admin/overview')).status).toBe(200);
  });

  it('an unconfirmed address is not a super admin, even when listed', async () => {
    const s = setup();
    const team = await s.signUp(ADMIN, 'Team');
    s.store.users[0]!.emailVerifiedAt = null;
    expect((await team.get('/admin/overview')).status).toBe(404);
  });

  it('sees every account with its people and sites, finds by e-mail or domain, never a secret', async () => {
    const s = setup();
    const umar = await s.signUp('umar@shop.test', 'Umar');
    await umar.addSite('shop.test');
    const sara = await s.signUp('sara@blog.test', 'Sara');
    await sara.addSite('blog.test');
    const team = await s.signUp(ADMIN, 'Team');

    const overview = (await team.get('/admin/overview')).body;
    expect(overview).toMatchObject({ accounts: 3, users: 3, sites: { active: 2, paused: 0, deleted: 0 }, kvIssues: 0, pendingErasures: 0 });

    const all = (await team.get('/admin/accounts')).body.accounts;
    expect(all.map((a: { owner: { email: string } }) => a.owner.email)).toEqual([ADMIN, 'sara@blog.test', 'umar@shop.test']); // newest first
    const found = (await team.get('/admin/accounts?q=blog')).body.accounts;
    expect(found).toHaveLength(1);
    expect(found[0].sites).toEqual([{ id: expect.any(Number), domain: 'blog.test', status: 'active' }]);

    const umarId = all.find((a: { owner: { email: string } }) => a.owner.email === 'umar@shop.test').id;
    const r = await team.get(`/admin/accounts/${umarId}`);
    expect(r.status).toBe(200);
    expect(r.body.account.people).toEqual([expect.objectContaining({ email: 'umar@shop.test', role: 'owner', verified: true })]);
    expect(r.body.account.siteList[0]).toMatchObject({ domain: 'shop.test', status: 'active', health: { status: expect.any(String) } });
    expect(r.body.account.activity.map((e: { action: string }) => e.action)).toContain('site.created');
    // Nothing private: no password hash, identity secret or whole site key.
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain('scrypt$');
    expect(raw).not.toContain(s.store.sites[0]!.identitySecret);
    expect(raw).not.toContain(s.store.sites[0]!.keys[0]!.publicKey);

    expect((await team.get('/admin/accounts/nonsense')).status).toBe(404);
    expect((await team.get('/admin/accounts/0123456789abcdef01234567')).status).toBe(404);
  });

  it("downloads a site's report, and the customer's activity log says the team did", async () => {
    const s = setup();
    const umar = await s.signUp('umar@shop.test', 'Umar');
    const site = (await umar.addSite('shop.test')).body.site;
    const team = await s.signUp(ADMIN, 'Team');

    const r = await team.get(`/admin/sites/${site.id}/report.csv?range=30d`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-disposition')).toMatch(/attachment; filename="shop\.test-.+\.csv"/);
    expect(r.raw).toBe('date,visitors,sessions,pageviews\n2026-10-19,3,4,9\n');
    expect((await team.get(`/admin/sites/${site.id}/report.csv?range=1y`)).status).toBe(400);

    const log = (await umar.get('/audit')).body.entries;
    expect(log[0]).toMatchObject({ action: 'support.report_downloaded', actor: { kind: 'system', name: 'TailWatch' }, domain: 'shop.test' });
    expect(log[0].summary).toMatch(/^The TailWatch team downloaded a report of shop\.test/);
  });

  it('deletes a site (keeping its data): tracking stops and the customer sees who did it', async () => {
    const s = setup();
    const umar = await s.signUp('umar@shop.test', 'Umar');
    const site = (await umar.addSite('shop.test')).body.site;
    const team = await s.signUp(ADMIN, 'Team');

    const r = await team.del(`/admin/sites/${site.id}`, {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, erased: false, sync: { ok: true } });
    expect(s.store.sites[0]!.status).toBe('deleted');
    expect(s.kv.entries.has(`site:${site.publicKey}`)).toBe(false); // the collector no longer accepts the key
    expect((await umar.get('/sites')).body.sites).toEqual([]);
    const line = (await umar.get('/audit')).body.entries[0];
    expect(line).toMatchObject({ action: 'site.deleted', actor: { kind: 'system' } });
    expect(line.summary).toMatch(/by the TailWatch team$/);
    expect((await team.del(`/admin/sites/${site.id}`, {})).status).toBe(409); // already deleted
    expect((await team.del('/admin/sites/999999', {})).status).toBe(404);
  });

  it("deletes an account (typed confirmation; never the team's own): the owner is told and cannot log in", async () => {
    const s = setup();
    const umar = await s.signUp('umar@shop.test', 'Umar');
    await umar.addSite('shop.test');
    const team = await s.signUp(ADMIN, 'Team');
    const accounts = (await team.get('/admin/accounts')).body.accounts;
    const umarId = accounts.find((a: { owner: { email: string } }) => a.owner.email === 'umar@shop.test').id;
    const teamId = accounts.find((a: { owner: { email: string } }) => a.owner.email === ADMIN).id;

    expect((await team.post(`/admin/accounts/${umarId}/delete`, {})).body.error).toBe('confirm_required');
    expect((await team.post(`/admin/accounts/${teamId}/delete`, { confirm: 'DELETE' })).body.error).toBe('own_account');

    const r = await team.post(`/admin/accounts/${umarId}/delete`, { confirm: 'DELETE' });
    expect(r.status).toBe(200);
    expect(r.body.erasure).toMatchObject({ id: umarId, sites: 1, finishesWithinDays: 3 });
    const mail = s.mailer.sent.find((m) => m.subject === 'Your TailWatch account was deleted');
    expect(mail?.to).toBe('umar@shop.test');
    expect(mail?.text).toContain('deleted just now by the TailWatch team');
    expect(s.store.users.map((u) => u.email)).toEqual([ADMIN]);
    expect(s.store.sites).toEqual([]);
    expect((await umar.get('/me')).status).toBe(401); // the session went with the account
    expect((await s.client().post('/auth/login', { email: 'umar@shop.test', password: 'correct horse' })).status).toBe(401);
    expect((await team.get(`/admin/accounts/${umarId}`)).status).toBe(404);
  });
});
