import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';
import { BROWSER_UA, FIXTURE_SITE } from '../../../../packages/contract/fixtures/payloads';

/**
 * Stage 4 done-when, in a real browser (Chromium via Playwright):
 *   real page -> tw.js -> collector on workerd (built bundle) -> Queue -> messages.
 *
 * The page lives on http://shop.example.com:<port> and the collector on
 * http://collector.example.com:<port> (both mapped to 127.0.0.1), so every hit is a real
 * cross-origin request, exactly like production. tw.js is the BUILT dist/cdn/tw.js.
 *
 * Needs a Chromium: in CI / locally run once
 *   pnpm --filter @tailwatch/collector exec playwright-core install chromium
 * or point TW_CHROME_PATH at an installed Chrome / Edge.
 *
 * Run: pnpm --filter @tailwatch/collector e2e
 */

const TW_JS = readFileSync(fileURLToPath(new URL('../../../../packages/browser/dist/cdn/tw.js', import.meta.url)), 'utf8');
const KEY = FIXTURE_SITE.publicKey;

const SINK = `
export default {
  async queue(batch, env) {
    for (const m of batch.messages) {
      await env.SINK.put(m.id, JSON.stringify(m.body));
      m.ack();
    }
  },
};`;

let mf: Miniflare;
/** Stands in for the deployed collector origin: /tw.js from the built file (Workers static assets
 *  in production), everything else forwarded to the Worker on workerd. No Playwright request
 *  interception anywhere: it would sit in the path of sendBeacon during unload and make it flaky. */
let front: Server;
let collector: string; // http://collector.example.com:<port>
let site: Server;
let shop: string; // http://shop.example.com:<port>
let browser: Browser;
let html = '';

type Hit = { createdAt: number; name: string; path: string; flags: number; seq: number; engagementMs?: number; props: Record<string, unknown>; referrer?: string };

async function events(minimum: number, settleMs = 600, timeoutMs = 10_000): Promise<Hit[]> {
  const sink = await mf.getKVNamespace('SINK', 'sink');
  const started = Date.now();
  const read = async () => {
    const { keys } = await sink.list();
    const all = await Promise.all(keys.map(async (k) => JSON.parse((await sink.get(k.name))!)));
    return all.filter((m) => m.type === 'event').map((m) => m.event as Hit).sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
  };
  for (;;) {
    const got = await read();
    if (got.length >= minimum || Date.now() - started > timeoutMs) {
      // Settle: catch anything that would make the count WRONG (a duplicate), not just short.
      await new Promise((r) => setTimeout(r, settleMs));
      return read();
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function drops(): Promise<string[]> {
  const sink = await mf.getKVNamespace('SINK', 'sink');
  const { keys } = await sink.list();
  const all = await Promise.all(keys.map(async (k) => JSON.parse((await sink.get(k.name))!)));
  return all.filter((m) => m.type === 'drop').map((m) => m.reason);
}

const tag = (attrs = '', query = `?id=${KEY}`) => `<script async src="${collector}/tw.js${query}" ${attrs}></script>`;
const doc = (head: string, body = '') => `<!doctype html><html><head><title>shop</title>${head}</head><body>${body}</body></html>`;

/** Opens a page; collects every request it makes to the collector. */
async function open(path: string, init?: string) {
  const context = await browser.newContext({ userAgent: BROWSER_UA });
  const page = await context.newPage();
  if (init) await page.addInitScript(init);
  const requests: { method: string; type: string; contentType?: string }[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(`${collector}/e`)) {
      requests.push({ method: r.method(), type: r.resourceType(), contentType: r.headers()['content-type'] });
    }
  });
  await page.goto(`${shop}${path}`);
  await page.waitForFunction(`typeof window.__tw === 'object'`);
  return { page, requests, close: () => context.close() };
}

const go = (page: Page, fn: string) => page.evaluate(fn);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      workers: [
        {
          name: 'collector',
          modules: true,
          scriptPath: fileURLToPath(new URL('../../dist/index.js', import.meta.url)),
          compatibilityDate: '2026-09-01',
          kvNamespaces: { SITE_CONFIG: 'site-config' },
          queueProducers: { EVENTS: { queueName: 'tailwatch-events' } },
          ratelimits: {
            RATE_LIMITER: { namespace_id: '1001', simple: { limit: 100_000, period: 10 } },
            RATE_LIMITER_IP: { namespace_id: '1002', simple: { limit: 100_000, period: 10 } },
          },
          bindings: { REGION: 'in', EXPOSE_DROP_REASON: 'true' },
        },
        {
          name: 'sink',
          modules: [{ type: 'ESModule', path: 'sink.mjs', contents: SINK }],
          compatibilityDate: '2026-09-01',
          kvNamespaces: { SINK: 'sink' },
          queueConsumers: { 'tailwatch-events': { maxBatchSize: 100, maxBatchTimeout: 1 } },
        },
      ],
    }),
  );
  const worker = await mf.ready;
  front = createServer(async (req, res) => {
    if (req.url?.startsWith('/tw.js')) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      return res.end(TW_JS);
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'host') headers.set(k, v);
    headers.set('cf-connecting-ip', '198.51.100.7');
    const r = await fetch(new URL(req.url ?? '/', worker), {
      method: req.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-encoding' && k !== 'content-length')));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
  collector = `http://collector.example.com:${(front.address() as AddressInfo).port}`;
  const kv = await mf.getKVNamespace('SITE_CONFIG', 'collector');
  await kv.put(`site:${KEY}`, JSON.stringify(FIXTURE_SITE)); // allowedHosts: example.com, *.example.com

  site = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  shop = `http://shop.example.com:${(site.address() as AddressInfo).port}`;

  browser = await chromium.launch({
    executablePath: process.env.TW_CHROME_PATH || undefined,
    args: ['--host-resolver-rules=MAP *.example.com 127.0.0.1', '--enable-features=BackForwardCache'],
  });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => site?.close(r));
  await new Promise((r) => front?.close(r));
  await mf?.dispose();
});

