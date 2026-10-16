import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { defaultConfig } from '../../src/config';
import { MemoryKv } from '../../src/repositories/kv';
import { MemoryMailer } from '../../src/services/mail';
import { snippetsFor } from '../../src/views/snippets';
import type { Live, Overview, Range, StatsReader } from '../../src/repositories/stats';
import { MemoryStore } from '../../src/repositories/memory-store';
import { fakeSiteFetch } from '../helpers/install';

/**
 * Decision 29 in the browser: the site moved to a new domain. Its visits arrive from there and are dropped
 * (wrong hostname); the banner says so and "Change the domain" moves the site, keeping its history.
 */
const WEB = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const SHOTS = process.env.TW_SCREENSHOTS;
const COLLECTOR = 'https://collector.test';
const PASSWORD = 'correct horse battery';
const DAY = 86_400_000;

const empty = (range: Range): Overview => ({
  range,
  kpis: { visitors: 0, visitorsEstimated: false, sessions: 0, pageviews: 0, bounceRate: null, previous: { visitors: 0, sessions: 0, pageviews: 0, bounceRate: null } },
  series: [],
  sources: [],
  referrers: [],
  pages: [],
  countries: [],
  devices: [],
  browsers: [],
  capture: { received: 0, expected: 0, rate: null },
  drops: [],
});
const stats = {
  overview: async (_site: number, range: Range) => empty(range),
  live: async (): Promise<Live> => ({ now: Date.now(), active: 0, minutes: [], events: [] }),
} as unknown as StatsReader;

let api: ServerType;
let base: string;
let browser: Browser;
const store = new MemoryStore();
const kv = new MemoryKv();
/** The customer's site: realshop.test now redirects to its new home, realshop.pk, which has the snippet. */
const shop = { key: '' };
/** The API's clock runs 5 days ahead once the site exists: it has been silent that long. */
let ahead = 0;

beforeAll(async () => {
  if (!existsSync(`${WEB}index.html`)) throw new Error('Build the dashboard first: pnpm --filter @tailwatch/web build');
  const setupFetch = fakeSiteFetch(kv.entries, COLLECTOR);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!shop.key || (url.hostname !== 'realshop.test' && url.hostname !== 'realshop.pk')) return setupFetch(input, init);
    if (url.hostname === 'realshop.test') return new Response(null, { status: 301, headers: { location: 'https://realshop.pk/' } });
    const tag = snippetsFor(COLLECTOR, shop.key).find((s) => s.group === 'script-tag')!.code;
    return new Response(`<!doctype html><html><head>${tag}</head><body>shop</body></html>`, { headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;

  const app = createApp({
    store,
    kv,
    mailer: new MemoryMailer(),
    analytics: { recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }), siteActivity: async () => new Map(),
      wrongHosts: async (ids) => new Map(ids.map((id) => [id, [{ host: 'realshop.pk', hits: 212, lastAt: new Date(Date.now() + ahead - 3_600_000) }]])),
    },
    stats,
    config: defaultConfig({ collectorUrl: COLLECTOR, secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 } }),
    verifier: { fetchImpl, resolve: async () => ['93.184.216.34'] },
    now: () => new Date(Date.now() + ahead),
  });
  const server = new Hono();
  server.route('/', app);
  const index = readFileSync(`${WEB}index.html`, 'utf8');
  server.use('/*', serveStatic({ root: relative(process.cwd(), WEB) }));
  server.get('*', (c) => c.html(index));
  await new Promise<void>((r) => (api = serve({ fetch: server.fetch, port: 0, hostname: '127.0.0.1' }, () => r())));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  const req = (path: string, body: unknown, cookie = '') =>
    app.request(`${base}/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', host: new URL(base).host, cookie }, body: JSON.stringify(body) });
  const signup = await req('/auth/signup', { name: 'Umar Attique', email: 'umar@realshop.test', password: PASSWORD });
  const cookie = signup.headers.get('set-cookie')!.split(';')[0]!;
  await req('/setup', { domain: 'realshop.test', timezone: 'Asia/Karachi' }, cookie);
  await req('/setup/verify', {}, cookie);
  shop.key = store.sites[0]!.keys[0]!.publicKey;
  ahead = 5 * DAY;

  browser = await chromium.launch({ executablePath: process.env.TW_CHROME_PATH || undefined });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => (api ? api.close(r) : r(undefined)));
});

describe('a site that moved to a new domain', { timeout: 60_000 }, () => {
  it('banner says it moved -> Change the domain (pre-filled) -> checked there -> switched, history kept', async () => {
    const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/login`);
    await page.getByLabel('Work email').fill('umar@realshop.test');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();

    const banner = page.getByTestId('health-broken');
    await banner.waitFor({ timeout: 15_000 });
    const text = (await banner.innerText()).replace(/\s+/g, ' ');
    expect(text).toContain('It looks like the site moved');
    expect(text).toContain('Visits now come from realshop.pk (212 hits');
    expect(await page.getByRole('button', { name: 'Get the script' }).count()).toBe(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m1-moved.png` });

    await page.getByRole('button', { name: 'Change the domain' }).click();
    const dialog = page.getByRole('dialog');
    expect(await dialog.getByLabel('New domain').inputValue()).toBe('realshop.pk');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m2-dialog.png` });
    await dialog.getByRole('button', { name: 'Check and change' }).click();
    await page.getByText('The site is now realshop.pk').waitFor();
    await banner.waitFor({ state: 'detached' });
    expect(await page.locator('main').innerText()).toContain('realshop.pk');
    expect(store.sites[0]).toMatchObject({ domain: 'realshop.pk', allowedHosts: ['realshop.pk', '*.realshop.pk'] });
    expect(store.sites[0]!.keys[0]!.publicKey).toBe(shop.key);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/m3-changed.png` });

    // Settings lists it under its new domain, with "Change domain" for the next move.
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByTestId('domain-list').getByText('realshop.pk', { exact: true }).waitFor();
    expect(errors).toEqual([]);
  });
});
