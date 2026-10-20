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
import { MemoryKv } from '../../src/repositories/kv';
import type { StatsReader } from '../../src/repositories/stats';
import { MemoryMailer } from '../../src/services/mail';
import { MemoryStore } from '../../src/repositories/memory-store';
import { addSite, fakeVerifier } from '../helpers/install';

/**
 * Super admin in the browser (owner, 2026-10-20): the team sees "All accounts" in the sidebar, opens an
 * account, downloads a site's report, deletes a site and then the whole account. A customer never sees it.
 */
const WEB = fileURLToPath(new URL('../../../web/dist/', import.meta.url));
const SHOTS = process.env.TW_SCREENSHOTS;
const COLLECTOR = 'https://collector.test';
const PASSWORD = 'correct horse battery';
const ADMIN = 'team@tailwatch.test';

const stats = {
  overview: async () => ({ series: [{ bucket: '2026-10-19', label: 'Oct 19', visitors: 3, sessions: 4, pageviews: 9 }] }),
} as unknown as StatsReader;

let api: ServerType;
let base: string;
let browser: Browser;
const store = new MemoryStore();
const kv = new MemoryKv();

beforeAll(async () => {
  if (!existsSync(`${WEB}index.html`)) throw new Error('Build the dashboard first: pnpm --filter @tailwatch/web build');
  const app = createApp({
    store,
    kv,
    mailer: new MemoryMailer(),
    analytics: { recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }) },
    stats,
    config: defaultConfig({ collectorUrl: COLLECTOR, secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 }, superAdmins: [ADMIN] }),
    verifier: fakeVerifier(kv.entries, COLLECTOR),
  });
  const server = new Hono();
  server.route('/', app);
  const index = readFileSync(`${WEB}index.html`, 'utf8');
  server.use('/*', serveStatic({ root: relative(process.cwd(), WEB) }));
  server.get('*', (c) => c.html(index));
  await new Promise<void>((r) => (api = serve({ fetch: server.fetch, port: 0, hostname: '127.0.0.1' }, () => r())));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;

  // Two customers with sites, and the team's own account.
  for (const [name, email, domains] of [
    ['Umar Attique', 'umar@realshop.test', ['realshop.test', 'blog.realshop-news.test']],
    ['Sara Khan', 'sara@kitchen.test', ['kitchen.test']],
    ['TailWatch Team', ADMIN, []],
  ] as const) {
    const req = (path: string, body: unknown, cookie = '') =>
      app.request(`${base}/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', host: new URL(base).host, cookie }, body: JSON.stringify(body) });
    const signup = await req('/auth/signup', { name, email, password: PASSWORD });
    const cookie = signup.headers.get('set-cookie')!.split(';')[0]!;
    for (const d of domains) await addSite(async (p, j) => {
      const r = await req(p, j, cookie);
      return { status: r.status, body: await r.json() };
    }, kv.entries, d, 'Asia/Karachi');
  }
  browser = await chromium.launch({ executablePath: process.env.TW_CHROME_PATH || undefined });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => (api ? api.close(r) : r(undefined)));
});

const login = async (email: string): Promise<Page> => {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true })).newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL(/\/(dashboard|sites\/new)/);
  return page;
};

describe('super admin dashboard', { timeout: 90_000 }, () => {
  it('a customer has no "All accounts" link, and /admin sends them back', async () => {
    const page = await login('sara@kitchen.test');
    expect(await page.getByRole('link', { name: 'All accounts' }).count()).toBe(0);
    await page.goto(`${base}/admin`);
    await page.waitForURL(/\/dashboard/);
  });

  it('the team: all accounts -> one account -> report -> delete a site -> delete the account', async () => {
    const page = await login(ADMIN);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.getByRole('link', { name: 'All accounts' }).click();
    await page.getByTestId('admin-accounts').waitFor();
    const text = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    await expect.poll(async () => (await text()).includes('umar@realshop.test')).toBe(true);
    for (const want of ['Accounts', '3', 'Active sites', 'sara@kitchen.test', 'kitchen.test', 'blog.realshop-news.test']) expect(await text(), want).toContain(want);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/a1-accounts.png` });

    await page.getByLabel('Search accounts').fill('kitchen');
    await expect.poll(async () => page.getByTestId('admin-accounts').locator('li').count()).toBe(1);
    await page.getByLabel('Search accounts').fill('');
    await expect.poll(async () => page.getByTestId('admin-accounts').locator('li').count()).toBe(3);

    await page.getByRole('link', { name: /Umar Attique/ }).click();
    await page.getByTestId('admin-account').waitFor();
    for (const want of ['Umar Attique', 'umar@realshop.test', 'realshop.test', 'blog.realshop-news.test', 'owner', 'Added realshop.test']) expect(await text(), want).toContain(want);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/a2-account.png`, fullPage: true });

    // Report of one site.
    const row = page.locator('[data-site="realshop.test"]');
    const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: 'Report' }).click()]);
    expect(download.suggestedFilename()).toMatch(/^realshop\.test-.+\.csv$/);

    // Delete one site, keeping its data.
    await page.locator('[data-site="blog.realshop-news.test"]').getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Delete site' }).click();
    await expect.poll(async () => (await page.locator('[data-site="blog.realshop-news.test"]').innerText()).includes('Deleted')).toBe(true);
    expect(store.sites.find((s) => s.domain === 'blog.realshop-news.test')!.status).toBe('deleted');
    await expect.poll(async () => (await text()).includes('by the TailWatch team')).toBe(true);

    // Delete the account.
    await page.getByRole('button', { name: 'Delete account…' }).click();
    const confirm = page.getByRole('dialog');
    expect(await confirm.getByRole('button', { name: 'Delete account' }).isDisabled()).toBe(true);
    await confirm.getByRole('textbox').fill('DELETE');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/a3-delete.png` });
    await confirm.getByRole('button', { name: 'Delete account' }).click();
    await page.waitForURL(/\/admin$/);
    await expect.poll(async () => page.getByTestId('admin-accounts').locator('li').count()).toBe(2);
    expect(store.users.map((u) => u.email).sort()).toEqual(['sara@kitchen.test', ADMIN]);
    expect(errors).toEqual([]);
  });
});
