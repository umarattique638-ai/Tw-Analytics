import { describe, expect, it } from 'vitest';
import { createApp, SESSION_COOKIE } from '../src/app';
import { defaultConfig } from '../src/config';
import { MemoryKv } from '../src/kv';
import { resolveRange } from '../src/stats';
import type { Overview, StatsReader } from '../src/stats';
import { MemoryStore } from '../src/store/memory';

/** The Query API's HTTP layer: auth, tenant isolation, ranges in the SITE's timezone, CSV, allow-host. */
const NOW = new Date('2026-10-08T10:00:00Z');

function fakeStats(calls: string[]): StatsReader {
  const overview = async (site: number, range: ReturnType<typeof resolveRange>): Promise<Overview> => {
    calls.push(`overview ${site} ${range.key} ${range.tz} ${range.from}..${range.to}`);
    return {
      range,
      kpis: { visitors: 4, visitorsEstimated: false, sessions: 4, pageviews: 6, bounceRate: 0.5, previous: { visitors: 1, sessions: 0, pageviews: 1, bounceRate: null } },
      series: [
        { bucket: '2026-10-07', label: 'Oct 7', visitors: 1, sessions: 0, pageviews: 1 },
        { bucket: '2026-10-08', label: 'Oct 8', visitors: 4, sessions: 4, pageviews: 6 },
      ],
      sources: [], referrers: [], pages: [], countries: [], devices: [], browsers: [],
      capture: { received: 9, expected: 10, rate: 0.9 }, drops: [],
    };
  };
  return {
    overview,
    live: async () => ({ now: NOW.getTime(), active: 2, minutes: [], events: [] }),
    events: async (_s: number, range: ReturnType<typeof resolveRange>) => ({ range, events: [], highCardinality: [] }),
    drops: async (_s: number, range: ReturnType<typeof resolveRange>) => ({ range, rows: [] }),
  } as unknown as StatsReader;
}

async function setup(withStats = true) {
  const calls: string[] = [];
  const store = new MemoryStore();
  const kv = new MemoryKv();
  const app = createApp({
    store, kv,
    analytics: { recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }) },
    stats: withStats ? fakeStats(calls) : null,
    config: defaultConfig({ collectorUrl: 'https://c.test', secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 } }),
    now: () => NOW,
  });
  const client = () => {
    let cookie = '';
    return async (method: string, path: string, json?: unknown) => {
      const res = await app.request(`http://app.test/api/v1${path}`, {
        method,
        headers: { host: 'app.test', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: json === undefined ? undefined : JSON.stringify(json),
      });
      const set = res.headers.get('set-cookie');
      if (set?.startsWith(`${SESSION_COOKIE}=`)) cookie = set.split(';')[0]!;
      return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
    };
  };
  const a = client();
  await a('POST', '/auth/signup', { name: 'A', email: 'a@x.co', password: 'correct horse' });
  const site = JSON.parse((await a('POST', '/sites', { domain: 'shop.example.com', timezone: 'Asia/Karachi' })).text).site;
  return { a, b: client(), site, calls, kv };
}

describe('Query API (Stage 6) over HTTP', () => {
  it('ranges are local days in the site timezone; bad ranges are refused', async () => {
    const { a, site, calls } = await setup();
    expect((await a('GET', `/sites/${site.id}/stats/overview?range=7d`)).status).toBe(200);
    expect(calls).toEqual([`overview ${site.id} 7d Asia/Karachi 2026-10-02..2026-10-08`]);
    expect((await a('GET', `/sites/${site.id}/stats/overview?range=forever`)).status).toBe(400);
  });

  it('another tenant cannot read the stats', async () => {
    const { b, site } = await setup();
    await b('POST', '/auth/signup', { name: 'B', email: 'b@x.co', password: 'correct horse' });
    for (const p of ['overview', 'live', 'events', 'drops']) expect((await b('GET', `/sites/${site.id}/stats/${p}`)).status).toBe(404);
  });

  it('without ClickHouse configured, a clear 503 (never made-up numbers)', async () => {
    const { a, site } = await setup(false);
    const r = await a('GET', `/sites/${site.id}/stats/overview`);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.text).error).toBe('analytics_unavailable');
  });

  it('CSV export = the chart series, one row per local day', async () => {
    const { a, site } = await setup();
    const r = await a('GET', `/sites/${site.id}/export.csv?range=7d`);
    expect(r.type).toContain('text/csv');
    expect(r.text).toBe('date,visitors,sessions,pageviews\n2026-10-07,1,0,1\n2026-10-08,4,4,6\n');
  });

  it('"Allow" a dropped host: it joins the accepted hosts and the collector KV entry', async () => {
    const { a, site, kv } = await setup();
    const r = JSON.parse((await a('POST', `/sites/${site.id}/allowed-hosts`, { host: 'Staging.Shop.Test' })).text);
    expect(r.site.allowedHosts).toEqual(['shop.example.com', '*.shop.example.com', 'staging.shop.test']);
    expect(JSON.parse(kv.entries.get(`site:${site.publicKey}`)!).allowedHosts).toContain('staging.shop.test');
    expect((await a('POST', `/sites/${site.id}/allowed-hosts`, { host: 'not a host' })).status).toBe(400);
  });
});
