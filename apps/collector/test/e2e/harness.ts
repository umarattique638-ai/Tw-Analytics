import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';
import { BROWSER_UA, FIXTURE_SITE } from '../../../../packages/contract/fixtures/payloads';

/**
 * Shared Stage 4 browser harness (tracker e2e here, framework apps in examples/e2e):
 *
 *   Chromium page on *.example.com  ->  http://collector.example.com:<port>  ->  collector on workerd
 *                                       (/tw.js = built dist/cdn/tw.js,       ->  Queue -> sink KV
 *                                        everything else forwarded)
 *
 * Every *.example.com name resolves to 127.0.0.1 inside Chromium, so pages and collector are on
 * different origins exactly like production. No Playwright request interception anywhere: it sits in
 * the path of sendBeacon during unload and made the engagement beacon flaky.
 *
 * Needs a Chromium: `pnpm --filter @tailwatch/collector exec playwright-core install chromium`
 * once, or TW_CHROME_PATH pointing at an installed Chrome / Edge.
 */

export { BROWSER_UA };
export const KEY = FIXTURE_SITE.publicKey;
/**
 * A second site for apps served from *.localhost (the framework dev servers in examples/e2e).
 * Chromium resolves *.localhost to loopback itself, and Next/Vite dev servers accept it without
 * extra config, so their HMR websockets connect (Next only hydrates once HMR is connected).
 * The tracker skips localhost unless allowLocal is set, so those apps set it.
 */
export const LOCAL_KEY = 'tw_pub_LOCALHOSTDEVSITE0000000000000001';
const LOCAL_SITE = { ...FIXTURE_SITE, id: 124, publicKey: LOCAL_KEY, allowedHosts: ['localhost', '*.localhost'] };
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Hit = {
  createdAt: number;
  name: string;
  path: string;
  flags: number;
  seq: number;
  engagementMs?: number;
  props: Record<string, unknown>;
  referrer?: string;
};

export interface Stack {
  /** http://collector.example.com:<port> */
  collector: string;
  browser: Browser;
  /** Waits for at least `minimum` accepted events, then settles to catch duplicates. */
  events(minimum: number, settleMs?: number, timeoutMs?: number): Promise<Hit[]>;
  drops(): Promise<string[]>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

const SINK = `
export default {
  async queue(batch, env) {
    for (const m of batch.messages) {
      await env.SINK.put(m.id, JSON.stringify(m.body));
      m.ack();
    }
  },
};`;

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export async function startStack(): Promise<Stack> {
  const twJs = readFileSync(here('../../../../packages/browser/dist/cdn/tw.js'), 'utf8');
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      host: '127.0.0.1',
      port: 0,
      workers: [
        {
          name: 'collector',
          modules: true,
          scriptPath: here('../../dist/index.js'),
          // Module names are relative to this root; without it a run from another package's folder
          // (examples/e2e) fails with "can't use '..' to break out of starting directory".
          modulesRoot: here('../../dist'),
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
  const kv = await mf.getKVNamespace('SITE_CONFIG', 'collector');
  await kv.put(`site:${KEY}`, JSON.stringify(FIXTURE_SITE)); // allowedHosts: example.com, *.example.com
  await kv.put(`site:${LOCAL_KEY}`, JSON.stringify(LOCAL_SITE));

  const front: Server = createServer(async (req, res) => {
    if (req.url?.startsWith('/tw.js')) {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      return res.end(twJs);
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

  const browser = await chromium.launch({
    executablePath: process.env.TW_CHROME_PATH || undefined,
    args: ['--host-resolver-rules=MAP *.example.com 127.0.0.1', '--enable-features=BackForwardCache'],
  });

  const messages = async () => {
    const sink = await mf.getKVNamespace('SINK', 'sink');
    const { keys } = await sink.list();
    return Promise.all(keys.map(async (k) => JSON.parse((await sink.get(k.name))!)));
  };
  const read = async () =>
    (await messages())
      .filter((m) => m.type === 'event')
      .map((m) => m.event as Hit)
      .sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);

  return {
    collector: `http://collector.example.com:${(front.address() as AddressInfo).port}`,
    browser,
    async events(minimum, settleMs = 600, timeoutMs = 10_000) {
      const started = Date.now();
      for (;;) {
        const got = await read();
        if (got.length >= minimum || Date.now() - started > timeoutMs) {
          // Settle: catch anything that would make the count WRONG (a duplicate), not just short.
          await wait(settleMs);
          return read();
        }
        await wait(100);
      }
    },
    async drops() {
      return (await messages()).filter((m) => m.type === 'drop').map((m) => m.reason);
    },
    async clear() {
      const sink = await mf.getKVNamespace('SINK', 'sink');
      for (const k of (await sink.list()).keys) await sink.delete(k.name);
    },
    async close() {
      await browser.close();
      await new Promise((r) => front.close(r));
      await mf.dispose();
    },
  };
}
