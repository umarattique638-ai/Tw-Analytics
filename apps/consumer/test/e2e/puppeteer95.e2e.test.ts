import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import puppeteer from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';
import { chromium } from 'playwright-core';
import selfsigned from 'selfsigned';
import { FIXTURE_SITE } from '../../../../packages/contract/fixtures/payloads';

/**
 * ⭐ THE Stage 7 exit test (BUILD-ORDER Stage 7, PLAN Phase 2):
 *   "reproduce Plausible's Puppeteer test and score 0 of 95 (GA4 scored 95/95) · every drop itemised
 *    and attributable".
 *
 * Plausible's test (plausible.io/blog/testing-bot-traffic-filtering-google-analytics, May 2025):
 * headless Puppeteer, ~10 sessions at a time, random delays, scroll in ~50% of visits, click a link
 * in ~30%, varied window sizes, three rounds:
 *   1. home network, User-Agent "PostmanRuntime/7.43.4"
 *   2. home network, a random one of four normal browser User-Agents
 *   3. datacentre IPs (one in Germany, one in the USA), same four User-Agents
 * GA4 reported 95 sessions, all as humans.
 *
 * Here: the same three rounds = 95 sessions, real Puppeteer + real Chromium + the real tracker (tw.js),
 * over HTTPS (so the browser sends client hints as in production), into the built collector and
 * consumer bundles on workerd, into a real ClickHouse. The network origin is simulated the only way it
 * can be locally: the collector's request.cf.asn (17557 = a Pakistani home ISP, 24940 = Hetzner DE,
 * 16509 = AWS US).
 * Plus a 4th round Plausible did not run: STEALTH bots (navigator.webdriver hidden, UA spoofed, home
 * network), which only the consumer's headless scoring can catch.
 *
 * Pass = 0 sessions and 0 events counted, and every hit the collector received is in dropped_hits with
 * a reason and detail.
 *
 * Needs: a Chromium (`pnpm --filter @tailwatch/collector exec playwright-core install chromium` once, or
 * TW_CHROME_PATH) and ClickHouse from the root .env (TW_CH_URL / TW_CH_USER / TW_CH_PASSWORD; a
 * throwaway database is created and dropped). Run: pnpm e2e:precision
 */

const CH = (process.env.TW_CH_URL ?? 'http://127.0.0.1:8123').replace(/\/+$/, '');
const ADMIN = process.env.TW_CH_USER ?? 'default';
const ADMIN_PASSWORD = process.env.TW_CH_PASSWORD ?? '';
const db = `tw_p95_${Date.now()}`;

async function sql(statement: string): Promise<string> {
  const res = await fetch(`${CH}/?select_sequential_consistency=1&output_format_json_quote_64bit_integers=1`, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': ADMIN, 'X-ClickHouse-Key': ADMIN_PASSWORD },
    body: statement,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`clickhouse_${res.status}: ${text.slice(0, 300)}`);
  return text.trim();
}
const rows = async (q: string) =>
  (await sql(`${q} FORMAT JSONEachRow`)).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, string | number>);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** "a random pick from four valid browser user-agent strings" (Plausible's rounds 2 and 3). */
const BROWSER_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
] as const;

interface Round {
  n: number;
  name: string;
  sessions: number;
  siteId: number;
  /** request.cf for the collector. */
  cf: (session: number) => { asn: number; country: string };
  ua: () => string;
  stealth?: boolean;
  /** Plausible's 95: rounds 1-3. Round 4 is ours. */
  plausible: boolean;
}

