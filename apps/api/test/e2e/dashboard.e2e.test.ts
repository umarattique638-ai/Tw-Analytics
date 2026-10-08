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
import { MemoryKv } from '../../src/kv';
import type { DropsReport, EventsReport, Live, Overview, Range, StatsReader } from '../../src/stats';
import { MemoryStore } from '../../src/store/memory';

/**
 * Stage 6 UI: every number on the dashboard pages is what the Query API returned (the SQL itself is
 * proven on a real ClickHouse by test/live/stats.live.test.ts). Distinctive values below make a
 * left-over sample number impossible to miss. The dashboard is the built apps/web.
 */
const WEB = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const NOW = Date.now();

const overview = (range: Range): Overview => ({
  range,
  kpis: { visitors: 4321, visitorsEstimated: range.days > 1, sessions: 3456, pageviews: 98765, bounceRate: 0.375, previous: { visitors: 4000, sessions: 3200, pageviews: 90000, bounceRate: 0.4 } },
  series: [{ bucket: range.from, label: 'Oct 8', visitors: 4321, sessions: 3456, pageviews: 98765 }],
  sources: [{ name: 'Direct', sessions: 3000 }, { name: 'Search', sessions: 456 }],
  referrers: [{ label: 'news.ycombinator.com', value: 456 }],
  pages: [{ label: '/only-real-page', value: 98765 }],
  countries: [{ label: 'PK', value: 4000 }, { label: 'DE', value: 321 }],
  devices: [{ label: 'desktop', value: 4000 }, { label: 'mobile', value: 321 }],
  browsers: [{ label: 'Firefox', value: 4321 }],
  capture: { received: 987, expected: 1000, rate: 0.987 },
  drops: [{ reason: 'hostname', hits: 17, detail: 'staging.realshop.test', last: NOW - 60_000 }],
});
const stats = {
  overview: async (_site: number, range: Range) => overview(range),
  live: async (): Promise<Live> => ({
    now: NOW,
    active: 7,
    minutes: Array.from({ length: 30 }, (_, i) => ({ minute: NOW - (29 - i) * 60_000, visitors: i % 3 })),
    events: [{ name: 'signup', path: '/checkout-live', country: 'PK', at: NOW - 5_000 }],
  }),
  events: async (_site: number, range: Range): Promise<EventsReport> => ({
    range,
    events: [
      { name: 'pageview', kind: 'automatic', events: 98765, last: NOW, firstSeen: NOW - 30 * 86_400_000, isNew: false },
      { name: 'trial_started', kind: 'custom', events: 12, last: NOW, firstSeen: NOW - 86_400_000, isNew: true },
    ],
    highCardinality: [{ name: 'trial_started', key: 'account_id', distinctValues: 1234 }],
  }),
  drops: async (_site: number, range: Range): Promise<DropsReport> => ({
    range,
    rows: [
      { reason: 'hostname', detail: 'staging.realshop.test', country: 'PK', asn: 0, hits: 17, last: NOW - 60_000 },
      { reason: 'bot', detail: 'ua_denylist', country: 'US', asn: 16509, hits: 40, last: NOW - 120_000 },
    ],
  }),
} as unknown as StatsReader;

let api: ServerType;
let base: string;
let browser: Browser;
const store = new MemoryStore();
const kv = new MemoryKv();

beforeAll(async () => {
  if (!existsSync(`${WEB}index.html`)) throw new Error('Build the dashboard first: pnpm --filter @tailwatch/web build');
  const app = createApp({
    store, kv,
    analytics: { recent: async () => ({ events: 1, pageviews: 1, last: null, drops: [] }) },
    stats,
    config: defaultConfig({ collectorUrl: 'https://collector.test', secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 } }),
  });
  const server = new Hono();
  server.route('/', app);
  const index = readFileSync(`${WEB}index.html`, 'utf8');
  server.use('/*', serveStatic({ root: relative(process.cwd(), WEB) }));
  server.get('*', (c) => c.html(index));
  await new Promise<void>((r) => (api = serve({ fetch: server.fetch, port: 0, hostname: '127.0.0.1' }, () => r())));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  // A user with a verified site, made through the API like the dashboard would.
  const req = (path: string, body: unknown, cookie = '') =>
    app.request(`${base}/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', host: new URL(base).host, cookie }, body: JSON.stringify(body) });
  const signup = await req('/auth/signup', { name: 'Umar Attique', email: 'umar@realshop.test', password: 'correct horse battery' });
  const cookie = signup.headers.get('set-cookie')!.split(';')[0]!;
  await req('/sites', { domain: 'realshop.test', timezone: 'Asia/Karachi' }, cookie);
  store.sites[0]!.verifiedAt = new Date();

  browser = await chromium.launch({ executablePath: process.env.TW_CHROME_PATH || undefined });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => (api ? api.close(r) : r(undefined)));
});

describe('dashboard pages show the Query API numbers, nothing else', { timeout: 60_000 }, () => {
  it('overview, live, events, suspicious (allow a host), reports (CSV)', async () => {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${base}/login`);
    await page.getByLabel('Work email').fill('umar@realshop.test');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByTestId('reports').waitFor();

    const text = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    await expect.poll(async () => (await text()).includes('98,765')).toBe(true);
    const t = await text();
    for (const want of ['Good', 'Umar', '3,456', '98,765', '37.5%', '98.7%', '987 of 1,000', '/only-real-page', 'news.ycombinator.com', 'Pakistan', 'Germany', 'Firefox', 'Desktop', 'staging.realshop.test', '/checkout-live', 'Asia/Karachi']) {
      expect(t, want).toContain(want);
    }
    await expect.poll(async () => (await text()).includes('7 active in the last 5 minutes')).toBe(true);
    if (process.env.TW_SCREENSHOTS) await page.screenshot({ path: `${process.env.TW_SCREENSHOTS}/6-dashboard.png`, fullPage: true });
    // None of the old sample values survived anywhere.
    for (const old of ['John', '6,474', '5,140', '41.2%', '/blog/privacy-analytics', 'United States', 'Sample data']) expect(t, old).not.toContain(old);

    await page.getByRole('link', { name: 'Events' }).click();
    await page.locator('[data-event="trial_started"]').waitFor();
    const ev = await text();
    for (const want of ['trial_started', '98,777', 'New · review', 'account_id', '1,234']) expect(ev, want).toContain(want);

    await page.getByRole('link', { name: 'Suspicious activity' }).click();
    await page.getByText('ua_denylist').waitFor();
    expect(await text()).toContain('57'); // 17 + 40 hits dropped
    await page.getByRole('button', { name: 'Allow host' }).click();
    await page.getByText('staging.realshop.test is now accepted').waitFor();
    expect(store.sites[0]!.allowedHosts).toContain('staging.realshop.test');
    expect(JSON.parse([...kv.entries.values()][0]!).allowedHosts).toContain('staging.realshop.test');

    await page.getByRole('link', { name: 'Reports' }).click();
    const href = await page.getByTestId('export-csv').getAttribute('href');
    const csv = await page.evaluate(async (u) => (await fetch(u!)).text(), href);
    expect(csv.split('\n')[1]).toMatch(/^\d{4}-\d{2}-\d{2},4321,3456,98765$/);
    expect(errors).toEqual([]);
  });
});
