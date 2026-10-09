import { describe, expect, it } from 'vitest';
import { SITE_KEY_RE, validate } from '@tailwatch/contract';
import type { SiteConfig } from '@tailwatch/contract';
import { BROWSER_UA } from '../../../packages/contract/fixtures/payloads';
import { createApp, SESSION_COOKIE } from '../src/app';
import type { AnalyticsReader, RecentActivity } from '../src/analytics';
import { defaultConfig } from '../src/config';
import { MemoryKv } from '../src/kv';
import type { SiteConfigSink } from '../src/kv';
import { MemoryStore } from '../src/store/memory';

/** Cheap scrypt for tests; production uses N = 2^17 (passwords.ts). */
const FAST = { N: 1024, r: 8, p: 1 };
const COLLECTOR = 'https://collector.test';
const HOST = 'app.test';

class FakeAnalytics implements AnalyticsReader {
  next: RecentActivity = { events: 0, pageviews: 0, last: null, drops: [] };
  async recent() {
    return this.next;
  }
}

class FlakyKv implements SiteConfigSink {
  inner = new MemoryKv();
  down = false;
  async put(n: string, v: string) {
    if (this.down) throw new Error('Cloudflare KV PUT 503: unavailable');
    return this.inner.put(n, v);
  }
  async delete(n: string) {
    if (this.down) throw new Error('Cloudflare KV DELETE 503: unavailable');
    return this.inner.delete(n);
  }
}