beforeEach(async () => {
  const sink = await mf.getKVNamespace('SINK', 'sink');
  for (const k of (await sink.list()).keys) await sink.delete(k.name);
});

// Headless Chromium says "HeadlessChrome" and the edge drops it as a bot (proved: x-tw-dropped: bot),
// so every context presents the ordinary desktop Chrome UA the contract fixtures use.
describe('tracker in Chromium -> collector on workerd', { timeout: 30_000 }, () => {
  it('headless Chromium itself is dropped as a bot (the edge rule works on a real browser)', async () => {
    html = doc(tag());
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${shop}/headless`);
    for (let i = 0; i < 50 && (await drops()).length === 0; i++) await wait(100);
    await context.close();
    expect(await drops()).toEqual(['bot']);
  });

  it('script tag: exactly one first pageview, text/plain, never a preflight', async () => {
    html = doc(tag());
    const { requests, close } = await open('/pricing/?utm_source=news&email=a@b.com');
    const got = await events(1);
    await close();

    expect(await drops()).toEqual([]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ name: 'pageview', path: '/pricing', flags: 1, seq: 1 });
    expect(requests.map((r) => r.method)).toEqual(['POST']);
    expect(requests[0]!.contentType).toMatch(/^text\/plain/);
  });

  for (const navigationApi of [true, false]) {
    it(`SPA (${navigationApi ? 'Navigation API' : 'history patch fallback'}): one pageview per navigation`, async () => {
      html = doc(tag());
      const { page, requests, close } = await open('/', navigationApi ? undefined : 'Object.defineProperty(window, "navigation", { value: undefined });');
      expect(await page.evaluate(`!!window.navigation`)).toBe(navigationApi);
      await events(1);
      await go(page, `history.pushState({}, '', '/a')`);
      await wait(150);
      await go(page, `history.replaceState({}, '', '/a?sort=price')`); // filter change: not a page
      await go(page, `history.pushState({}, '', '/a/')`); // trailing slash: same page
      await go(page, `history.pushState({}, '', '/b'); history.pushState({}, '', '/b')`); // StrictMode-style double
      await wait(150);
      await go(page, `location.hash = 'reviews'`); // anchor, not a hash route
      await wait(150);
      await go(page, `history.back()`); // traverse: /b#reviews -> /b ... still /b
      await wait(150);
      await go(page, `history.go(-3)`); // back to /a
      const got = await events(4);
      await close();

      expect(got.map((e) => e.path)).toEqual(['/', '/a', '/b', '/a']);
      expect(got.map((e) => e.flags)).toEqual([1, 0, 0, 0]);
      expect(requests.every((r) => r.method === 'POST')).toBe(true);
    });
  }

  it('hash router (data-hash): #/route changes are pages, with A4 paths', async () => {
    html = doc(tag('data-hash'));
    const { page, close } = await open('/#/home');
    await events(1);
    await go(page, `location.hash = '#/settings'`);
    await wait(150);
    await go(page, `history.pushState({}, '', '#/users/7/')`);
    const got = await events(3);
    await close();
    expect(got.map((e) => [e.path, e.flags])).toEqual([['/#/home', 3], ['/#/settings', 2], ['/#/users/7', 2]]);
  });

  it('script loaded twice: the second copy is a no-op', async () => {
    html = doc(tag() + tag());
    const { close } = await open('/twice');
    const got = await events(1, 1000);
    await close();
    expect(got).toHaveLength(1);
  });

  it('stub queue: calls made before the script loaded are replayed', async () => {
    html = doc(`<script>window.tw=window.tw||function(){(tw.q=tw.q||[]).push(arguments)}; tw('track','signup',{plan:'pro'});</script>${tag()}`);
    const { page, close } = await open('/signup');
    await go(page, `tw('track', 'cta_click', { position: 2 })`);
    const got = await events(3);
    await close();
    expect(got.map((e) => [e.name, e.props])).toEqual([
      ['pageview', {}],
      ['signup', { plan: 'pro' }],
      ['cta_click', { position: 2 }],
    ]);
  });

  it('consent required: nothing leaves the browser until granted', async () => {
    html = doc(tag('data-consent="required"'));
    const { page, requests, close } = await open('/consent');
    await go(page, `tw('track', 'early')`);
    await wait(500);
    expect(requests).toHaveLength(0);
    await go(page, `tw('consent', 'granted')`);
    const got = await events(2);
    await close();
    expect(got.map((e) => [e.name, e.seq])).toEqual([['pageview', 1], ['early', 2]]);
  });

  it('consent denied: the buffer is discarded', async () => {
    html = doc(tag('data-consent="required"'));
    const { page, requests, close } = await open('/denied');
    await go(page, `tw('consent', 'denied'); tw('track', 'after')`);
    await wait(500);
    await close();
    expect(requests).toHaveLength(0);
  });

  it('visitor opt-out (?tw_disable=1) persists across page loads', async () => {
    html = doc(tag());
    const { page, requests, close } = await open('/?tw_disable=1');
    await page.goto(`${shop}/later`);
    await page.waitForFunction(`typeof window.__tw === 'object'`);
    await wait(500);
    await close();
    expect(requests).toHaveLength(0);
  });

  it('engagement: shipped as a beacon when the page goes away', async () => {
    html = doc(tag());
    const { page, requests, close } = await open('/article');
    await page.bringToFront();
    expect(await page.evaluate(`document.hasFocus()`)).toBe(true);
    await wait(1_500);
    await page.goto('about:blank'); // pagehide -> sendBeacon
    const got = await events(2);
    await close();
    expect(got.map((e) => e.name), JSON.stringify(requests)).toEqual(['pageview', 'engagement']);
    expect(got[1]!.engagementMs).toBeGreaterThanOrEqual(1_000);
    expect(got[1]!.path).toBe('/article');
    expect(requests.every((r) => r.method === 'POST' && /^text\/plain/.test(r.contentType ?? ''))).toBe(true);
  });

  it('back navigation: the page shown again records exactly one pageview', async () => {
    html = doc(tag());
    const { page, close } = await open('/from', 'addEventListener("pageshow", (e) => { window.__persisted = e.persisted; });');
    await page.goto(`${shop}/to`);
    await page.waitForFunction(`typeof window.__tw === 'object'`);
    await page.goBack();
    await page.waitForFunction(`typeof window.__tw === 'object'`);
    const persisted = await page.evaluate(`window.__persisted`);
    const got = (await events(3)).filter((e) => e.name === 'pageview');
    await close();
    // Restored from bfcache: the old page instance sends a non-first pageview (persisted).
    // If the browser reloads instead, the fresh page sends its first pageview. 3 views either way.
    expect(got.map((e) => [e.path, e.flags])).toEqual([['/from', 1], ['/to', 1], ['/from', persisted ? 0 : 1]]);
    console.log(`bfcache restore in this Chromium: ${persisted ? 'yes (pageshow.persisted path tested)' : 'no (reload path tested)'}`);
  });

  it('pageshow with persisted=true sends a pageview for the same URL (bfcache listener wiring)', async () => {
    // Headless Chromium does not always restore from bfcache, so the event is dispatched directly.
    html = doc(tag());
    const { page, close } = await open('/restored');
    await events(1);
    await go(page, `dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))`);
    await go(page, `dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }))`);
    const got = await events(2);
    await close();
    expect(got.map((e) => [e.path, e.flags])).toEqual([['/restored', 1], ['/restored', 0]]);
  });

  it('the demo site (apps/demo) records what its page says it should', async () => {
    html = readFileSync(fileURLToPath(new URL('../../../demo/public/index.html', import.meta.url)), 'utf8')
      .replace('https://tailwatch-collector.umarattique638.workers.dev', collector);
    const { page, close } = await open(`/?key=${KEY}`);
    await events(1);
    const click = async (role: 'link' | 'button', name: string) => {
      await page.getByRole(role, { name, exact: true }).click();
      await wait(120);
    };
    await click('link', 'Pricing');
    await click('button', 'Sort by price (replaceState)');
    await click('link', 'Docs');
    await click('link', 'Docs');
    await click('button', 'Sign up (custom event)');
    const got = await events(4);
    await close();
    expect(got.map((e) => [e.name, e.path])).toEqual([
      ['pageview', '/'],
      ['pageview', '/pricing'],
      ['pageview', '/docs'],
      ['signup', '/docs'],
    ]);
  });

  it('does not track localhost unless data-allow-local', async () => {
    html = doc(tag());
    const context = await browser.newContext({ userAgent: BROWSER_UA });
    const page = await context.newPage();
    let sent = 0;
    page.on('request', (r) => r.url().startsWith(`${collector}/e`) && sent++);
    await page.goto(`http://localhost:${(site.address() as AddressInfo).port}/`);
    await page.waitForFunction(`typeof window.__tw === 'object'`);
    await wait(300);
    await context.close();
    expect(sent).toBe(0);
  });
});