const ROUNDS: Round[] = [
  { n: 1, name: 'home network, PostmanRuntime UA', sessions: 25, siteId: 901, cf: () => ({ asn: 17557, country: 'PK' }), ua: () => 'PostmanRuntime/7.43.4', plausible: true },
  { n: 2, name: 'home network, 4 real browser UAs', sessions: 40, siteId: 902, cf: () => ({ asn: 17557, country: 'PK' }), ua: () => pick(BROWSER_UAS), plausible: true },
  { n: 3, name: 'datacentre (DE + US), 4 real browser UAs', sessions: 30, siteId: 903, cf: (s) => (s % 2 ? { asn: 24940, country: 'DE' } : { asn: 16509, country: 'US' }), ua: () => pick(BROWSER_UAS), plausible: true },
  { n: 4, name: 'STEALTH: webdriver hidden, UA spoofed, home network', sessions: 10, siteId: 904, cf: () => ({ asn: 17557, country: 'PK' }), ua: () => pick(BROWSER_UAS), stealth: true, plausible: false },
];
const keyOf = (siteId: number) => `tw_pub_PRECISION${String(siteId).padStart(4, '0')}${'0'.repeat(19)}`;

vi.setConfig({ testTimeout: 300_000, hookTimeout: 180_000 });

let mf: Miniflare;
let front: Server;
let port = 0;
let pages: Server;
const received = new Map<number, number>(); // siteId -> hits the collector answered

/** Which round + session a hit belongs to: from the page origin, s{session}-r{round}.bots.localhost */
function originOf(headers: Record<string, string | string[] | undefined>): { round: Round; session: number } | null {
  const from = String(headers.origin ?? headers.referer ?? '');
  const m = from.match(/s(\d+)-r(\d+)\.bots\.localhost/);
  const round = m ? ROUNDS.find((r) => r.n === Number(m[2])) : undefined;
  return round ? { round, session: Number(m![1]) } : null;
}

function site(path: string, key: string): string {
  const other = path === '/' ? '/pricing' : '/';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Shop ${path}</title>
<script async src="https://collector.localhost:${port}/tw.js?id=${key}" data-allow-local></script></head>
<body style="font:16px system-ui;margin:2rem"><h1>Example shop ${path}</h1>
${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae.</p>'.repeat(40)}
<a id="next" href="${other}">Go to ${other}</a></body></html>`;
}

beforeAll(async () => {
  const ddl = readFileSync(new URL('../../../../infra/clickhouse/001_contract.sql', import.meta.url), 'utf8');
  for (const statement of ddl.replace(/^--.*$/gm, '').replaceAll('tailwatch', db).split(';').map((s) => s.trim()).filter(Boolean)) {
    await sql(statement);
  }

  const dist = (app: string) => fileURLToPath(new URL(`../../../${app}/dist/index.js`, import.meta.url));
  const root = (app: string) => fileURLToPath(new URL(`../../../${app}/dist/`, import.meta.url));
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'collector',
          modules: true,
          scriptPath: dist('collector'),
          modulesRoot: root('collector'),
          compatibilityDate: '2026-09-01',
          kvNamespaces: { SITE_CONFIG: 'site-config' },
          queueProducers: { EVENTS: { queueName: 'tailwatch-events' } },
          bindings: { REGION: 'in', EXPOSE_DROP_REASON: 'true' },
        },
        {
          name: 'consumer',
          modules: true,
          scriptPath: dist('consumer'),
          modulesRoot: root('consumer'),
          compatibilityDate: '2026-09-01',
          queueConsumers: { 'tailwatch-events': { maxBatchSize: 25, maxBatchTimeout: 1, maxRetries: 5 } },
          durableObjects: { SESSIONS: { className: 'SessionStateObject', useSQLite: true } },
          r2Buckets: { ARCHIVE: 'tailwatch-raw' },
          bindings: {
            CLICKHOUSE_URL: CH,
            // Precision is under test here, not grants (the pipeline e2e covers the INSERT-only user).
            CLICKHOUSE_USER: ADMIN,
            CLICKHOUSE_PASSWORD: ADMIN_PASSWORD || 'unused',
            CLICKHOUSE_DATABASE: db,
            SESSION_SHARDS: '8',
          },
        },
      ],
    }),
  );
  const kv = await mf.getKVNamespace('SITE_CONFIG', 'collector');
  for (const r of ROUNDS) {
    await kv.put(`site:${keyOf(r.siteId)}`, JSON.stringify({ ...FIXTURE_SITE, id: r.siteId, publicKey: keyOf(r.siteId), allowedHosts: ['*.bots.localhost'] }));
  }

  const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    days: 2,
    keySize: 2048,
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 2, value: '*.localhost' }, { type: 2, value: '*.bots.localhost' }] }],
  });
  const tls = { key: pems.private, cert: pems.cert };
  const twJs = readFileSync(fileURLToPath(new URL('../../../../packages/browser/dist/cdn/tw.js', import.meta.url)), 'utf8');

  // ONE https server for everything; the Host header decides: collector.localhost or a bot's shop page.
  front = createServer(tls, async (req, res) => {
    const host = String(req.headers.host ?? '');
    if (host.startsWith('collector.localhost')) {
      if (req.url?.startsWith('/tw.js')) {
        res.writeHead(200, { 'content-type': 'application/javascript' });
        return res.end(twJs);
      }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const who = originOf(req.headers);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string' && k !== 'host') headers[k] = v;
      // A distinct client address per bot session, as separate machines would have.
      headers['cf-connecting-ip'] = who ? `198.51.${who.round.n}.${who.session + 1}` : '198.51.100.1';
      const r = await mf.dispatchFetch(`https://collector.localhost${req.url ?? '/'}`, {
        method: req.method,
        headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
        cf: (who ? who.round.cf(who.session) : { asn: 17557, country: 'PK' }) as Record<string, unknown>,
      });
      if (req.method === 'POST' && req.url === '/e' && who) received.set(who.round.siteId, (received.get(who.round.siteId) ?? 0) + 1);
      res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-encoding' && k !== 'content-length')));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const who = originOf({ origin: `https://${host}` });
    const path = (req.url ?? '/').split('?')[0]!;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(site(path === '/pricing' ? '/pricing' : '/', keyOf(who?.round.siteId ?? 0)));
  });
  await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
  port = (front.address() as AddressInfo).port;
  pages = front;
});

