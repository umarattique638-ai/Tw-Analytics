import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClickHouseClient } from '../../src/analytics';
import { StatsReader, resolveRange } from '../../src/stats';

/**
 * Stage 6 on a REAL ClickHouse (the owner's ClickHouse Cloud, or a local server in CI): known rows go
 * into a scratch database, and every dashboard number must come out exactly as computed by hand here.
 * Includes the BUILD-ORDER done-when "correct across a DST boundary" (Europe/London, 25 Oct 2026).
 *
 * Run: pnpm --filter @tailwatch/api live     (TW_CH_URL / TW_CH_USER / TW_CH_PASSWORD from the root .env)
 */
const env = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(env)) process.loadEnvFile(env);
const URL_ = process.env.TW_CH_URL?.replace(/\/+$/, '');
const USER = process.env.TW_CH_USER ?? 'default';
const PASSWORD = process.env.TW_CH_PASSWORD ?? '';
const DB = `tw_stats_${Date.now()}`;

async function sql(statement: string, body?: string): Promise<string> {
  const qs = new URLSearchParams({ select_sequential_consistency: '1' });
  if (body !== undefined) qs.set('query', statement);
  const res = await fetch(`${URL_}/?${qs}`, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': USER, 'X-ClickHouse-Key': PASSWORD },
    body: body ?? statement,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 300)}`);
  return text;
}
const insert = (table: string, rows: object[]) => sql(`INSERT INTO ${DB}.${table} FORMAT JSONEachRow`, rows.map((r) => JSON.stringify(r)).join('\n'));

/** ClickHouse DateTime64 text for an ISO instant. */
const ts = (iso: string) => iso.replace('T', ' ').replace('Z', '');

const KHI = 101; // Asia/Karachi site
const LON = 102; // Europe/London site (DST)
const TABS = 103; // two tabs, interleaved
const NOW = new Date('2026-10-08T10:00:00Z'); // 15:00 in Karachi

let stats: StatsReader;

function ev(site: number, at: string, visitor: number, seq: number, over: Record<string, unknown> = {}) {
  return {
    site_id: site, insert_id: `${site}-${at}-${visitor}-${seq}`, name: 'pageview', timestamp: ts(at), received_at: ts(at),
    pathname: '/', visitor_hash: visitor, session_id: 1, seq, device: 'desktop', browser: 'Chrome', country_code: 'PK', ...over,
  };
}
function session(site: number, start: string, visitor: number, over: Record<string, unknown> = {}) {
  return { site_id: site, session_id: visitor, visitor_hash: visitor, start: ts(start), last_seen: ts(start), pageviews: 1, is_engaged: 0, sign: 1, version: 1, ...over };
}

beforeAll(async () => {
  if (!URL_) return;
  const ddl = readFileSync(new URL('../../../../infra/clickhouse/001_contract.sql', import.meta.url), 'utf8');
  for (const statement of ddl.replace(/^--.*$/gm, '').replaceAll('tailwatch', DB).split(';').map((s) => s.trim()).filter(Boolean)) {
    await sql(statement);
  }
  stats = new StatsReader(new ClickHouseClient(URL_, USER, PASSWORD, DB, fetch, { sequentialConsistency: true }));

  // ---- Karachi site, "today" = 2026-10-08 local (2026-10-07T19:00Z .. 2026-10-08T19:00Z)
  await insert('events', [
    ev(KHI, '2026-10-07T18:59:00Z', 9, 1, { pathname: '/yesterday' }), // 23:59 on Oct 7 local: NOT today
    ev(KHI, '2026-10-07T19:00:00Z', 1, 1), // 00:00 Oct 8 local
    ev(KHI, '2026-10-08T04:00:00Z', 1, 2, { pathname: '/pricing' }),
    ev(KHI, '2026-10-08T04:01:00Z', 1, 4, { pathname: '/docs' }), // seq 3 was lost
    ev(KHI, '2026-10-08T05:00:00Z', 1, 1, { pathname: '/pricing' }), // a new page load
    ev(KHI, '2026-10-08T05:01:00Z', 1, 2, { name: 'signup', props: { plan: 'pro' } }),
    ev(KHI, '2026-10-08T09:58:00Z', 2, 1, { device: 'mobile', browser: 'Safari', country_code: 'US' }),
    ev(KHI, '2026-10-08T09:59:00Z', 3, 1, { pathname: '/pricing', device: 'mobile', browser: 'Safari', country_code: 'US' }),
    ...Array.from({ length: 101 }, (_, i) => ev(KHI, '2026-10-08T06:00:00Z', 4, i + 1, { name: 'purchase', props: { order_id: `o${i}` } })),
  ]);
  await insert('sessions', [
    session(KHI, '2026-10-07T19:00:00Z', 1, { referrer_source: 'google.com' }),
    // the same session updated: old state cancelled (sign -1), new state engaged (sign +1)
    session(KHI, '2026-10-07T19:00:00Z', 1, { referrer_source: 'google.com', sign: -1, version: 1 }),
    session(KHI, '2026-10-07T19:00:00Z', 1, { referrer_source: 'google.com', pageviews: 4, is_engaged: 1, version: 2 }),
    session(KHI, '2026-10-08T09:58:00Z', 2, { referrer_source: '' }),
    session(KHI, '2026-10-08T09:59:00Z', 3, { referrer_source: 't.co' }),
    session(KHI, '2026-10-08T06:00:00Z', 4, { referrer_source: 'news.ycombinator.com', is_engaged: 1 }),
  ]);
  await insert('dropped_hits', [
    { site_id: KHI, at: ts('2026-10-08T08:00:00Z'), reason: 'hostname', detail: 'staging.shop.test', hits: 3 },
    { site_id: KHI, at: ts('2026-10-08T08:30:00Z'), reason: 'bot', detail: 'ua_denylist', hits: 5 },
  ]);

  // ---- Two tabs of one visitor (same visitor hash), hits interleaved: tab A 1,2,3 and tab B 1,2. Nothing lost.
  await insert('events', [
    ev(TABS, '2026-10-08T07:00:00Z', 7, 1),
    ev(TABS, '2026-10-08T07:00:01Z', 7, 1, { pathname: '/b' }),
    ev(TABS, '2026-10-08T07:00:02Z', 7, 2),
    ev(TABS, '2026-10-08T07:00:03Z', 7, 2, { pathname: '/b' }),
    ev(TABS, '2026-10-08T07:00:04Z', 7, 3),
  ]);

  // ---- London site around the end of BST: 25 Oct 2026 02:00 BST -> 01:00 GMT (01:00Z)
  await insert('events', [
    ev(LON, '2026-10-24T22:59:00Z', 1, 1), // 23:59 BST Oct 24
    ev(LON, '2026-10-24T23:30:00Z', 2, 1), // 00:30 BST Oct 25
    ev(LON, '2026-10-25T00:30:00Z', 3, 1), // 01:30 BST Oct 25 (first 01:xx)
    ev(LON, '2026-10-25T01:30:00Z', 4, 1), // 01:30 GMT Oct 25 (second 01:xx)
    ev(LON, '2026-10-25T23:30:00Z', 5, 1), // 23:30 GMT Oct 25
    ev(LON, '2026-10-26T00:00:00Z', 6, 1), // 00:00 GMT Oct 26
  ]);
}, 60_000);

afterAll(async () => {
  if (!URL_) return;
  if (process.env.TW_KEEP_TEST_DB === '1') console.log(`kept ${DB}`);
  else await sql(`DROP DATABASE IF EXISTS ${DB}`);
});

describe.skipIf(!URL_)('Query API on a real ClickHouse', () => {
  it('today in Asia/Karachi: KPIs from the local calendar day only', async () => {
    const o = await stats.overview(KHI, resolveRange('today', 'Asia/Karachi', NOW));
    expect(o.range).toMatchObject({ from: '2026-10-08', to: '2026-10-08', hourly: true });
    expect(o.kpis).toMatchObject({ visitors: 4, pageviews: 6, sessions: 4, visitorsEstimated: false });
    expect(o.kpis.bounceRate).toBeCloseTo(0.5); // 2 of 4 sessions engaged (the collapsed update counts once)
    expect(o.kpis.previous).toMatchObject({ visitors: 1, pageviews: 1, sessions: 0, bounceRate: null });
  });

  it('series: 24 local hours, empty ones included, sums equal the KPIs', async () => {
    const o = await stats.overview(KHI, resolveRange('today', 'Asia/Karachi', NOW));
    expect(o.series).toHaveLength(24);
    expect(o.series[0]!.label).toBe('00:00');
    expect(o.series.reduce((s, r) => s + r.pageviews, 0)).toBe(o.kpis.pageviews);
    expect(o.series.reduce((s, r) => s + r.sessions, 0)).toBe(o.kpis.sessions);
    expect(o.series.find((r) => r.label === '09:00')!.pageviews).toBe(2); // 04:00Z + 04:01Z
  });

  it('top pages come from the 15-minute rollup and equal the raw counts', async () => {
    const o = await stats.overview(KHI, resolveRange('today', 'Asia/Karachi', NOW));
    expect(o.pages).toEqual([
      { label: '/pricing', value: 3 },
      { label: '/', value: 2 },
      { label: '/docs', value: 1 },
    ]);
  });

  it('sources, referrers and breakdowns', async () => {
    const o = await stats.overview(KHI, resolveRange('today', 'Asia/Karachi', NOW));
    expect(o.sources).toEqual([
      { name: 'Direct', sessions: 1 },
      { name: 'Search', sessions: 1 },
      { name: 'Social', sessions: 1 },
      { name: 'Referral', sessions: 1 },
    ]);
    expect(o.referrers.map((r) => r.label).sort()).toEqual(['google.com', 'news.ycombinator.com', 't.co']);
    expect(o.countries).toEqual([{ label: 'US', value: 2 }, { label: 'PK', value: 1 }]);
    expect(o.devices).toEqual([{ label: 'mobile', value: 2 }, { label: 'desktop', value: 1 }]);
    expect(o.browsers).toEqual([{ label: 'Safari', value: 2 }, { label: 'Chrome', value: 1 }]);
  });

  it('capture rate: one lost beacon in visitor 1 (seq 1,2,4 then a new load 1,2)', async () => {
    const o = await stats.overview(KHI, resolveRange('today', 'Asia/Karachi', NOW));
    // loads: v1 [1,2,4] -> 3/4, v1 [1,2] -> 2/2, v2 [1], v3 [1], v4 [1..101] -> 101/101
    expect(o.capture).toEqual({ received: 108, expected: 109, rate: 108 / 109 });
  });

  it('capture rate: two interleaved tabs of one visitor lose nothing, so 100% (not 5 of 6)', async () => {
    const o = await stats.overview(TABS, resolveRange('today', 'Asia/Karachi', NOW));
    expect(o.capture).toEqual({ received: 5, expected: 5, rate: 1 });
  });

  it('drops by reason feed the warnings', async () => {
    const o = await stats.overview(KHI, resolveRange('today', 'Asia/Karachi', NOW));
    expect(o.drops.map((d) => [d.reason, d.hits, d.detail])).toEqual([['bot', 5, 'ua_denylist'], ['hostname', 3, 'staging.shop.test']]);
    const list = await stats.drops(KHI, resolveRange('today', 'Asia/Karachi', NOW));
    expect(list.rows.map((r) => r.reason)).toEqual(['bot', 'hostname']); // newest first
  });

  it('DST (done-when): Europe/London days are local days across the end of BST', async () => {
    const o = await stats.overview(LON, resolveRange('7d', 'Europe/London', new Date('2026-10-26T12:00:00Z')));
    const day = (d: string) => o.series.find((r) => r.bucket === d)!.pageviews;
    expect(day('2026-10-24')).toBe(1); // 23:59 BST
    expect(day('2026-10-25')).toBe(4); // 00:30 BST, 01:30 BST, 01:30 GMT, 23:30 GMT: a 25-hour day
    expect(day('2026-10-26')).toBe(1);
    expect(o.kpis.visitorsEstimated).toBe(true);
  });

  it('DST: "today" on 25 Oct 2026 in London has 25 hours, 01:00 twice', async () => {
    const o = await stats.overview(LON, resolveRange('today', 'Europe/London', new Date('2026-10-25T20:00:00Z')));
    expect(o.series).toHaveLength(25);
    expect(o.series.filter((r) => r.label === '01:00').map((r) => r.pageviews)).toEqual([1, 1]);
    expect(o.kpis.pageviews).toBe(4);
  });

  it('live: active visitors in the last 5 minutes, 30 one-minute points, newest events first', async () => {
    const live = await stats.live(KHI, NOW);
    expect(live.active).toBe(2); // visitors 2 and 3 at 09:58Z and 09:59Z
    expect(live.minutes).toHaveLength(30);
    expect(live.minutes.reduce((s, m) => s + m.visitors, 0)).toBe(2);
    expect(live.events[0]).toMatchObject({ name: 'pageview', path: '/pricing', country: 'US' });
  });

  it('events report: kinds, counts, new custom events, high-cardinality properties', async () => {
    const r = await stats.events(KHI, resolveRange('today', 'Asia/Karachi', NOW), NOW);
    expect(r.events.map((e) => [e.name, e.kind, e.events, e.isNew])).toEqual([
      ['purchase', 'custom', 101, true],
      ['pageview', 'automatic', 6, false],
      ['signup', 'custom', 1, true],
    ]);
    expect(r.highCardinality).toEqual([{ name: 'purchase', key: 'order_id', distinctValues: 101 }]);
  });
});
