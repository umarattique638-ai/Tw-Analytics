import { describe, expect, it } from 'vitest';

import worker from '../src/index';

import { contractFixtures } from '../../../packages/contract/fixtures/payloads';

const PUBLIC_KEY = 'tw_pub_12345678901234567890123456789012';
const UNKNOWN_KEY = 'tw_pub_00000000000000000000000000000000';

const site = {
  id: 123,
  publicKey: PUBLIC_KEY,
  allowedHosts: ['example.com', 'www.example.com', '*.example.com'],
  live: true,
  region: 'in' as const,
  identitySecret: 'stage2-test-secret',
};

function env(overrides: Partial<Record<string, unknown>> = {}) {
  const sent: any[] = [];
  let limited = false;

  return {
    sent,
    env: {
      SITE_CONFIG: {
        async get(key: string) {
          return key === `site:${PUBLIC_KEY}` ? JSON.stringify(site) : null;
        },
      },
      EVENTS: {
        async send(message: unknown) {
          sent.push(message);
        },
      },
      RATE_LIMITER: {
        async limit() {
          return { success: !limited };
        },
      },
      ...overrides,
    },
    setLimited(value: boolean) {
      limited = value;
    },
  };
}

function context() {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    waitUntil(promise: Promise<unknown>) {
      promises.push(promise);
    },
  };
}

function validBody(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    s: PUBLIC_KEY,
    n: 'pageview',
    u: 'https://example.com/',
    q: 1,
    t: Date.now(),
    v: 1,
    ...extra,
  });
}

/** Drop messages are allowed in the queue; only real events must be absent. */
const events = (sent: any[]) => sent.filter((m) => m.type === 'event');

function post(
  body: string,
  headers: Record<string, string> = {},
  method = 'POST',
) {
  return new Request('https://in.tailwatch.com/e', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
}

const BROWSER = {
  'cf-connecting-ip': '203.0.113.7',
  'user-agent': 'Mozilla/5.0',
};

describe('Stage 2 collector', () => {
  it('keeps /health working', async () => {
    const h = env();
    const res = await worker.fetch(
      new Request('https://in.tailwatch.com/health'),
      h.env,
      context(),
    );

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
    expect(res.headers.get('x-tw-contract')).toBeTruthy();
  });

  it('accepts a valid POST and enqueues the event', async () => {
    const h = env();
    const ctx = context();

    const res = await worker.fetch(post(validBody(), BROWSER), h.env, ctx);
    expect(res.status).toBe(204);

    await Promise.all(ctx.promises);
    expect(h.sent).toHaveLength(1);

    const message = h.sent[0];
    expect(message.v).toBe(1);
    expect(message.type).toBe('event');
    expect(message.visitor.hash).toEqual(expect.any(String));
    expect(message.visitor.prevHash).toEqual(expect.any(String));
  });

  it('rejects malformed JSON', async () => {
    const h = env();
    const res = await worker.fetch(post('{bad json'), h.env, context());

    expect(res.status).toBe(400);
    expect(events(h.sent)).toHaveLength(0);
  });

  it('rejects an oversized request', async () => {
    const h = env();
    const body = 'x'.repeat(33 * 1024);

    const res = await worker.fetch(
      post(body, { 'content-length': String(body.length) }),
      h.env,
      context(),
    );

    expect(res.status).toBe(413);
    expect(events(h.sent)).toHaveLength(0);
  });

  it('drops an unknown site', async () => {
    const h = env();
    const res = await worker.fetch(
      post(validBody({ s: UNKNOWN_KEY }), { 'cf-connecting-ip': '203.0.113.7' }),
      h.env,
      context(),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('x-tw-dropped')).toBe('not_found');
    expect(events(h.sent)).toHaveLength(0);
  });

  it('drops a hostname mismatch', async () => {
    const h = env();
    const res = await worker.fetch(
      post(validBody({ u: 'https://evil.example/' }), {
        'cf-connecting-ip': '203.0.113.7',
      }),
      h.env,
      context(),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('x-tw-dropped')).toBe('hostname');
    expect(events(h.sent)).toHaveLength(0);
  });

  it('drops an obvious bot', async () => {
    const h = env();
    const res = await worker.fetch(
      post(validBody(), {
        'cf-connecting-ip': '203.0.113.7',
        'user-agent': 'Googlebot/2.1',
      }),
      h.env,
      context(),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('x-tw-dropped')).toBe('bot');
    expect(events(h.sent)).toHaveLength(0);
  });

  it('drops when GPC is enabled', async () => {
    const h = env();
    const res = await worker.fetch(
      post(validBody(), { ...BROWSER, 'Sec-GPC': '1' }),
      h.env,
      context(),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('x-tw-dropped')).toBe('gpc');
    expect(events(h.sent)).toHaveLength(0);
  });

  it('returns 429 when rate limited', async () => {
    const h = env();
    h.setLimited(true);

    const res = await worker.fetch(post(validBody()), h.env, context());

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('10');
    expect(events(h.sent)).toHaveLength(0);
  });

  it('answers OPTIONS', async () => {
    const h = env();
    const res = await worker.fetch(
      new Request('https://in.tailwatch.com/e', { method: 'OPTIONS' }),
      h.env,
      context(),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('fails closed when identitySecret is missing', async () => {
    const h = env({
      SITE_CONFIG: {
        async get() {
          return JSON.stringify({ ...site, identitySecret: undefined });
        },
      },
    });

    const res = await worker.fetch(post(validBody(), BROWSER), h.env, context());

    expect(res.status).toBe(204);
    expect(res.headers.get('x-tw-dropped')).toBe('identity_unavailable');
    expect(events(h.sent)).toHaveLength(0);
  });

  it('replays the Stage 1 fixture corpus', async () => {
    const h = env();

    for (const fixture of contractFixtures) {
      const res = await worker.fetch(
        post(JSON.stringify(fixture.payload), BROWSER),
        h.env,
        context(),
      );

      expect([200, 204, 400, 413, 429]).toContain(res.status);
    }
  });

  it('serves the tracking pixel and enqueues its event', async () => {
    const h = env();
    const ctx = context();

    const url = new URL('https://in.tailwatch.com/e.gif');
    url.searchParams.set('s', PUBLIC_KEY);
    url.searchParams.set('n', 'pageview');
    url.searchParams.set('u', 'https://example.com/');
    url.searchParams.set('q', '1');
    url.searchParams.set('t', String(Date.now()));
    url.searchParams.set('v', '1');

    const res = await worker.fetch(
      new Request(url, { method: 'GET', headers: BROWSER }),
      h.env,
      ctx,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect(res.headers.get('cache-control')).toBe('no-store');

    await Promise.all(ctx.promises);
    expect(h.sent).toHaveLength(1);
  });
});