afterAll(async () => {
  await mf?.dispose();
  await new Promise((r) => (pages ? pages.close(r) : r(null)));
  if (process.env.TW_KEEP_TEST_DB === '1') {
    console.log(`TW_KEEP_TEST_DB=1: database ${db} kept. Afterwards: DROP DATABASE ${db}`);
    return;
  }
  await sql(`DROP DATABASE IF EXISTS ${db}`).catch(() => undefined);
});

/** One Plausible-style bot visit. */
async function visit(browser: Browser, round: Round, session: number): Promise<void> {
  const context = await browser.createBrowserContext(); // fresh cookies/storage: a new "visitor"
  try {
    const page = await context.newPage();
    await page.setUserAgent(round.ua());
    // "varied window sizes between sessions"
    await page.setViewport({ width: pick([800, 1024, 1280, 1366, 1440, 1920, 390, 412]), height: pick([600, 768, 900, 844]) });
    await page.goto(`https://s${session}-r${round.n}.bots.localhost:${port}/`, { waitUntil: 'load' });
    await wait(rnd(300, 1200)); // "random delays between actions"
    if (Math.random() < 0.5) {
      // "scrolled a bit in about 50% of visits"
      await page.evaluate(`window.scrollBy(0, ${rnd(400, 1200)})`);
      await wait(rnd(200, 800));
    }
    if (Math.random() < 0.3) {
      // "clicked a specific link to another page in about 30% of visits"
      await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#next')]);
      await wait(rnd(300, 900));
    }
    await page.close({ runBeforeUnload: false }); // pagehide -> the tracker's engagement beacon
  } finally {
    await context.close();
  }
}

async function runRound(round: Round): Promise<void> {
  const executablePath = process.env.TW_CHROME_PATH || chromium.executablePath();
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    acceptInsecureCerts: true,
    // Plausible's bots were plain Puppeteer. The stealth round removes the automation markers.
    ...(round.stealth ? { ignoreDefaultArgs: ['--enable-automation'] } : {}),
    args: [
      ...(round.stealth ? ['--disable-blink-features=AutomationControlled'] : []),
      // Chromium refuses to run as root (Linux CI / containers) without this. Not needed on Windows/macOS.
      ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
    ],
  });
  try {
    // "about 10 simultaneous sessions"
    for (let start = 0; start < round.sessions; start += 10) {
      const batch = Array.from({ length: Math.min(10, round.sessions - start) }, (_, i) => start + i);
      await Promise.all(batch.map((s) => visit(browser, round, s)));
    }
  } finally {
    await browser.close();
  }
}

