import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  BROWSER_UA,
  FIXTURE_SITE,
  contractFixtures,
  fixtureBody,
  fixtureHeaders,
} from '../../../../packages/contract/fixtures/payloads';

/**
 * Stage 2 done-when, on the real Workers runtime (workerd via Miniflare), with the BUILT bundle
 * (`wrangler deploy --dry-run` output), a real KV namespace, a real local Queue and the rate-limit
 * bindings from wrangler.toml:
 *
 *   - every fixture returns its specified code
 *   - malformed input never 500s
 *   - messages land in the queue
 *   - p99 latency (here measured end-to-end through Miniflare, which only ADDS overhead;
 *     the staging number is still taken after deploy)
 *
 * Run: pnpm --filter @tailwatch/collector e2e
 */

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

async function queued(minimum: number, timeoutMs = 15_000): Promise<any[]> {
  const sink = await mf.getKVNamespace('SINK', 'sink');
  const started = Date.now();
  for (;;) {
    const { keys } = await sink.list();
    if (keys.length >= minimum || Date.now() - started > timeoutMs) {
      return Promise.all(keys.map(async (k) => JSON.parse((await sink.get(k.name))!)));
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function clearSink(): Promise<void> {
  const sink = await mf.getKVNamespace('SINK', 'sink');
  for (const k of (await sink.list()).keys) await sink.delete(k.name);
}

const post = (body: string, headers: Record<string, string>, cf: Record<string, unknown> = {}) =>
  mf.dispatchFetch('https://in.tailwatch.com/e', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'cf-connecting-ip': '198.51.100.20', ...headers },
    body,
    cf,
  });

beforeAll(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
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
      {
        // Baseline: a Worker that does nothing. Its latency is pure Miniflare/loopback overhead.
        name: 'noop',
        modules: [{ type: 'ESModule', path: 'noop.mjs', contents: 'export default { async fetch(r) { await r.text(); return new Response(null, { status: 204 }); } };' }],
        compatibilityDate: '2026-09-01',
      },
    ],
  }));
  const kv = await mf.getKVNamespace('SITE_CONFIG', 'collector');
  await kv.put(`site:${FIXTURE_SITE.publicKey}`, JSON.stringify(FIXTURE_SITE));
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

describe('collector on workerd (built bundle)', () => {
  it('/health answers', async () => {
    const res = await mf.dispatchFetch('https://in.tailwatch.com/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('every fixture returns its specified code', async () => {
    const mismatches: string[] = [];
    for (const f of contractFixtures) {
      const headers = fixtureHeaders(f);
      // Node's fetch adds "user-agent: undici" when none is given. An empty value is what the edge
      // sees as "missing" (a falsy header), so that is how the missing-UA fixture is sent here.
      if (!('user-agent' in headers)) headers['user-agent'] = '';
      const res = await post(fixtureBody(f), headers, f.asn === undefined ? {} : { asn: f.asn });
      const text = await res.text();
      const want = f.expect;
      const ok =
        want.kind === 'accept' ? res.status === 204 && res.headers.get('x-tw-dropped') === null
        : want.kind === 'drop' ? res.status === 204 && res.headers.get('x-tw-dropped') === want.reason
        : res.status === want.status && text === want.error;
      if (!ok) mismatches.push(`${f.name}: want ${JSON.stringify(want)} got ${res.status} ${text} ${res.headers.get('x-tw-dropped')}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('messages land in the queue: one event per accept, one drop per attributable drop, no IP', async () => {
    const all = await queued(30);
    const events = all.filter((m) => m.type === 'event');
    const drops = all.filter((m) => m.type === 'drop');
    const accepts = contractFixtures.filter((f) => f.expect.kind === 'accept').length;
    const attributable = contractFixtures.filter((f) => f.expect.kind === 'drop' && f.expect.reason !== 'not_found').length;
    expect(events).toHaveLength(accepts);
    expect(drops).toHaveLength(attributable);
    for (const e of events) {
      expect(e.v).toBe(1);
      expect(e.visitor.hash).toMatch(/^\d+$/);
      expect(e.event.siteId).toBe(FIXTURE_SITE.id);
    }
    expect(JSON.stringify(all)).not.toContain('198.51.100.20');
  });

  it('malformed input never 500s', async () => {
    const nasty = ['', '{{{', '[]', '42', 'null', '\u0000\u0001', `{"s":${'['.repeat(5000)}`, 'x'.repeat(40 * 1024)];
    for (const b of nasty) {
      const res = await post(b, { 'user-agent': BROWSER_UA });
      expect(res.status, JSON.stringify(b.slice(0, 20))).toBeLessThan(500);
    }
    const wrongMethod = await mf.dispatchFetch('https://in.tailwatch.com/e', { method: 'PUT', body: 'x' });
    expect(wrongMethod.status).toBe(404);
  });

  it('latency: logged for comparison; fails only on a pathological regression (> 100 ms added)', async () => {
    await clearSink();
    const noop = await mf.getWorker('noop');
    const payload = (q: number) =>
      JSON.stringify({ s: FIXTURE_SITE.publicKey, n: 'pageview', u: 'https://example.com/p', q, t: Date.now(), v: 1 });
    const headers = { 'content-type': 'text/plain', 'cf-connecting-ip': '198.51.100.20', 'user-agent': BROWSER_UA };
    const viaCollector = () => post(payload(1), { 'user-agent': BROWSER_UA });
    const viaNoop = () => noop.fetch('https://in.tailwatch.com/e', { method: 'POST', headers, body: payload(1) });

    // Warm-up: the first requests include isolate start-up and JIT, which a deployed Worker amortises.
    for (let i = 0; i < 100; i += 1) {
      await (await viaCollector()).text();
      await (await viaNoop()).text();
    }
    const collector: number[] = [];
    const baseline: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      // Interleaved, so both series see the same machine noise.
      let t0 = performance.now();
      const res = await viaCollector();
      collector.push(performance.now() - t0);
      expect(res.status).toBe(204);
      t0 = performance.now();
      await (await viaNoop()).text();
      baseline.push(performance.now() - t0);
    }
    const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * q)]!;
    // The collector's own work = median difference to the noop Worker (medians are robust to the
    // scheduling spikes of a shared test machine; p99s are logged, not gated). The real "p99 < 20 ms"
    // done-when, and the Free plan's 10 ms CPU, are taken on the deployed Worker (PROJECT-NOTES).
    // The local gate is only a ceiling for a pathological regression: on the owner's Windows laptop,
    // right after a reboot, even the no-op Worker had a 11.8 ms median and the collector added 21 ms;
    // on Linux it adds ~3 ms.
    const added = pct(collector, 0.5) - pct(baseline, 0.5);
    console.log(
      `workerd via Miniflare: collector p50 ${pct(collector, 0.5).toFixed(2)} / p99 ${pct(collector, 0.99).toFixed(2)} ms; ` +
        `noop p50 ${pct(baseline, 0.5).toFixed(2)} / p99 ${pct(baseline, 0.99).toFixed(2)} ms; collector adds ${added.toFixed(2)} ms at the median`,
    );
    expect(added).toBeLessThan(100);
    expect((await queued(500)).length).toBeGreaterThanOrEqual(500);
  }, 120_000);
});
