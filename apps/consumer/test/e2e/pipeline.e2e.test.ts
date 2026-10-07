import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  BROWSER_UA,
  FIXTURE_SITE,
  contractFixtures,
  fixtureBody,
  fixtureHeaders,
} from '../../../../packages/contract/fixtures/payloads';

/**
 * THE Stage 3 milestone (BUILD-ORDER Part 5): "a curl producing a correct ClickHouse row", with no
 * frontend code, end to end on the real Workers runtime:
 *
 *   HTTP -> collector Worker (built bundle) -> Queue -> consumer Worker (built bundle)
 *        -> R2 archive + SQLite Durable Object state -> ClickHouse (a real local server)
 *
 * Every Cloudflare piece is a free feature, simulated locally by Miniflare/workerd.
 * Needs a ClickHouse on TW_CH_URL (default http://127.0.0.1:8123) whose `default` user may create
 * databases and users. Run: pnpm --filter @tailwatch/consumer e2e
 */

const CH = (process.env.TW_CH_URL ?? 'http://127.0.0.1:8123').replace(/\/+$/, '');
const ADMIN = process.env.TW_CH_USER ?? 'default';
const ADMIN_PASSWORD = process.env.TW_CH_PASSWORD ?? '';
const db = `tw_e2e_${Date.now()}`;
const INSERT_USER = `tw_insert_${Date.now()}`;
const INSERT_PASSWORD = `local-e2e-${Math.random().toString(36).slice(2)}`;
const CLIENT_IP = '198.51.100.44';

async function sql(statement: string): Promise<string> {
  const res = await fetch(`${CH}/`, {
    method: 'POST',
    headers: { 'X-ClickHouse-User': ADMIN, 'X-ClickHouse-Key': ADMIN_PASSWORD },
    body: statement,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`clickhouse_${res.status}: ${text.slice(0, 300)}`);
  return text.trim();
}
const one = async (q: string) => Number(await sql(q));
const rows = async (q: string) =>
  (await sql(`${q} FORMAT JSONEachRow`)).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await read();
    if (ok(v) || Date.now() - started > timeoutMs) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}

vi.setConfig({ testTimeout: 60_000 });

let mf: Miniflare;

const post = (body: string, headers: Record<string, string>, cf: Record<string, unknown> = {}) =>
  mf.dispatchFetch('https://in.tailwatch.com/e', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'cf-connecting-ip': CLIENT_IP, ...headers },
    body,
    cf,
  });

beforeAll(async () => {
  // Schema + a least-privilege INSERT-only user, exactly as production should have it.
  const ddl = readFileSync(new URL('../../../../infra/clickhouse/001_contract.sql', import.meta.url), 'utf8');
  for (const statement of ddl.replace(/^--.*$/gm, '').replaceAll('tailwatch', db).split(';').map((s) => s.trim()).filter(Boolean)) {
    await sql(statement);
  }
  // The exact grants of infra/clickhouse/002_insert_user.sql, with a throwaway user and password.
  const grants = readFileSync(new URL('../../../../infra/clickhouse/002_insert_user.sql', import.meta.url), 'utf8')
    .replace(/^--.*$/gm, '')
    .replaceAll('tailwatch', db)
    .replaceAll('tw_insert', INSERT_USER)
    .replace('REPLACE_WITH_A_LONG_RANDOM_PASSWORD', INSERT_PASSWORD);
  for (const statement of grants.split(';').map((s) => s.trim()).filter(Boolean)) await sql(statement);

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
            CLICKHOUSE_USER: INSERT_USER,
            CLICKHOUSE_PASSWORD: INSERT_PASSWORD,
            CLICKHOUSE_DATABASE: db,
            SESSION_SHARDS: '8',
          },
        },
      ],
    }),
  );
  const kv = await mf.getKVNamespace('SITE_CONFIG', 'collector');
  await kv.put(`site:${FIXTURE_SITE.publicKey}`, JSON.stringify(FIXTURE_SITE));
}, 120_000);

afterAll(async () => {
  await mf?.dispose();
  await sql(`DROP DATABASE IF EXISTS ${db}`).catch(() => undefined);
  await sql(`DROP USER IF EXISTS ${INSERT_USER}`).catch(() => undefined);
});

