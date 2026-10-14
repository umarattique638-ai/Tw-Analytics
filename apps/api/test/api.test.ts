import { describe, expect, it } from 'vitest';
import { SITE_KEY_RE, validate } from '@tailwatch/contract';
import type { SiteConfig } from '@tailwatch/contract';
import { BROWSER_UA } from '../../../packages/contract/fixtures/payloads';
import { createApp, SESSION_COOKIE } from '../src/app';
import type { AnalyticsReader, RecentActivity } from '../src/analytics';
import { defaultConfig, parseAllowlist } from '../src/config';
import { configFromEnv } from '../src/runtime';
import { MemoryKv } from '../src/kv';
import type { PutOptions, SiteConfigSink } from '../src/kv';
import { MemoryStore } from '../src/store/memory';
import { addSite, fakeVerifier, markSeen } from './helpers/install';

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
  failWith: string | null = null;
  /** Runs once, inside the next put (to interleave another request). */
  onPut: (() => Promise<void>) | null = null;
  async put(n: string, v: string, o?: PutOptions) {
    if (this.onPut) {
      const hook = this.onPut;
      this.onPut = null;
      await hook();
    }
    if (this.failWith) throw new Error(this.failWith);
    if (this.down) throw new Error('Cloudflare KV PUT 503: unavailable');
    return this.inner.put(n, v, o);
  }
  async delete(n: string) {
    if (this.down) throw new Error('Cloudflare KV DELETE 503: unavailable');
    return this.inner.delete(n);
  }
  async get(n: string) {
    if (this.down) throw new Error('Cloudflare KV GET 503: unavailable');
    return this.inner.get(n);
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
    verifier: fetchImpl ? { fetchImpl, resolve: async () => ['93.184.216.34'] } : fakeVerifier(kv.inner.entries, COLLECTOR),
    // Every call a later millisecond, like real requests (updatedAt is the optimistic-concurrency check).
    now: (() => {
      let t = Date.now();
      return () => new Date((t += 1));
    })(),
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
      /** The whole install (decision 25): setup, snippet on the page, first pageview, check -> saved site. */
      addSite: (domain: string, timezone: string) => addSite((p, j) => call('POST', p, j), kv.inner.entries, domain, timezone),
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

  it('sign-up is open to everyone by default, also on a public https server', async () => {
    const config = configFromEnv({ TW_COLLECTOR_URL: 'https://c.example.workers.dev' }, 'https://dash.example.com');
    expect(config.signupAllowlist).toBeNull();
    expect(parseAllowlist('*')).toBeNull();
    expect(parseAllowlist(' , ')).toBeNull();
    const s = setup({ signupAllowlist: config.signupAllowlist });
    expect((await s.client().post('/auth/signup', { name: 'New', email: 'new.customer@anywhere.io', password: 'correct horse' })).status).toBe(201);
  });

  it('an optional TW_SIGNUP_ALLOWLIST limits sign-up to listed e-mails and domains', async () => {
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
    const form = await c.raw('POST', '/setup', undefined, { 'content-type': 'application/x-www-form-urlencoded' });
    expect(form.status).toBe(400);
    const cross = await c.post('/setup', { domain: 'x.com', timezone: 'UTC' }, { origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
  });
});

describe('② add a site (decision 25: nothing is stored until every check passed)', () => {
  it('normalises the domain, derives hosts, canonicalises the timezone, reserves low ids', async () => {
    const s = setup();
    const c = await signedUp(s);
    const started = await c.post('/setup', { domain: ' https://www.Shop.Example.com/pricing ', timezone: 'asia/karachi' });
    expect(started.status).toBe(201);
    expect(started.body.setup).toMatchObject({ domain: 'shop.example.com', allowedHosts: ['shop.example.com', '*.shop.example.com'], timezone: 'Asia/Karachi', seen: null });
    expect(started.body.setup.publicKey).toMatch(SITE_KEY_RE);
    const r = await c.addSite('shop.example.com', 'Asia/Karachi');
    expect(r.body.site).toMatchObject({ domain: 'shop.example.com', timezone: 'Asia/Karachi', status: 'active', publicKey: started.body.setup.publicKey });
    expect(r.body.site.verifiedAt).not.toBeNull();
    expect(r.body.site.id).toBe(101);
    expect((await c.addSite('second.example', 'UTC')).body.site.id).toBe(102);
  });

  it('starting a setup stores NOTHING in MongoDB: only KV entries that expire by themselves', async () => {
    const s = setup();
    const c = await signedUp(s);
    const sitesBefore = s.store.sites.length;
    const auditBefore = s.store.audit.length;
    const { setup: st } = (await c.post('/setup', { domain: 'example.com', timezone: 'UTC' })).body;
    expect(s.store.sites).toHaveLength(sitesBefore);
    expect(s.store.audit).toHaveLength(auditBefore);
    expect((await c.get('/sites')).body.sites).toEqual([]);
    const entry = JSON.parse(s.kv.inner.entries.get(`site:${st.publicKey}`)!) as SiteConfig;
    expect(entry).toMatchObject({ id: 0, setup: true, live: true, allowedHosts: ['example.com', '*.example.com'] });
    expect(entry.identitySecret).toBeUndefined();
    for (const name of [`site:${st.publicKey}`, `setup:${s.store.tenants[0]!._id.toHexString()}`]) expect(s.kv.inner.ttls.get(name)).toBe(7 * 86_400);
    // GET /setup brings it back after a reload, with its snippet.
    const again = (await c.get('/setup')).body.setup;
    expect(again.publicKey).toBe(st.publicKey);
    expect(again.snippets[0].code).toContain(st.publicKey);
  });

  it('a failing check stores nothing; all checks + a real pageview save the site, verified', async () => {
    let html = '<html><head></head></html>';
    const fetchImpl = (async (input: URL | string) => {
      const url = String(input);
      if (url === 'https://example.com/') return new Response(html, { headers: { 'content-type': 'text/html' } });
      if (url.startsWith(`${COLLECTOR}/tw.js`)) return new Response('tw', { headers: { 'content-type': 'application/javascript' } });
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const s = setup({}, fetchImpl);
    const c = await signedUp(s);
    const { setup: st } = (await c.post('/setup', { domain: 'example.com', timezone: 'UTC' })).body;

    // The snippet is missing (a pageview noted anyway): the check stops at the first failure, nothing saved.
    markSeen(s.kv.inner.entries, st.publicKey);
    let r = (await c.post('/setup/verify', {})).body;
    expect(r.checks.map((x: { id: string; status: string }) => `${x.id}:${x.status}`)).toEqual([
      'reach:pass', 'present:fail', 'noscript:skip', 'once:skip', 'script:skip', 'csp:skip', 'id:skip',
    ]);
    expect(r.site).toBeNull();
    expect(s.store.sites).toHaveLength(0);

    // Every check passes, but no pageview yet: still nothing saved.
    s.kv.inner.entries.delete(`seen:${st.publicKey}`);
    html = `<html><head><script async src="${COLLECTOR}/tw.js?id=${st.publicKey}"></script></head></html>`;
    r = (await c.post('/setup/verify', {})).body;
    expect(r.ok).toBe(true);
    expect(r.seen).toBeNull();
    expect(r.site).toBeNull();
    expect(s.store.sites).toHaveLength(0);

    // Both: saved now, verified, on the same key; the collector entry is the real site; setup notes gone.
    markSeen(s.kv.inner.entries, st.publicKey, '/pricing');
    r = (await c.post('/setup/verify', {})).body;
    expect(r.seen.path).toBe('/pricing');
    expect(r.site).toMatchObject({ id: 101, domain: 'example.com', publicKey: st.publicKey });
    expect(r.verifiedAt).not.toBeNull();
    expect(s.store.sites).toHaveLength(1);
    const entry = JSON.parse(s.kv.inner.entries.get(`site:${st.publicKey}`)!) as SiteConfig;
    expect(entry).toMatchObject({ id: 101, live: true });
    expect(entry.setup).toBeUndefined();
    expect(entry.identitySecret).toMatch(/^[0-9a-f]{64}$/);
    expect(s.kv.inner.ttls.has(`site:${st.publicKey}`)).toBe(false);
    expect([...s.kv.inner.entries.keys()].filter((k) => k.startsWith('setup:') || k.startsWith('seen:'))).toEqual([]);
    expect((await c.get('/setup')).body.setup).toBeNull();
    expect(s.store.audit.some((e) => e.action === 'site.created')).toBe(true);
  });

  it('a domain where nothing answers is refused before anything is created', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const s = setup({ checkDomainReachable: true }, fetchImpl);
    const c = await signedUp(s);
    const r = await c.post('/setup', { domain: 'asdasdasdasdasdzxc.com', timezone: 'UTC' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('domain_unreachable');
    expect(r.body.message).toContain("couldn't reach asdasdasdasdasdzxc.com");
    expect(s.kv.inner.entries.size).toBe(0);
    expect(s.store.sites).toHaveLength(0);
  });

  it('the same domain again keeps the key; another domain replaces the setup; cancel leaves nothing', async () => {
    const s = setup();
    const c = await signedUp(s);
    const first = (await c.post('/setup', { domain: 'example.com', timezone: 'UTC' })).body.setup;
    const again = await c.post('/setup', { domain: 'www.example.com', timezone: 'Europe/London' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ resumed: true, setup: { publicKey: first.publicKey, timezone: 'Europe/London' } });
    const other = (await c.post('/setup', { domain: 'other.example', timezone: 'UTC' })).body.setup;
    expect(other.publicKey).not.toBe(first.publicKey);
    expect(s.kv.inner.entries.has(`site:${first.publicKey}`)).toBe(false);
    expect((await c.del('/setup')).body).toEqual({ ok: true });
    expect(s.kv.inner.entries.size).toBe(0);
    expect((await c.post('/setup/verify', {})).body.error).toBe('no_setup');
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
      expect((await c.post('/setup', { domain, timezone: 'UTC' })).body.error).toBe('invalid_domain');
    }
    expect((await c.post('/setup', { domain: 'ok.com', timezone: 'Mars/Olympus' })).body.error).toBe('invalid_timezone');
  });

  it('KV gets exactly what the collector needs, and the collector accepts a hit with it', async () => {
    const s = setup();
    const c = await signedUp(s);
    const { site } = (await c.addSite('example.com', 'UTC')).body;
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
    const created = await c.addSite('example.com', 'UTC');
    const secret = s.store.sites[0]!.identitySecret;
    for (const r of [await c.get('/sites'), await c.get(`/sites/${created.body.site.id}`)]) expect(r.raw).not.toContain(secret);
  });

  it('one domain once per tenant; other tenants cannot see or touch it', async () => {
    const s = setup();
    const a = await signedUp(s, 'a@example.com');
    const b = await signedUp(s, 'b@example.com');
    const { site } = (await a.addSite('example.com', 'UTC')).body;
    expect((await a.post('/setup', { domain: 'www.example.com', timezone: 'UTC' })).body.error).toBe('domain_taken');
    expect((await b.get(`/sites/${site.id}`)).status).toBe(404);
    expect((await b.del(`/sites/${site.id}`)).status).toBe(404);
    expect((await b.get('/sites')).body.sites).toEqual([]);
    expect((await b.addSite('example.com', 'UTC')).status).toBe(201); // their own copy
  });

  it('a KV outage while ADDING: nothing is created, and the owner is told why in plain words', async () => {
    const s = setup();
    const c = await signedUp(s);
    s.kv.down = true;
    const r = await c.post('/setup', { domain: 'example.com', timezone: 'UTC' });
    expect(r.status).toBe(503);
    expect(r.body.message).toContain('Cloudflare');
    expect(s.store.sites).toHaveLength(0);
    s.kv.down = false;
    const ok = await c.addSite('example.com', 'UTC');
    expect(ok.status).toBe(201);
    expect([...s.kv.inner.entries.keys()]).toEqual([`site:${ok.body.site.publicKey}`]);
  });

  it('a refused Cloudflare token is explained, never echoed', async () => {
    const s = setup();
    const c = await signedUp(s);
    s.kv.failWith = 'Cloudflare KV PUT 401: {"result":null,"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}';
    const r = await c.post('/setup', { domain: 'example.com', timezone: 'UTC' });
    expect(r.status).toBe(503);
    expect(r.body.message).toContain('CF_API_TOKEN');
    expect(r.body.message).toContain('Workers KV Storage > Edit');
    expect(r.body.message).not.toContain('errors');
  });

  it('the nightly run removes sites saved unverified before decision 25 (with their keys)', async () => {
    const s = setup({ cronSecret: 'x'.repeat(32) });
    const c = await signedUp(s);
    const { site } = (await c.addSite('example.com', 'UTC')).body;
    const { site: old } = (await c.addSite('typo.example', 'UTC')).body;
    s.store.sites.find((x) => x._id === old.id)!.verifiedAt = null;
    const r = await s.client().get('/internal/maintenance', { authorization: `Bearer ${'x'.repeat(32)}` });
    expect(r.body.unverified).toEqual({ removed: 1, failed: 0 });
    expect(s.store.sites.map((x) => x._id)).toEqual([site.id]);
    expect(s.kv.inner.entries.has(`site:${old.publicKey}`)).toBe(false);
  });
});

describe('KV stays in step with MongoDB (decision 18)', () => {
  const add = async (s: ReturnType<typeof setup>, c: Awaited<ReturnType<typeof signedUp>>) =>
    (await c.addSite('example.com', 'UTC')).body.site;

  it('rotation during an outage: no new key appears, so no snippet can carry a dead key', async () => {
    const s = setup();
    const c = await signedUp(s);
    const site = await add(s, c);
    s.kv.down = true;
    const r = await c.post(`/sites/${site.id}/keys`);
    expect(r.status).toBe(503);
    const after = (await c.get(`/sites/${site.id}`)).body.site;
    expect(after.keys).toHaveLength(1);
    expect(after.publicKey).toBe(site.publicKey);
  });

  it('revoke during an outage: saved, shown as pending, and fixed by itself once Cloudflare is back', async () => {
    const s = setup();
    const c = await signedUp(s);
    const site = await add(s, c);
    s.kv.down = false;
    const second = (await c.post(`/sites/${site.id}/keys`)).body.site;
    s.kv.down = true;
    const r = await c.post(`/sites/${site.id}/keys/${site.keys[0].id}/revoke`);
    expect(r.status).toBe(200);
    expect(r.body.sync).toMatchObject({ ok: false, pending: true });
    expect(s.kv.inner.entries.has(`site:${site.publicKey}`)).toBe(true); // still live in KV for now
    const listed = (await c.get('/sites')).body.kvIssues;
    expect(listed).toEqual([expect.objectContaining({ siteId: site.id, domain: 'example.com', deleted: false })]);
    s.kv.down = false;
    const retried = (await c.post('/sites/sync-all')).body.kvIssues;
    expect(retried).toEqual([]);
    expect(s.kv.inner.entries.has(`site:${site.publicKey}`)).toBe(false);
    expect(s.kv.inner.entries.has(`site:${second.publicKey}`)).toBe(true);
  });

  it('delete during an outage: the deleted site\'s keys are still removed later (no "retry" button needed)', async () => {
    const s = setup();
    const c = await signedUp(s);
    const site = await add(s, c);
    s.kv.down = true;
    expect((await c.del(`/sites/${site.id}`)).body.sync).toMatchObject({ ok: false, pending: true });
    expect((await c.get('/sites')).body.kvIssues).toEqual([expect.objectContaining({ siteId: site.id, deleted: true })]);
    s.kv.down = false;
    expect((await c.post('/sites/sync-all')).body.kvIssues).toEqual([]);
    expect(s.kv.inner.entries.size).toBe(0);
  });

  it('a key revoked WHILE another change is being activated is not written back (rollback re-reads MongoDB)', async () => {
    const s = setup();
    const c = await signedUp(s);
    const site = await add(s, c);
    const b = (await c.post(`/sites/${site.id}/keys`)).body.site;
    const a = site.keys[0];
    s.kv.onPut = async () => {
      expect((await c.post(`/sites/${site.id}/keys/${a.id}/revoke`)).status).toBe(200);
    };
    const r = await c.post(`/sites/${site.id}/allowed-hosts`, { host: 'staging.example.com' });
    expect(r.status).toBe(409); // the site changed under it
    expect(s.kv.inner.entries.has(`site:${a.publicKey}`)).toBe(false);
    expect(s.kv.inner.entries.has(`site:${b.publicKey}`)).toBe(true);
    expect((await c.get('/sites')).body.kvIssues).toEqual([]);
  });

  it('the daily reconcile repairs drift it was never told about, and needs the cron secret', async () => {
    const s = setup({ cronSecret: 'a-very-long-cron-secret' });
    const c = await signedUp(s);
    const site = await add(s, c);
    s.kv.inner.entries.delete(`site:${site.publicKey}`); // someone deleted it by hand in Cloudflare
    s.kv.inner.entries.set('site:tw_pub_stale', '{}'); // not ours to judge: left alone
    expect((await c.get('/internal/reconcile')).status).toBe(404);
    expect((await c.get('/internal/reconcile', { authorization: 'Bearer wrong' })).status).toBe(404);
    const r = await c.get('/internal/reconcile', { authorization: 'Bearer a-very-long-cron-secret' });
    expect(r.body).toMatchObject({ checked: 1, repaired: 1, failed: [] });
    expect(JSON.parse(s.kv.inner.entries.get(`site:${site.publicKey}`)!).id).toBe(site.id);
  });

  it('without a cron secret the reconcile route does not exist', async () => {
    const s = setup();
    const c = await signedUp(s);
    expect((await c.get('/internal/reconcile', { authorization: 'Bearer ' })).status).toBe(404);
  });
});

describe('③ snippets: generated by the server only', () => {
  it('the script tag carries the site key and the collector; custom-event code comes with it', async () => {
    const c = await signedUp(setup());
    const { site } = (await c.addSite('example.com', 'UTC')).body;
    const { snippets } = (await c.get(`/sites/${site.id}`)).body;
    // Owner decision 2026-10-12: the script tag only, plus copy-ready custom-event code.
    expect(snippets.map((x: { id: string }) => x.id)).toEqual(['script-tag', 'custom-event']);
    expect(snippets[0].code).toBe(`<script async fetchpriority="low" src="${COLLECTOR}/tw.js?id=${site.publicKey}"></script>`);
    expect(snippets[0].note).toContain('<head>');
    const custom = snippets[1].code as string;
    expect(custom).toContain("window.tw=window.tw||function(){(tw.q=tw.q||[]).push(arguments)}");
    // Every event name in the example is one the collector accepts.
    for (const m of custom.matchAll(/tw\('track', '([^']+)'/g)) expect(m[1]).toMatch(/^[a-z0-9_]{1,40}$/);
  });
});

describe('keys: rotation without losing a hit', () => {
  it('add -> both active in KV -> revoke old -> old deleted from KV; the last key cannot be revoked', async () => {
    const s = setup();
    const c = await signedUp(s);
    const { site } = (await c.addSite('example.com', 'UTC')).body;
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
    const { site } = (await c.addSite('example.com', 'UTC')).body;
    await c.patch(`/sites/${site.id}`, { status: 'paused' });
    expect(JSON.parse(s.kv.inner.entries.get(`site:${site.publicKey}`)!).live).toBe(false);
    expect((await c.del(`/sites/${site.id}`)).body.sync).toEqual({ ok: true });
    expect(s.kv.inner.entries.size).toBe(0);
    expect((await c.get('/sites')).body.sites).toEqual([]);
    const again = (await c.addSite('example.com', 'Europe/London')).body.site;
    expect(again.id).toBe(site.id);
    expect(again.publicKey).not.toBe(site.publicKey);
    expect(again.timezone).toBe('Europe/London');
    expect(again.verifiedAt).not.toBeNull(); // re-added only after a full install check (decision 25)
    expect([...s.kv.inner.entries.keys()]).toEqual([`site:${again.publicKey}`]);
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
