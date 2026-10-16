import { describe, expect, it } from 'vitest';
import { createApp, SESSION_COOKIE } from '../src/app';
import type { AnalyticsReader, SiteActivity, SpikeDetails, WrongHost } from '../src/models/clickhouse';
import { defaultConfig } from '../src/config';
import { MemoryKv } from '../src/models/kv';
import { MemoryMailer } from '../src/services/mail';
import { isSilent, silentHoursFor } from '../src/services/health';
import { median, spikeOf } from '../src/services/spikes';
import { snippetsFor } from '../src/views/snippets';
import { MemoryStore } from '../src/models/memory-store';
import { addSite, fakeSiteFetch } from './helpers/install';

/**
 * Decision 28: is each site still sending data? Silent for longer than its habit -> the install check runs:
 * broken (red banner, one e-mail, activity line), quiet (no visitors, no e-mail) or healthy again.
 */
const FAST = { N: 1024, r: 8, p: 1 };
const HOST = 'app.test';
const SECRET = 'cron-secret-0123456789';
const COLLECTOR = 'https://collector.test';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Page = 'ok' | 'removed' | 'down' | `redirect:${string}`;

function setup(over: { ownerEmail?: string } = {}) {
  const store = new MemoryStore();
  const kv = new MemoryKv();
  const mailer = new MemoryMailer();
  const clock = { t: Date.parse('2026-10-01T09:00:00Z') };
  /** What ClickHouse "knows" per site; missing = no event in the last 7 days. */
  const activity = new Map<number, SiteActivity>();
  let activityCalls = 0;
  /** dropped_hits "hostname" per site (decision 29). */
  const wrongHosts = new Map<number, WrongHost[]>();
  /** Page views per 24-hour window per site ([0] = last 24 hours) and the spike breakdown (decision 31). */
  const daily = new Map<number, number[]>();
  const details = new Map<number, SpikeDetails>();
  const analytics: AnalyticsReader = {
    dailyPageviews: async (ids, days) => new Map(ids.map((id) => [id, [...(daily.get(id) ?? []), ...Array<number>(days).fill(0)].slice(0, days)])),
    spikeDetails: async (ids) => new Map(ids.map((id) => [id, details.get(id) ?? { pages: [], countries: [], referrers: [], blocked: 0 }])),
    wrongHosts: async (ids) => new Map([...wrongHosts].filter(([id]) => ids.includes(id))),
    recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }),
    siteActivity: async (ids) => {
      activityCalls += 1;
      return new Map([...activity].filter(([id]) => ids.includes(id)));
    },
  };
  /** What each installed domain serves now (the setup pages come from fakeSiteFetch). */
  const pages = new Map<string, { page: Page; key: string }>();
  let fetches = 0;
  const setupFetch = fakeSiteFetch(kv.entries, COLLECTOR);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const p = pages.get(url.hostname);
    if (!p || url.pathname.endsWith('/tw.js')) return setupFetch(input, init);
    fetches += 1;
    if (p.page === 'down') return new Response('oops', { status: 502, headers: { 'content-type': 'text/html' } });
    if (p.page.startsWith('redirect:')) return new Response(null, { status: 301, headers: { location: `https://${p.page.slice(9)}/` } });
    const tag = p.page === 'ok' ? snippetsFor(COLLECTOR, p.key).find((x) => x.group === 'script-tag')!.code : '';
    return new Response(`<!doctype html><html><head>${tag}</head><body>shop</body></html>`, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;

  const app = createApp({
    store,
    kv,
    analytics,
    mailer,
    config: defaultConfig({ collectorUrl: COLLECTOR, secureCookies: false, scrypt: FAST, cronSecret: SECRET, ownerEmail: over.ownerEmail ?? null }),
    verifier: { fetchImpl, resolve: async () => ['93.184.216.34'] },
    now: () => new Date((clock.t += 1)),
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
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    return { get: (p: string) => call('GET', p), post: (p: string, j: unknown = {}) => call('POST', p, j), patch: (p: string, j: unknown) => call('PATCH', p, j) };
  };
  const cron = async () => {
    const r = await app.request(`http://${HOST}/api/v1/internal/health`, { headers: { host: HOST, authorization: `Bearer ${SECRET}` } });
    return { status: r.status, body: (await r.json()) as any };
  };

  /** Sign up and install these domains; every site starts "installed and serving the snippet". */
  const account = async (domains: string[], email = 'umar@shop.test') => {
    const c = client();
    expect((await c.post('/auth/signup', { name: 'Umar', email, password: 'correct horse' })).status).toBe(201);
    const sites = [];
    for (const domain of domains) {
      const r = await addSite(c.post, kv.entries, domain, 'Asia/Karachi');
      expect(r.status).toBe(201);
      pages.set(domain, { page: 'ok', key: r.body.site.publicKey });
      sites.push(r.body.site as { id: number; domain: string; publicKey: string });
    }
    return { c, sites };
  };

  const at = (msAgo: number) => new Date(clock.t - msAgo);
  /** Data from this site arrived `agoMs` ago; its longest pause in the window was `gapMinutes`. */
  const lastEvent = (siteId: number, agoMs: number, gapMinutes = 60) => activity.set(siteId, { lastAt: at(agoMs), maxGapMinutes: gapMinutes });
  const serve = (domain: string, page: Page) => (pages.get(domain)!.page = page);
  const audit = (action: string) => store.audit.filter((e) => e.action === action);
  return { store, kv, mailer, clock, activity, wrongHosts, daily, details, pages, app, client, cron, account, lastEvent, serve, audit, counts: () => ({ fetches, activityCalls }) };
}

describe('silence threshold', () => {
  const now = new Date('2026-10-15T00:00:00Z');
  const old = { verifiedAt: new Date(now.getTime() - 10 * DAY), createdAt: new Date(now.getTime() - 10 * DAY) };
  const young = { verifiedAt: new Date(now.getTime() - DAY), createdAt: new Date(now.getTime() - DAY) };
  const act = (gapMinutes: number, agoMs = HOUR) => ({ lastAt: new Date(now.getTime() - agoMs), maxGapMinutes: gapMinutes });

  it('is twice the longest pause of the last days, between 6 hours and 3 days', () => {
    expect(silentHoursFor(old, act(30), now)).toBe(6); // a busy site: 1 h -> 6 h floor
    expect(silentHoursFor(old, act(10 * 60), now)).toBe(20);
    expect(silentHoursFor(old, act(5 * 24 * 60), now)).toBe(72); // a sleepy site: capped at 3 days
    expect(silentHoursFor(old, undefined, now)).toBe(6);
  });

  it('is 24 hours for a site verified less than 2 days ago', () => {
    expect(silentHoursFor(young, act(5), now)).toBe(24);
    expect(isSilent(young, undefined, now)).toBe(true); // verified a day ago, nothing since
    expect(isSilent({ ...young, verifiedAt: new Date(now.getTime() - 5 * HOUR) }, undefined, now)).toBe(false);
  });

  it('counts from the verification when the last event is older (a site added again)', () => {
    const restored = { verifiedAt: new Date(now.getTime() - 3 * HOUR), createdAt: new Date(now.getTime() - 100 * DAY) };
    expect(isSilent(restored, act(60, 20 * DAY), now)).toBe(false);
  });
});

describe('site health', { timeout: 30_000 }, () => {
  it('data arriving: healthy, and nothing is fetched from the site', async () => {
    const s = setup();
    const { c, sites } = await s.account(['shop.test']);
    s.lastEvent(sites[0]!.id, 10 * 60_000);
    const r = await c.get(`/sites/${sites[0]!.id}/health`);
    expect(r.status).toBe(200);
    expect(r.body.health).toMatchObject({ status: 'healthy', reason: null, silentHours: 24 });
    expect(s.counts().fetches).toBe(0);
    expect((await c.get('/sites')).body.sites[0].health).toBe('healthy');
  });

  it('silent and the snippet is gone: broken, one e-mail, one activity line; data again: recovered', async () => {
    const s = setup();
    const { sites } = await s.account(['shop.test']);
    const id = sites[0]!.id;
    s.clock.t += 5 * DAY; // past the "new site" period
    s.lastEvent(id, 8 * HOUR, 60); // habit: 1 h pauses -> 6 h threshold
    s.serve('shop.test', 'removed');

    const night = await s.cron();
    expect(night.status).toBe(200);
    expect(night.body).toMatchObject({ sites: 1, silent: 1, broken: 1, pipelineSuspect: false });
    const h = s.store.health.find((x) => x._id === id)!;
    expect(h).toMatchObject({ status: 'broken', failedCheck: 'present', silentHours: 6 });
    expect(h.alertedAt).not.toBeNull();
    expect(s.mailer.sent).toHaveLength(1);
    expect(s.mailer.sent[0]).toMatchObject({ to: 'umar@shop.test', subject: 'shop.test stopped sending data to TailWatch' });
    expect(s.mailer.sent[0]!.text).toContain('for 8 hours');
    expect(s.mailer.sent[0]!.text).toContain(`/dashboard?site=${id}`);
    expect(s.audit('site.stopped_sending')).toHaveLength(1);

    // Still broken the next night: no second e-mail, no second line.
    s.clock.t += DAY;
    await s.cron();
    expect(s.mailer.sent).toHaveLength(1);
    expect(s.audit('site.stopped_sending')).toHaveLength(1);

    // The customer puts the snippet back and visitors come: one "sending again" e-mail.
    s.serve('shop.test', 'ok');
    s.lastEvent(id, 5 * 60_000);
    const back = await s.cron();
    expect(back.body).toMatchObject({ healthy: 1, broken: 0 });
    expect(s.store.health.find((x) => x._id === id)).toMatchObject({ status: 'healthy', alertedAt: null, reason: null });
    expect(s.mailer.sent).toHaveLength(2);
    expect(s.mailer.sent[1]!.subject).toBe('shop.test is sending data again');
    expect(s.audit('site.sending_again')).toHaveLength(1);
  });

  it('silent but installed correctly: quiet (no visitors), no e-mail', async () => {
    const s = setup();
    const { c, sites } = await s.account(['shop.test']);
    s.clock.t += 5 * DAY;
    s.lastEvent(sites[0]!.id, 2 * DAY, 120);
    const night = await s.cron();
    expect(night.body).toMatchObject({ quiet: 1, broken: 0 });
    expect(s.mailer.sent).toHaveLength(0);
    const r = await c.get(`/sites/${sites[0]!.id}/health`);
    expect(r.body.health.status).toBe('quiet');
    expect(r.body.health.lastEventAt).toBeTruthy();
  });

  it('the dashboard check shows the problem at once but never e-mails; the nightly run does', async () => {
    const s = setup();
    const { c, sites } = await s.account(['shop.test']);
    const id = sites[0]!.id;
    s.clock.t += 5 * DAY;
    s.lastEvent(id, 30 * HOUR, 60);
    s.serve('shop.test', 'down');
    const r = await c.get(`/sites/${id}/health`);
    expect(r.body.health).toMatchObject({ status: 'broken', failedCheck: 'reach', failedLabel: 'Site reachable' });
    expect(r.body.health.reason).toContain('HTTP 502');
    expect(s.mailer.sent).toHaveLength(0);

    // Opened again within the hour: the stored result, nothing re-fetched.
    const before = s.counts().fetches;
    await c.get(`/sites/${id}/health`);
    expect(s.counts().fetches).toBe(before);

    await s.cron();
    expect(s.mailer.sent).toHaveLength(1);
    expect(s.audit('site.stopped_sending')).toHaveLength(1);
  });

  it('"Check again" re-checks now: fixed install -> the banner goes', async () => {
    const s = setup();
    const { c, sites } = await s.account(['shop.test']);
    const id = sites[0]!.id;
    s.clock.t += 5 * DAY;
    s.lastEvent(id, 30 * HOUR, 60);
    s.serve('shop.test', 'removed');
    expect((await c.get(`/sites/${id}/health`)).body.health.status).toBe('broken');
    s.serve('shop.test', 'ok');
    const again = await c.post(`/sites/${id}/health/check`);
    expect(again.status).toBe(200);
    expect(again.body.health.status).toBe('quiet');
    expect(s.audit('site.sending_again')).toHaveLength(1);
    expect(s.mailer.sent).toHaveLength(0); // nothing was e-mailed, so no "sending again" e-mail either
  });

  it('most sites silent at once: our pipeline, so only the operator is e-mailed', async () => {
    const s = setup({ ownerEmail: 'ops@tailwatch.test' });
    const { sites } = await s.account(['a.test', 'b.test', 'c.test', 'd.test']);
    s.clock.t += 5 * DAY;
    for (const site of sites.slice(0, 3)) {
      s.lastEvent(site.id, 20 * HOUR, 60);
      s.serve(site.domain, 'removed');
    }
    s.lastEvent(sites[3]!.id, 10 * 60_000);
    const night = await s.cron();
    expect(night.body).toMatchObject({ sites: 4, silent: 3, pipelineSuspect: true, broken: 3, healthy: 1 });
    expect(s.mailer.sent.map((m) => m.to)).toEqual(['ops@tailwatch.test']);
    expect(s.mailer.sent[0]!.subject).toBe('TailWatch: 3 of 4 sites are silent');
    expect(s.store.health.every((h) => h.alertedAt === null)).toBe(true);
  });

  it('a paused site is not watched', async () => {
    const s = setup();
    const { c, sites } = await s.account(['shop.test', 'blog.test']);
    await c.patch(`/sites/${sites[0]!.id}`, { status: 'paused' });
    s.clock.t += 5 * DAY;
    const r = await c.get(`/sites/${sites[0]!.id}/health`);
    expect(r.body.health.status).toBe('paused');
    const night = await s.cron();
    expect(night.body.sites).toBe(1);
    expect((await c.get('/sites')).body.sites.find((x: { id: number }) => x.id === sites[0]!.id).health).toBe('paused');
  });

  it('silent, but its visits now come from another domain: broken "moved", without opening the site', async () => {
    const s = setup();
    const { c, sites } = await s.account(['shop.test']);
    const id = sites[0]!.id;
    s.clock.t += 5 * DAY;
    s.lastEvent(id, 30 * HOUR, 60);
    s.wrongHosts.set(id, [
      { host: 'localhost', hits: 50, lastAt: new Date(s.clock.t - HOUR) }, // a developer's machine: never "moved"
      { host: 'shop-new.test', hits: 40, lastAt: new Date(s.clock.t - HOUR) },
      { host: 'old.partner.test', hits: 9, lastAt: new Date(s.clock.t - 3 * DAY) }, // before the silence
    ]);
    const before = s.counts().fetches;
    const r = await c.get(`/sites/${id}/health`);
    expect(r.body.health).toMatchObject({ status: 'broken', failedCheck: 'moved', failedLabel: 'Site moved', movedTo: 'shop-new.test' });
    expect(r.body.health.reason).toContain('Visits now come from shop-new.test (40 hits');
    expect(s.counts().fetches).toBe(before);
  });

  it('the home page redirects to another domain: broken "moved"', async () => {
    const s = setup();
    const { c, sites } = await s.account(['shop.test']);
    const id = sites[0]!.id;
    s.clock.t += 5 * DAY;
    s.lastEvent(id, 30 * HOUR, 60);
    s.pages.set('shop-new.test', { page: 'ok', key: sites[0]!.publicKey });
    s.serve('shop.test', 'redirect:shop-new.test');
    const r = await c.get(`/sites/${id}/health`);
    expect(r.body.health).toMatchObject({ status: 'broken', failedCheck: 'moved', movedTo: 'shop-new.test' });
    expect(r.body.health.reason).toContain('shop.test redirects to shop-new.test');
  });

  it('change the domain: the new one must pass the check with this site\'s key; history and id stay', async () => {
    const s = setup();
    const { c, sites } = await s.account(['shop.test']);
    const site = sites[0]!;
    s.clock.t += 5 * DAY;
    s.lastEvent(site.id, 30 * HOUR, 60);
    s.serve('shop.test', 'redirect:shop-new.test');
    expect((await c.get(`/sites/${site.id}/health`)).body.health.status).toBe('broken');

    // Not installed on the new domain yet: refused with the failing step, nothing changes.
    s.pages.set('shop-new.test', { page: 'removed', key: site.publicKey });
    const refused = await c.post(`/sites/${site.id}/domain`, { domain: 'shop-new.test' });
    expect(refused.status).toBe(200);
    expect(refused.body.ok).toBe(false);
    expect(refused.body.site).toBeNull();
    expect(s.store.sites[0]!.domain).toBe('shop.test');

    expect((await c.post(`/sites/${site.id}/domain`, { domain: 'shop.test' })).body.error).toBe('same_domain');
    expect((await c.post(`/sites/${site.id}/domain`, { domain: 'not a domain' })).status).toBe(400);

    s.pages.set('shop-new.test', { page: 'ok', key: site.publicKey });
    const moved = await c.post(`/sites/${site.id}/domain`, { domain: 'https://www.Shop-New.test/' });
    expect(moved.status).toBe(200);
    expect(moved.body.ok).toBe(true);
    expect(moved.body.site).toMatchObject({ id: site.id, domain: 'shop-new.test', allowedHosts: ['shop-new.test', '*.shop-new.test'], publicKey: site.publicKey });
    const entry = JSON.parse(s.kv.entries.get(`site:${site.publicKey}`)!);
    expect(entry.allowedHosts).toEqual(['shop-new.test', '*.shop-new.test']);
    expect(s.audit('site.domain_changed')[0]!.summary).toContain('Changed the domain of shop.test to shop-new.test');
    // The old "broken" belongs to the old domain: the banner goes at once.
    expect((await c.get(`/sites/${site.id}/health`)).body.health.status).toBe('healthy');
  });

  it('change the domain: a domain that is already a site is refused', async () => {
    const s = setup();
    const { c, sites } = await s.account(['shop.test', 'blog.test']);
    const r = await c.post(`/sites/${sites[0]!.id}/domain`, { domain: 'blog.test' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('domain_taken');
  });
});

describe('unusual traffic (decision 31)', { timeout: 30_000 }, () => {
  it('the rule: at least 100 page views and 5x the usual day (median of the 14 before)', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    const usual = Array<number>(14).fill(100);
    expect(spikeOf([600, ...usual])).toEqual({ pageviews: 600, usual: 100, times: 6 });
    expect(spikeOf([400, ...usual])).toBeNull(); // 4x: not unusual enough
    expect(spikeOf([90, ...Array<number>(14).fill(1)])).toBeNull(); // 90x, but too small to matter
    expect(spikeOf([150, ...Array<number>(14).fill(0)])).toMatchObject({ pageviews: 150, usual: 0 });
    expect(spikeOf([700, 5000, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100])).toMatchObject({ usual: 100 }); // one big day does not move the median
  });

  it('a spike: one e-mail with where it came from, an activity line, at most once a day; health untouched', async () => {
    const s = setup();
    const { sites } = await s.account(['shop.test']);
    const id = sites[0]!.id;
    s.clock.t += 10 * DAY;
    s.lastEvent(id, 5 * 60_000);
    s.daily.set(id, [2400, ...Array<number>(14).fill(300)]);
    s.details.set(id, {
      pages: [{ label: '/sale', count: 1900 }, { label: '/', count: 400 }],
      countries: [{ label: 'PK', count: 2000 }],
      referrers: [{ label: 'facebook.com', count: 1500 }, { label: '', count: 900 }],
      blocked: 320,
    });
    const night = await s.cron();
    expect(night.body).toMatchObject({ healthy: 1, spikes: 1 });
    expect(s.mailer.sent).toHaveLength(1);
    const mail = s.mailer.sent[0]!;
    expect(mail.subject).toBe('Unusual traffic on shop.test: 2,400 page views in 24 hours');
    for (const want of ['about 8.0 times its usual 300 a day', '/sale (1,900)', 'PK (2,000)', 'facebook.com (1,500), direct (900)', 'we blocked 320 hits']) expect(mail.text).toContain(want);
    expect(s.audit('site.traffic_spike')[0]!.summary).toBe('Unusual traffic on shop.test: 2400 page views in 24 hours (8x its usual 300 a day)');
    expect(s.store.health.find((h) => h._id === id)).toMatchObject({ status: 'healthy' });

    // Same day again (the cron re-run by hand): nothing new. A day later, still unusual: one more.
    s.clock.t += 2 * HOUR;
    expect((await s.cron()).body.spikes).toBe(0);
    s.clock.t += DAY;
    s.lastEvent(id, 5 * 60_000);
    expect((await s.cron()).body.spikes).toBe(1);
    expect(s.mailer.sent).toHaveLength(2);
  });

  it('a site younger than 7 days or an ordinary day: no e-mail', async () => {
    const s = setup();
    const { sites } = await s.account(['shop.test', 'blog.test']);
    s.clock.t += 3 * DAY; // both too young
    s.lastEvent(sites[0]!.id, 60_000);
    s.lastEvent(sites[1]!.id, 60_000);
    s.daily.set(sites[0]!.id, [5000]);
    expect((await s.cron()).body.spikes).toBe(0);
    s.clock.t += 10 * DAY;
    s.lastEvent(sites[0]!.id, 60_000);
    s.lastEvent(sites[1]!.id, 60_000);
    s.daily.set(sites[0]!.id, [350, ...Array<number>(14).fill(300)]);
    expect((await s.cron()).body.spikes).toBe(0);
    expect(s.mailer.sent).toHaveLength(0);
  });
});