function setup(over: Partial<Parameters<typeof defaultConfig>[0]> = {}, fetchImpl?: typeof fetch) {
  const store = new MemoryStore();
  const kv = new FlakyKv();
  const analytics = new FakeAnalytics();
  const app = createApp({
    store,
    kv,
    analytics,
    config: defaultConfig({ collectorUrl: COLLECTOR, secureCookies: false, scrypt: FAST, ...over }),
    verifier: fetchImpl ? { fetchImpl, resolve: async () => ['93.184.216.34'] } : undefined,
  });

  /** A browser-like client: keeps the session cookie, sends same-origin JSON. */
  const client = () => {
    let cookie = '';
    const call = async (method: string, path: string, json?: unknown, headers: Record<string, string> = {}) => {
      const res = await app.request(`http://${HOST}/api/v1${path}`, {
        method,
        headers: {
          host: HOST,
          ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set?.startsWith(`${SESSION_COOKIE}=`)) cookie = set.split(';')[0]!;
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null, raw: text, setCookie: set };
    };
    return {
      get: (p: string, h?: Record<string, string>) => call('GET', p, undefined, h),
      post: (p: string, j: unknown = {}, h?: Record<string, string>) => call('POST', p, j, h),
      patch: (p: string, j: unknown) => call('PATCH', p, j),
      del: (p: string) => call('DELETE', p, {}),
      raw: call,
    };
  };
  return { store, kv, analytics, app, client };
}

async function signedUp(s: ReturnType<typeof setup>, email = 'umar@example.com') {
  const c = s.client();
  const r = await c.post('/auth/signup', { name: 'Umar', email, password: 'correct horse' });
  expect(r.status).toBe(201);
  return c;
}

describe('① sign up / log in', () => {
  it('signup creates user + tenant + owner membership and a session cookie', async () => {
    const s = setup();
    const c = s.client();
    const r = await c.post('/auth/signup', { name: 'Umar', email: 'Umar@Example.com', password: 'correct horse' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: 'Umar@Example.com', name: 'Umar' });
    expect(r.setCookie).toMatch(/^tw_session=[\w-]{43}; .*HttpOnly/);
    expect(r.setCookie).toMatch(/SameSite=Lax/);
    expect(s.store.users).toHaveLength(1);
    expect(s.store.tenants).toHaveLength(1);
    expect(s.store.memberships[0]!.role).toBe('owner');
    // The password and the raw session token are never stored.
    expect(s.store.users[0]!.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify(s.store.sessions)).not.toContain(r.setCookie!.split(';')[0]!.split('=')[1]);
    expect((await c.get('/me')).body.user.email).toBe('Umar@Example.com');
  });

  it('the same e-mail in other letter case is refused', async () => {
    const s = setup();
    await signedUp(s, 'a@b.co');
    const r = await s.client().post('/auth/signup', { name: 'X', email: 'A@B.CO', password: 'another one' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('email_taken');
  });

  it('rejects bad input with a message the form can show', async () => {
    const c = setup().client();
    expect((await c.post('/auth/signup', { name: 'U', email: 'nope', password: 'correct horse' })).body.error).toBe('invalid_email');
    expect((await c.post('/auth/signup', { name: 'U', email: 'a@b.co', password: 'short' })).body.error).toBe('invalid_password');
    expect((await c.post('/auth/signup', { name: '', email: 'a@b.co', password: 'correct horse' })).body.error).toBe('invalid_name');
  });

  it('login: wrong password and unknown e-mail get the same answer', async () => {
    const s = setup();
    await signedUp(s);
    const c = s.client();
    const wrong = await c.post('/auth/login', { email: 'umar@example.com', password: 'nope nope' });
    const unknown = await c.post('/auth/login', { email: 'ghost@example.com', password: 'nope nope' });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);
    const ok = await c.post('/auth/login', { email: 'UMAR@example.com', password: 'correct horse' });
    expect(ok.status).toBe(200);
    expect((await c.get('/me')).status).toBe(200);
  });

  it('login is rate limited per e-mail', async () => {
    const s = setup();
    await signedUp(s);
    const c = s.client();
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await c.post('/auth/login', { email: 'umar@example.com', password: 'wrong wrong' })).status;
    expect(last).toBe(429);
  });

  it('a public server only lets allow-listed e-mails sign up (TW_SIGNUP_ALLOWLIST)', async () => {
    const s = setup({ signupAllowlist: ['umar@example.com', '@team.test'] });
    const c = s.client();
    const stranger = await c.post('/auth/signup', { name: 'X', email: 'someone@else.com', password: 'correct horse' });
    expect(stranger.status).toBe(403);
    expect(stranger.body.error).toBe('signup_closed');
    expect((await s.client().post('/auth/signup', { name: 'Umar', email: 'UMAR@example.com', password: 'correct horse' })).status).toBe(201);
    expect((await s.client().post('/auth/signup', { name: 'Sara', email: 'sara@team.test', password: 'correct horse' })).status).toBe(201);
  });

  it('login is also rate limited per client address, across e-mails (password spraying)', async () => {
    const s = setup();
    const c = s.client();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await c.post('/auth/login', { email: `user${i}@example.com`, password: 'wrong wrong' }, { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' })).status);
    }
    expect(statuses.slice(0, 30).every((x) => x === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
    // The address is the proxy-appended LAST entry: a client cannot dodge the limit by changing the first one.
    const other = await c.post('/auth/login', { email: 'next@example.com', password: 'wrong wrong' }, { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' });
    expect(other.status).toBe(429);
  });

  it('logout ends the session', async () => {
    const s = setup();
    const c = await signedUp(s);
    expect((await c.post('/auth/logout')).status).toBe(200);
    expect((await c.get('/me')).status).toBe(401);
  });

  it('one backend for every client: the same session works as a Bearer token (WordPress plugin, mobile app)', async () => {
    const s = setup();
    const r = await s.client().post('/auth/signup', { name: 'App', email: 'app@example.com', password: 'correct horse', token: true });
    expect(r.body.token).toMatch(/^[\w-]{43}$/);
    const bare = s.client();
    expect((await bare.get('/me')).status).toBe(401);
    expect((await bare.get('/me', { authorization: `Bearer ${r.body.token}` })).body.user.email).toBe('app@example.com');
  });

  it('CSRF: cookie writes must be same-origin JSON', async () => {
    const s = setup();
    const c = await signedUp(s);
    const form = await c.raw('POST', '/sites', undefined, { 'content-type': 'application/x-www-form-urlencoded' });
    expect(form.status).toBe(400);
    const cross = await c.post('/sites', { domain: 'x.com', timezone: 'UTC' }, { origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
  });
});

describe('② add a site', () => {
  it('normalises the domain, derives hosts, canonicalises the timezone, reserves low ids', async () => {
    const s = setup();
    const c = await signedUp(s);
    const r = await c.post('/sites', { domain: ' https://www.Shop.Example.com/pricing ', timezone: 'asia/karachi' });
    expect(r.status).toBe(201);
    expect(r.body.site).toMatchObject({
      domain: 'shop.example.com',
      allowedHosts: ['shop.example.com', '*.shop.example.com'],
      timezone: 'Asia/Karachi',
      status: 'active',
      verifiedAt: null,
    });
    expect(r.body.site.id).toBe(101);
    expect(r.body.site.publicKey).toMatch(SITE_KEY_RE);
    expect(r.body.sync).toEqual({ ok: true });
    expect((await c.post('/sites', { domain: 'second.example', timezone: 'UTC' })).body.site.id).toBe(102);
  });

  it('preview shows the normalised domain and accepted hosts before submit', async () => {
    const c = await signedUp(setup());
    expect((await c.get('/sites/preview?domain=https://WWW.example.com/x')).body).toEqual({
      domain: 'example.com',
      allowedHosts: ['example.com', '*.example.com'],
    });
    expect((await c.get('/sites/preview?domain=localhost')).status).toBe(400);
  });

  it('refuses IPs, localhost, junk and unknown timezones', async () => {
    const c = await signedUp(setup());
    for (const domain of ['127.0.0.1', 'localhost', 'not a domain', '']) {
      expect((await c.post('/sites', { domain, timezone: 'UTC' })).body.error).toBe('invalid_domain');
    }
    expect((await c.post('/sites', { domain: 'ok.com', timezone: 'Mars/Olympus' })).body.error).toBe('invalid_timezone');
  });

  it('KV gets exactly what the collector needs, and the collector accepts a hit with it', async () => {
    const s = setup();
    const c = await signedUp(s);
    const { site } = (await c.post('/sites', { domain: 'example.com', timezone: 'UTC' })).body;
    const entry = JSON.parse(s.kv.inner.entries.get(`site:${site.publicKey}`)!) as SiteConfig;
    expect(entry).toMatchObject({ id: site.id, publicKey: site.publicKey, allowedHosts: ['example.com', '*.example.com'], live: true, region: 'in' });
    expect(entry.identitySecret).toMatch(/^[0-9a-f]{64}$/);
    const hit = JSON.stringify({ s: site.publicKey, n: 'pageview', u: 'https://www.example.com/', q: 1, t: Date.now(), v: 2 });
    const outcome = validate(new Headers({ 'user-agent': BROWSER_UA }), hit, { receivedAt: Date.now(), site: entry });
    expect(outcome.kind).toBe('accept');
  });

  it('never returns the identity secret to a client', async () => {
    const s = setup();
    const c = await signedUp(s);
    const created = await c.post('/sites', { domain: 'example.com', timezone: 'UTC' });
    const secret = s.store.sites[0]!.identitySecret;
    for (const r of [created, await c.get('/sites'), await c.get(`/sites/${created.body.site.id}`)]) expect(r.raw).not.toContain(secret);
  });

  it('one domain once per tenant; other tenants cannot see or touch it', async () => {
    const s = setup();
    const a = await signedUp(s, 'a@example.com');
    const b = await signedUp(s, 'b@example.com');
    const { site } = (await a.post('/sites', { domain: 'example.com', timezone: 'UTC' })).body;
    expect((await a.post('/sites', { domain: 'www.example.com', timezone: 'UTC' })).body.error).toBe('domain_taken');
    expect((await b.get(`/sites/${site.id}`)).status).toBe(404);
    expect((await b.del(`/sites/${site.id}`)).status).toBe(404);
    expect((await b.get('/sites')).body.sites).toEqual([]);
    expect((await b.post('/sites', { domain: 'example.com', timezone: 'UTC' })).status).toBe(201); // their own copy
  });

  it('a KV outage is reported, the site is kept, and "retry activation" fixes it', async () => {
    const s = setup();
    const c = await signedUp(s);
    s.kv.down = true;
    const r = await c.post('/sites', { domain: 'example.com', timezone: 'UTC' });
    expect(r.status).toBe(201);
    expect(r.body.sync.ok).toBe(false);
    expect(r.body.sync.message).toContain('Retry activation');
    expect(s.kv.inner.entries.size).toBe(0);
    s.kv.down = false;
    expect((await c.post(`/sites/${r.body.site.id}/sync`)).body.sync).toEqual({ ok: true });
    expect(s.kv.inner.entries.size).toBe(1);
  });
});

describe('③ snippets: generated by the server only', () => {
  it('every install method carries the site key and the collector', async () => {
    const c = await signedUp(setup());
    const { site } = (await c.post('/sites', { domain: 'example.com', timezone: 'UTC' })).body;
    const { snippets } = (await c.get(`/sites/${site.id}`)).body;
    expect(snippets.map((x: { id: string }) => x.id)).toEqual(['script-tag', 'npm', 'next', 'react', 'vue', 'svelte', 'wordpress']);
    expect(snippets[0].code).toBe(`<script async fetchpriority="low" src="${COLLECTOR}/tw.js?id=${site.publicKey}"></script>`);
    for (const x of snippets) expect(x.code).toContain(site.publicKey);
    expect(snippets.find((x: { id: string }) => x.id === 'next').code).toContain(`api="${COLLECTOR}/e"`);
  });
});

describe('keys: rotation without losing a hit', () => {
  it('add -> both active in KV -> revoke old -> old deleted from KV; the last key cannot be revoked', async () => {
    const s = setup();
    const c = await signedUp(s);
    const { site } = (await c.post('/sites', { domain: 'example.com', timezone: 'UTC' })).body;
    const old = site.keys[0];
    const rotated = (await c.post(`/sites/${site.id}/keys`)).body.site;
    expect(rotated.keys.filter((k: { status: string }) => k.status === 'active')).toHaveLength(2);
    expect(rotated.publicKey).not.toBe(old.publicKey); // new snippets use the new key
    expect(s.kv.inner.entries.size).toBe(2);
    const revoked = (await c.post(`/sites/${site.id}/keys/${old.id}/revoke`)).body.site;
    expect(revoked.keys.find((k: { id: string }) => k.id === old.id).status).toBe('revoked');
    expect(s.kv.inner.entries.has(`site:${old.publicKey}`)).toBe(false);
    expect(s.kv.inner.entries.has(`site:${rotated.publicKey}`)).toBe(true);
    const last = rotated.keys.find((k: { id: string }) => k.id !== old.id);
    expect((await c.post(`/sites/${site.id}/keys/${last.id}/revoke`)).body.error).toBe('last_key');
  });

  it('pause sets live=false in KV; delete removes every key; re-adding restores the same site id', async () => {
    const s = setup();
    const c = await signedUp(s);
    const { site } = (await c.post('/sites', { domain: 'example.com', timezone: 'UTC' })).body;
    await c.patch(`/sites/${site.id}`, { status: 'paused' });
    expect(JSON.parse(s.kv.inner.entries.get(`site:${site.publicKey}`)!).live).toBe(false);
    expect((await c.del(`/sites/${site.id}`)).body.sync).toEqual({ ok: true });
    expect(s.kv.inner.entries.size).toBe(0);
    expect((await c.get('/sites')).body.sites).toEqual([]);
    const again = (await c.post('/sites', { domain: 'example.com', timezone: 'Europe/London' })).body.site;
    expect(again.id).toBe(site.id);
    expect(again.publicKey).not.toBe(site.publicKey);
    expect(again.timezone).toBe('Europe/London');
    expect([...s.kv.inner.entries.keys()]).toEqual([`site:${again.publicKey}`]);
  });
});

describe('④/⑤ passive check: waiting for the first pageview', () => {
  it('reports activity and drops, and marks the site verified on the first pageview', async () => {
    const s = setup();
    const c = await signedUp(s);
    const { site } = (await c.post('/sites', { domain: 'example.com', timezone: 'UTC' })).body;
    let st = (await c.get(`/sites/${site.id}/status`)).body;
    expect(st).toMatchObject({ events: 0, verifiedAt: null, windowMinutes: 30 });
    s.analytics.next = {
      events: 1,
      pageviews: 1,
      last: { at: '2026-10-08T10:00:00.000Z', name: 'pageview', path: '/' },
      drops: [{ reason: 'hostname', hits: 3, detail: 'staging.other.io' }],
    };
    st = (await c.get(`/sites/${site.id}/status`)).body;
    expect(st.pageviews).toBe(1);
    expect(st.verifiedAt).not.toBeNull();
    expect(st.drops[0].reason).toBe('hostname');
    expect((await c.get(`/sites/${site.id}`)).body.site.verifiedAt).toBe(st.verifiedAt);
  });

  it('a ClickHouse failure is a 503 with a readable message', async () => {
    const s = setup();
    const c = await signedUp(s);
    const { site } = (await c.post('/sites', { domain: 'example.com', timezone: 'UTC' })).body;
    s.analytics.recent = async () => {
      throw new Error('ClickHouse 516');
    };
    const r = await c.get(`/sites/${site.id}/status`);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('analytics_unavailable');
  });
});

describe('the in-memory store enforces the real MongoDB validators', () => {
  it('a site document that breaks control-plane.schema.json is refused', async () => {
    const s = setup();
    await signedUp(s);
    const tenantId = s.store.tenants[0]!._id;
    const now = new Date();
    await expect(
      s.store.insertSite({
        _id: 5, tenantId, domain: 'x.com', timezone: 'UTC', allowedHosts: ['x.com'], retentionDays: 395, status: 'active', region: 'in',
        verifiedAt: null, identitySecret: 'short', keys: [{ id: 'k', publicKey: 'tw_pub_bad', createdAt: now, status: 'active' }],
        createdAt: now, updatedAt: now,
      }),
    ).rejects.toThrow(/validation/);
  });
});