describe("⭐ Stage 7: Plausible's Puppeteer test", () => {
  it('95 bot sessions in 3 rounds (+10 stealth): 0 counted, every hit itemised with its reason', async () => {
    for (const round of ROUNDS) await runRound(round);
    const sent = [...received.values()].reduce((a, b) => a + b, 0);
    expect(sent).toBeGreaterThanOrEqual(105); // at least one pageview per session reached the collector

    // Wait until the consumer has itemised every hit the collector answered.
    const ids = ROUNDS.map((r) => r.siteId).join(',');
    const started = Date.now();
    let itemised = 0;
    while (Date.now() - started < 90_000) {
      itemised = Number((await rows(`SELECT sum(hits) AS n FROM ${db}.dropped_hits WHERE site_id IN (${ids})`))[0]?.n ?? 0);
      if (itemised >= sent) break;
      await wait(500);
    }
    await wait(1500); // anything that would wrongly be COUNTED has had time to land too

    const counted = Number((await rows(`SELECT count() AS n FROM ${db}.events WHERE site_id IN (${ids})`))[0]?.n ?? 0);
    const sessions = Number((await rows(`SELECT sum(sign) AS n FROM ${db}.sessions WHERE site_id IN (${ids})`))[0]?.n ?? 0);
    const breakdown = await rows(
      `SELECT site_id, reason, detail, sum(hits) AS hits FROM ${db}.dropped_hits WHERE site_id IN (${ids}) GROUP BY site_id, reason, detail ORDER BY site_id, hits DESC`,
    );

    const lines = ROUNDS.map((r) => {
      const mine = breakdown.filter((b) => Number(b.site_id) === r.siteId);
      const reasons = mine.map((b) => `${b.reason}:${b.detail} ×${b.hits}`).join(', ');
      return `  round ${r.n}${r.plausible ? '' : ' (extra)'}  ${String(r.sessions).padStart(2)} sessions  ${r.name}\n      hits ${received.get(r.siteId) ?? 0} -> dropped: ${reasons}`;
    });
    console.log(
      `\n⭐ Plausible's Puppeteer test (GA4 counted 95 of 95 as human)\n${lines.join('\n')}\n` +
        `  TailWatch counted ${sessions} of 95 sessions (${counted} events). ${itemised} of ${sent} hits itemised in dropped_hits.\n`,
    );

    expect(counted).toBe(0);
    expect(sessions).toBe(0);
    expect(itemised).toBe(sent); // every drop itemised...
    for (const b of breakdown) expect(String(b.detail)).not.toBe(''); // ...and attributable

    // Each round is caught by the rule that should catch it. Measured detail: the engagement beacon a
    // closing page sends goes out AFTER Puppeteer's per-page UA override is gone, with the browser's own
    // "HeadlessChrome" UA, so a few hits per round are (correctly) dropped as ua_denylist instead.
    const only = (siteId: number, allowed: RegExp, main: RegExp) => {
      const d = details(siteId);
      expect(d.filter((x) => !allowed.test(x)), `site ${siteId}: ${d.join(', ')}`).toEqual([]);
      expect(d.some((x) => main.test(x)), `site ${siteId}: ${d.join(', ')}`).toBe(true);
    };
    const details = (siteId: number) => breakdown.filter((b) => Number(b.site_id) === siteId).map((b) => `${b.reason}:${b.detail}`);
    only(901, /^bot:ua_denylist$/, /^bot:ua_denylist$/);
    only(902, /^bot:(automation|ua_denylist)$/, /^bot:automation$/);
    only(903, /^bot:(datacentre_asn:(24940|16509)|ua_denylist)$/, /^bot:datacentre_asn:/);
    only(904, /^bot:(headless:.*js_ua_mismatch.*|ua_denylist)$/, /^bot:headless:/);
  });
});
