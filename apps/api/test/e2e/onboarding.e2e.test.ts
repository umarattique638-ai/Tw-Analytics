import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BROWSER_UA, startStack, wait } from '../../../collector/test/e2e/harness';
import type { Stack } from '../../../collector/test/e2e/harness';
import { createApp } from '../../src/app';
import type { AnalyticsReader } from '../../src/analytics';
import { defaultConfig } from '../../src/config';
import { MemoryStore } from '../../src/store/memory';

/**
 * Stage 5 done-when (BUILD-ORDER): "a brand-new user can sign up, add a site, copy a snippet, install
 * it, pass verification, and see their first pageview — unaided, with no one touching a database."
 *
 * Everything below happens through the dashboard in Chromium, like a customer would do it:
 *   dashboard (apps/web, built) + API (createApp) on http://app.example.com:<port>
 *   customer site on http://shop.example.com:<port>, whose HTML is whatever snippet the customer copied
 *   collector on workerd + its KV (the API writes the site there) + queue (see collector harness)
 * The store is the in-memory one with the real validators; test/live runs the same API on real MongoDB.
 *
 * Run: pnpm --filter @tailwatch/api e2e
 */
const WEB = fileURLToPath(new URL('../../../web/dist/', import.meta.url));

let stack: Stack;
let api: ServerType;
let app: string;
let shopServer: Server;
let shop: string;
/** TW_SCREENSHOTS=<folder> saves a picture of every onboarding screen (for reviewing the UI). */
const shots = process.env.TW_SCREENSHOTS;
const snap = async (page: Awaited<ReturnType<Stack['browser']['newPage']>>, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
};
let shopHtml = '<!doctype html><title>shop</title><p>not installed yet</p>';

/** The verifier runs in Node, which cannot resolve *.example.com: map them to loopback like Chromium does. */
const loopbackFetch: typeof fetch = (input, init) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.hostname.endsWith('.example.com')) url.hostname = '127.0.0.1';
  return fetch(url, init);
};

