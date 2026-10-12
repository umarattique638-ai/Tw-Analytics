import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { defaultConfig } from '../../src/config';
import { MemoryEraser } from '../../src/eraser';
import { MemoryKv } from '../../src/kv';
import { MemoryMailer } from '../../src/mail';
import type { StatsReader } from '../../src/stats';
import { MemoryStore } from '../../src/store/memory';

/**
 * Phase 3 in the browser: the Activity page, retention in Settings, "Download all data" and deleting the
 * account, on the built dashboard (apps/web/dist) against the real API with in-memory stores.
 */
const WEB = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const SHOTS = process.env.TW_SCREENSHOTS;
const PASSWORD = 'correct horse battery';

const stats = {
  exportSite: async (_site: number, tz: string, from: string, to: string) => ({
    from,
    to,
    timezone: tz,
    days: [{ date: to, visitors: 41, sessions: 52, pageviews: 777 }],
    pages: [{ path: '/pricing', pageviews: 777, visitorsEstimated: 41 }],
    events: [{ name: 'pageview', count: 777, lastAt: new Date().toISOString() }],
    blocked: [],
  }),
} as unknown as StatsReader;

let api: ServerType;
let base: string;
let browser: Browser;
const store = new MemoryStore();
const kv = new MemoryKv();
const eraser = new MemoryEraser();
const mailer = new MemoryMailer();

beforeAll(async () => {
  if (!existsSync(`${WEB}index.html`)) throw new Error('Build the dashboard first: pnpm --filter @tailwatch/web build');
  const app = createApp({
    store,
    kv,
    eraser,
    mailer,
    stats,
    analytics: { recent: async () => ({ events: 1, pageviews: 1, last: null, drops: [] }) },
    config: defaultConfig({ collectorUrl: 'https://collector.test', secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 } }),
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
  await req('/sites', { domain: 'realshop.test', timezone: 'Asia/Karachi' }, cookie);
  await req('/sites', { domain: 'blog.example.org', timezone: 'Europe/London' }, cookie);
  store.sites[0]!.verifiedAt = new Date();
  eraser.rows.push({ table: 'events', site: store.sites[0]!._id, at: new Date() });

  browser = await chromium.launch({ executablePath: process.env.TW_CHROME_PATH || undefined });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => (api ? api.close(r) : r(undefined)));
});

async function login(page: Page) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Work email').fill('umar@realshop.test');
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/dashboard/);
}

describe('Phase 3 pages', { timeout: 90_000 }, () => {
  it('activity log, retention, download all data, delete the account', async () => {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const main = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    await login(page);

    // Activity: what happened so far, in sentences, by "You".
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await page.getByTestId('activity-list').waitFor();
    let t = await main();
    for (const want of ['Added realshop.test (timezone Asia/Karachi)', 'Added blog.example.org', 'Signed in', 'Created the account (umar@realshop.test)', 'You']) expect(t, want).toContain(want);

    // Settings: shorten the retention of one site (asks first), the other stays.
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByTestId('retention-list').waitFor();
    expect(await main()).toContain('Keeps 13 months');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-settings.png`, fullPage: true });
    await page.getByRole('radiogroup', { name: 'Retention of realshop.test' }).getByRole('radio', { name: '30 days' }).click();
    await page.getByRole('dialog').getByText('Data older than 30 days is deleted within a week').waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-retention-confirm.png` });
    await page.getByRole('button', { name: 'Shorten retention' }).click();
    await page.getByText('realshop.test now keeps 30 days. Older data is deleted within a week.').waitFor();
    expect(store.sites.find((s) => s.domain === 'realshop.test')!.retentionDays).toBe(30);
    expect(store.sites.find((s) => s.domain === 'blog.example.org')!.retentionDays).toBe(395);

    // Download all data: a JSON file with both sites and their history.
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-account').click()]);
    expect(download.suggestedFilename()).toMatch(/^tailwatch-export-\d{4}-\d{2}-\d{2}\.json$/);
    const file = JSON.parse(readFileSync((await download.path())!, 'utf8'));
    expect(file.sites.map((s: { domain: string }) => s.domain)).toEqual(['realshop.test', 'blog.example.org']);
    expect(file.sites[0].analytics.pages[0]).toEqual({ path: '/pricing', pageviews: 777, visitorsEstimated: 41 });
    await page.getByText('Downloaded. Keep the file somewhere safe.').waitFor();

    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await page.getByText('Downloaded all account data (2 sites)').waitFor();
    t = await main();
    expect(t).toContain('Changed how long realshop.test keeps data from 395 to 30 days');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-activity.png`, fullPage: true });
    // The site filter.
    await page.getByLabel('Filter by site').selectOption({ label: 'blog.example.org' });
    await page.getByTestId('activity-list').getByText('Added blog.example.org').waitFor();
    await expect.poll(async () => (await main()).includes('Changed how long')).toBe(false);
    expect(await main()).not.toContain('Added realshop.test');

    // Delete the account: wrong password first, then the real one.
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Delete account…' }).click();
    const form = page.getByTestId('delete-account-form');
    const submit = form.getByRole('button', { name: 'Delete account permanently' });
    expect(await submit.isDisabled()).toBe(true);
    await form.getByLabel('Your password').fill('not my password');
    await form.getByLabel('Type DELETE to confirm').fill('DELETE');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-delete-form.png`, fullPage: true });
    await submit.click();
    await form.getByText('Wrong password.').waitFor();
    expect(store.users).toHaveLength(1);
    await form.getByLabel('Your password').fill(PASSWORD);
    await submit.click();
    await page.waitForURL(/\/login/);
    await page.getByText('Your account was deleted. Tracking has stopped.').waitFor();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-deleted-login.png` });

    expect(store.users).toHaveLength(0);
    expect(store.sites).toHaveLength(0);
    expect(kv.entries.size).toBe(0);
    expect(eraser.rows).toHaveLength(0);
    expect(mailer.sent.map((m) => m.subject)).toContain('Your TailWatch account was deleted');
    // Logging in again is impossible.
    await page.getByLabel('Work email').fill('umar@realshop.test');
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByText('Wrong e-mail or password.').waitFor();
    expect(errors).toEqual([]);
  });

  it('phone width: Settings has no sideways scroll', async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
    const page = await context.newPage();
    await page.goto(`${base}/signup`);
    // The first account is gone (deleted above): make a fresh one through the form.
    await page.getByLabel('Full name').fill('Phone User').catch(() => undefined);
    const api = (path: string, body: unknown) => page.request.post(`${base}/api/v1${path}`, { data: body, headers: { 'content-type': 'application/json' } });
    await api('/auth/signup', { name: 'Phone User', email: 'phone@realshop.test', password: PASSWORD });
    await api('/sites', { domain: 'a-very-long-domain-name-for-phones.example.com', timezone: 'Asia/Karachi' });
    await page.goto(`${base}/settings`);
    await page.getByTestId('retention-list').waitFor();
    // The page scrolls inside <main>: neither the document nor main may be wider than the screen.
    const overflow = await page.evaluate(() =>
      [document.documentElement, document.querySelector('main')!].map((el) => el.scrollWidth - el.clientWidth),
    );
    expect(overflow).toEqual([0, 0]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p3-settings-phone.png`, fullPage: true });
  });
});
