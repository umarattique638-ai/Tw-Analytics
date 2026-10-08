#!/usr/bin/env node
/**
 * Stage 7, LIVE: Plausible's Puppeteer test against YOUR deployed site, from YOUR computer.
 *
 *   pnpm bots:live                                   (folder: repository root)
 *   pnpm bots:live -- --site 101 --url https://tailwatch-demo.umarattique638.workers.dev/
 *
 * 95 headless Puppeteer sessions from your home network, in Plausible's style (random delays, scroll in
 * ~50%, click a link in ~30%, varied window sizes):
 *   round 1   25 sessions  User-Agent PostmanRuntime/7.43.4
 *   round 2   40 sessions  a random one of four real browser User-Agents (navigator.webdriver = true)
 *   round 3   30 sessions  STEALTH: webdriver hidden, User-Agent spoofed (Plausible's round 3 was from
 *                          datacentres; that one is in the e2e test, a home PC cannot be a datacentre)
 * Then it asks ClickHouse (read-only user tw_read, from the root .env) what was counted and what was
 * dropped since the test started. PASS = 0 events and 0 sessions counted, and the drops itemised.
 *
 * Do not open the site yourself while this runs (you would be counted, correctly).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromium } from 'playwright-core';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const SITE = Number(arg('site', '101'));
const URL_ = arg('url', 'https://tailwatch-demo.umarattique638.workers.dev/');
const CH = (process.env.TW_CH_URL ?? '').replace(/\/+$/, '');
const USER = process.env.TW_CH_READ_USER || 'tw_read';
const PASSWORD = process.env.TW_CH_READ_PASSWORD ?? '';
if (!CH || !PASSWORD) {
  console.error('Missing TW_CH_URL or TW_CH_READ_PASSWORD in the root .env (the read-only user from Stage 6).');
  process.exit(1);
}

const UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
];
const ROUNDS = [
  { n: 1, name: 'PostmanRuntime UA', sessions: 25, ua: () => 'PostmanRuntime/7.43.4' },
  { n: 2, name: '4 real browser UAs (webdriver on)', sessions: 40, ua: () => pick(UAS) },
  { n: 3, name: 'STEALTH: webdriver hidden, UA spoofed', sessions: 30, ua: () => pick(UAS), stealth: true },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

async function sql(query) {
  const res = await fetch(`${CH}/?default_format=JSONEachRow&output_format_json_quote_64bit_integers=1`, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': USER, 'X-ClickHouse-Key': PASSWORD },
    body: query,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 300)}`);
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function visit(browser, round) {
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setUserAgent(round.ua());
    await page.setViewport({ width: pick([800, 1024, 1280, 1366, 1440, 1920, 390, 412]), height: pick([600, 768, 900, 844]) });
    await page.goto(URL_, { waitUntil: 'load', timeout: 30_000 });
    await wait(rnd(500, 2000));
    if (Math.random() < 0.5) {
      await page.evaluate(`window.scrollBy(0, ${rnd(400, 1200)})`);
      await wait(rnd(300, 1000));
    }
    if (Math.random() < 0.3) {
      const href = await page.evaluate(`(() => { const a = [...document.querySelectorAll('a[href]')].find((x) => x.host === location.host && x.pathname !== location.pathname); return a ? a.href : null; })()`);
      if (href) {
        await page.goto(href, { waitUntil: 'load', timeout: 30_000 });
        await wait(rnd(500, 1500));
      }
    }
    await page.close({ runBeforeUnload: false });
  } catch (e) {
    console.log(`  (a session failed: ${e instanceof Error ? e.message.split('\n')[0] : e})`);
  } finally {
    await context.close();
  }
}

const started = Date.now();
console.log(`\nPlausible's Puppeteer test, LIVE: site ${SITE}, ${URL_}`);
console.log('Do not open the site yourself until this finishes.\n');
for (const round of ROUNDS) {
  process.stdout.write(`round ${round.n}: ${round.sessions} sessions, ${round.name} ... `);
  const browser = await puppeteer.launch({
    executablePath: process.env.TW_CHROME_PATH || chromium.executablePath(),
    headless: true,
    ...(round.stealth ? { ignoreDefaultArgs: ['--enable-automation'] } : {}),
    args: [...(round.stealth ? ['--disable-blink-features=AutomationControlled'] : []), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  });
  try {
    for (let s = 0; s < round.sessions; s += 10) {
      await Promise.all(Array.from({ length: Math.min(10, round.sessions - s) }, () => visit(browser, round)));
    }
  } finally {
    await browser.close();
  }
  console.log('done');
}

console.log('\nWaiting for the queue + consumer (up to 2 minutes) ...');
const since = `fromUnixTimestamp64Milli(${started})`;
let drops = [];
let last = -1;
for (let i = 0; i < 24; i += 1) {
  await wait(5000);
  drops = await sql(`SELECT reason, detail, sum(hits) AS hits FROM tailwatch.dropped_hits WHERE site_id = ${SITE} AND at >= toStartOfMinute(${since}) GROUP BY reason, detail ORDER BY hits DESC`);
  const total = drops.reduce((a, d) => a + Number(d.hits), 0);
  if (total > 0 && total === last) break;
  last = total;
}
const [{ n: events }] = await sql(`SELECT count() AS n FROM tailwatch.events WHERE site_id = ${SITE} AND received_at >= ${since}`);
const [{ n: sessions }] = await sql(`SELECT sum(sign) AS n FROM tailwatch.sessions WHERE site_id = ${SITE} AND start >= ${since}`);
const total = drops.reduce((a, d) => a + Number(d.hits), 0);

console.log(`\nDropped (itemised in dropped_hits, also on your dashboard's Suspicious activity page):`);
for (const d of drops) console.log(`  ${String(d.hits).padStart(4)}  ${d.reason}:${d.detail}`);
console.log(`\nGA4 counted 95 of 95 as human. TailWatch counted ${Number(sessions)} of 95 sessions (${Number(events)} events); ${total} hits dropped with a reason.`);
const ok = Number(events) === 0 && Number(sessions) === 0 && total >= 95;
console.log(ok ? '\nPASS: 0 of 95 ✔\n' : '\nNOT PASSED: see the numbers above (did someone open the site during the test? are the new collector + consumer deployed?)\n');
process.exit(ok ? 0 : 1);