describe('Stage 3 milestone on workerd: HTTP in, correct ClickHouse rows out', () => {
  it('one pageview: 204 at the edge, one correct row in ClickHouse, quickly', async () => {
    const started = Date.now();
    const res = await post(
      JSON.stringify({ s: FIXTURE_SITE.publicKey, n: 'pageview', u: 'https://Example.com/hello/?utm_source=e2e#x', q: 1, t: Date.now(), v: 1, i: 'milestone-1', w: 1280 }),
      { 'user-agent': BROWSER_UA },
      { country: 'PK', asn: 17557 },
    );
    expect(res.status).toBe(204);
    const found = await until(() => rows(`SELECT * FROM ${db}.events WHERE insert_id = 'milestone-1'`), (r) => r.length > 0);
    const seconds = (Date.now() - started) / 1000;
    console.log(`first row visible in ClickHouse after ${seconds.toFixed(2)} s (BUILD-ORDER target: 10 s)`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      site_id: '123',
      name: 'pageview',
      hostname: 'example.com',
      pathname: '/hello',
      utm_source: 'e2e',
      country_code: 'PK',
      browser: 'Chrome',
      os: 'Windows',
      screen_width: 1280,
      is_session_start: 1,
      tracker_version: 1,
    });
    expect(seconds).toBeLessThan(10);
  });

  it('a tracker retry of the same insert id gives still exactly one row (Durable Object de-dup)', async () => {
    const body = JSON.stringify({ s: FIXTURE_SITE.publicKey, n: 'pageview', u: 'https://example.com/hello', q: 1, t: Date.now(), v: 1, i: 'milestone-1' });
    expect((await post(body, { 'user-agent': BROWSER_UA })).status).toBe(204);
    // Send a marker after it, so we know the retry has been processed when the marker is there.
    await post(JSON.stringify({ s: FIXTURE_SITE.publicKey, n: 'pageview', u: 'https://example.com/after', q: 2, t: Date.now(), v: 1, i: 'marker-1' }), { 'user-agent': BROWSER_UA });
    await until(() => one(`SELECT count() FROM ${db}.events WHERE insert_id = 'marker-1'`), (n) => n > 0);
    expect(await one(`SELECT count() FROM ${db}.events WHERE insert_id = 'milestone-1'`)).toBe(1);
  });

  it('the whole fixture corpus: 22 events stored, 8 attributable drops itemised, sessions continue', async () => {
    const beforeEvents = await one(`SELECT count() FROM ${db}.events`);
    for (const f of contractFixtures) {
      const headers = fixtureHeaders(f);
      if (!('user-agent' in headers)) headers['user-agent'] = ''; // see the collector e2e test
      await post(fixtureBody(f), headers, f.asn === undefined ? {} : { asn: f.asn });
    }
    const events = await until(() => one(`SELECT count() FROM ${db}.events`), (n) => n >= beforeEvents + 22);
    expect(events).toBe(beforeEvents + 22);

    const drops = await until(
      () => rows(`SELECT reason, sum(hits) AS n FROM ${db}.dropped_hits GROUP BY reason ORDER BY reason`),
      (r) => r.reduce((s, x) => s + Number(x.n), 0) >= 8,
    );
    expect(Object.fromEntries(drops.map((d) => [d.reason, Number(d.n)]))).toEqual({
      bot: 4, // curl, missing UA, headless, datacentre ASN
      gpc: 1,
      hostname: 2,
      verification_agent: 1,
    });

    // One client (same IP + UA) -> one visitor hash for every browser-UA event, never the IP itself.
    const visitors = await rows(`SELECT DISTINCT toString(visitor_hash) AS h FROM ${db}.events`);
    expect(visitors).toHaveLength(1);
    expect(JSON.stringify(await rows(`SELECT * FROM ${db}.events`))).not.toContain(CLIENT_IP);
    // Sessions table is consistent: every event belongs to a session that exists.
    expect(await one(`SELECT sum(sign) FROM ${db}.sessions`)).toBeGreaterThanOrEqual(1);
    expect(await one(`SELECT sum(toInt64(pageviews) * sign) FROM ${db}.sessions`)).toBe(
      await one(`SELECT countIf(name = 'pageview') FROM ${db}.events`),
    );
  });

  it('R2 holds the raw files: every queued message archived, untransformed, with no IP', async () => {
    const bucket = await mf.getR2Bucket('ARCHIVE', 'consumer');
    const listed = await bucket.list({ prefix: 'raw/' });
    expect(listed.objects.length).toBeGreaterThan(0);
    let lines = 0;
    for (const object of listed.objects) {
      expect(object.key).toMatch(/^raw\/\d{4}-\d{2}-\d{2}\/\d{2}\/[0-9a-f]{64}\.ndjson$/);
      const text = await (await bucket.get(object.key))!.text();
      expect(text).not.toContain(CLIENT_IP);
      lines += text.trim().split('\n').length;
    }
    // 1 milestone + 1 retry + 1 marker + 22 accepted fixtures + 8 attributable drops
    expect(lines).toBe(33);
  });

  it('the rollup equals a raw GROUP BY after the whole pipeline', async () => {
    const a = await rows(`SELECT bucket, pathname, uniqMerge(visitors) AS v, countMerge(pageviews) AS p FROM ${db}.rollup_15m_pages GROUP BY bucket, pathname ORDER BY bucket, pathname`);
    const b = await rows(`SELECT toStartOfFifteenMinutes(timestamp) AS bucket, pathname, uniq(visitor_hash) AS v, count() AS p FROM ${db}.events WHERE name = 'pageview' GROUP BY bucket, pathname ORDER BY bucket, pathname`);
    expect(a).toEqual(b);
  });
});