beforeAll(async () => {
  if (!existsSync(`${WEB}index.html`)) throw new Error('Build the dashboard first: pnpm --filter @tailwatch/web build');
  stack = await startStack();

  // Analytics reader over what reached the queue (in production: ClickHouse via tw_read).
  const analytics: AnalyticsReader = {
    async recent(siteId) {
      const { events, drops } = await stack.snapshot();
      const mine = events.filter((e) => e.siteId === siteId).sort((a, b) => a.createdAt - b.createdAt);
      const last = mine[mine.length - 1];
      return {
        events: mine.length,
        pageviews: mine.filter((e) => e.name === 'pageview').length,
        last: last ? { at: new Date(last.createdAt).toISOString(), name: last.name, path: last.path } : null,
        drops: drops.filter((d) => d.siteId === siteId).map((d) => ({ reason: d.reason, hits: 1, detail: d.detail ?? '' })),
      };
    },
  };

  const server = new Hono();
  server.route(
    '/',
    createApp({
      store: new MemoryStore(),
      kv: stack.siteConfig,
      analytics,
      config: defaultConfig({ collectorUrl: stack.collector, secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 }, verifierAllowPrivate: true }),
      verifier: { fetchImpl: loopbackFetch, allowPrivate: true },
    }),
  );
  const index = readFileSync(`${WEB}index.html`, 'utf8');
  server.use('/*', serveStatic({ root: relative(process.cwd(), WEB) }));
  server.get('*', (c) => c.html(index));
  await new Promise<void>((resolve) => {
    api = serve({ fetch: server.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve());
  });
  app = `http://app.example.com:${(api.address() as AddressInfo).port}`;

  shopServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(shopHtml);
  });
  await new Promise<void>((resolve) => shopServer.listen(0, '127.0.0.1', resolve));
  shop = `http://shop.example.com:${(shopServer.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  await new Promise((r) => shopServer?.close(r));
  await new Promise((r) => (api ? api.close(r) : r(undefined)));
  await stack?.close();
});

describe('Stage 5 done-when, through the dashboard in Chromium', { timeout: 120_000 }, () => {
  it('sign up -> add site -> copy snippet -> install -> verify -> first pageview, unaided', async () => {
    const context = await stack.browser.newContext({ userAgent: BROWSER_UA });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // ① Sign up
    await page.goto(`${app}/signup`);
    await page.getByLabel('Full name').fill('Umar Attique');
    await page.getByLabel('Work email').fill('umar@shop.example.com');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByLabel('Confirm password').fill('correct horse battery');
    await snap(page, '1-signup');
    await page.getByRole('button', { name: 'Create account' }).click();

    // ② Add a site (the accepted hosts come from the API while typing)
    await page.waitForURL('**/sites/new');
    await page.getByLabel('Domain').fill('https://www.Shop.Example.com/');
    await expect.poll(() => page.getByText('*.shop.example.com').count()).toBe(1);
    await snap(page, '2-add-site');
    await page.getByRole('button', { name: 'Add site' }).click();

    // ③ Copy the snippet (the API generated it)
    await page.waitForURL('**/install');
    const snippet = (await page.getByTestId('snippet').textContent())!;
    await snap(page, '3-install');
    expect(snippet).toMatch(new RegExp(`^<script async fetchpriority="low" src="${stack.collector}/tw\\.js\\?id=tw_pub_[A-Za-z0-9]{32}"></script>$`));

    // ④ Install: the customer pastes it into their site's <head>
    shopHtml = `<!doctype html><html><head><title>Shop</title>${snippet}</head><body><h1>Shop</h1></body></html>`;
    await page.getByRole('button', { name: 'I added it' }).click();
    await page.waitForURL('**/verify');
    await expect.poll(() => page.getByText('Waiting for your first pageview').count()).toBe(1);

    // ⑤ Active check against the real page
    await page.getByLabel('Page to check').fill(`${shop}/`);
    await page.getByRole('button', { name: 'Run check' }).click();
    await page.locator('[data-check="csp"]').waitFor();
    const results = await page.locator('[data-check]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-check')}:${e.getAttribute('data-status')}`));
    expect(results).toEqual(['reach:pass', 'present:pass', 'noscript:pass', 'once:pass', 'id:pass', 'script:pass', 'csp:pass']);

    // ⑥ A visitor opens the shop: the first pageview shows up on the verify screen by itself
    const visitor = await context.newPage();
    await visitor.goto(`${shop}/pricing`);
    await page.getByTestId('first-pageview').waitFor({ timeout: 30_000 });
    await snap(page, '4-verify');
    expect(await page.getByTestId('first-pageview').textContent()).toContain('/pricing');

    // The verifier's own visit was never counted: exactly one event, the visitor's pageview.
    const { events } = await stack.snapshot();
    expect(events.map((e) => [e.name, e.path])).toEqual([['pageview', '/pricing']]);

    // Done: the dashboard opens for the verified site
    await page.getByRole('button', { name: 'Finish and go to dashboard' }).click();
    await page.getByText(/Good (morning|afternoon|evening), Umar\./).waitFor();
    await snap(page, '5-dashboard');
    expect(errors).toEqual([]);

    // Log out, log back in: the site is still there
    await page.getByRole('button', { name: 'Logout' }).click();
    await page.waitForURL('**/login');
    await page.getByLabel('Work email').fill('UMAR@shop.example.com');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByText(/Good (morning|afternoon|evening), Umar\./).waitFor();
    expect(await page.getByText('shop.example.com').first().isVisible()).toBe(true);
    await context.close();
    await wait(10);
  });

  it('a wrong snippet is diagnosed in words the customer can act on', async () => {
    const context = await stack.browser.newContext({ userAgent: BROWSER_UA });
    const page = await context.newPage();
    await page.goto(`${app}/signup`);
    await page.getByLabel('Full name').fill('Second');
    await page.getByLabel('Work email').fill('second@shop.example.com');
    await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
    await page.getByLabel('Confirm password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/sites/new');
    await page.getByLabel('Domain').fill('shop.example.com');
    await page.getByRole('button', { name: 'Add site' }).click();
    await page.waitForURL('**/install');
    // The shop still carries the FIRST customer's snippet: wrong key for this account.
    await page.getByRole('button', { name: 'I added it' }).click();
    await page.getByLabel('Page to check').fill(`${shop}/`);
    await page.getByRole('button', { name: 'Run check' }).click();
    await page.locator('[data-check="id"][data-status="fail"]').waitFor();
    expect(await page.locator('[data-check="id"]').textContent()).toContain('different site key');
    await context.close();
  });
});
