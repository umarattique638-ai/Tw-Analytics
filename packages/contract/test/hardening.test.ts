import { describe, expect, it } from 'vitest';
import { LIMITS, validate } from '../src';
import type { EdgeMeta, Outcome, SiteConfig } from '../src';
import { contractFixtures, fixtureBody, SITE } from '../fixtures/payloads';

/**
 * Regression tests for hazards found in review. Each one is a request a
 * stranger can send with `curl`, because the site key is public.
 */

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const RECEIVED_AT = Date.UTC(2026, 9, 6, 12, 0, 0);
const DAY = 86_400_000;

const SITE_CONFIG: SiteConfig = {
  id: 123,
  publicKey: SITE,
  allowedHosts: ['example.com'],
  live: true,
  region: 'in',
};

const headers = { get: (name: string) => (name.toLowerCase() === 'user-agent' ? CHROME : null) };
const edge = (site: SiteConfig | null = SITE_CONFIG): EdgeMeta => ({ receivedAt: RECEIVED_AT, site });

const base = { s: SITE, n: 'pageview', u: 'https://example.com/', q: 1, t: RECEIVED_AT, v: 1 };
const run = (payload: object | string, site: SiteConfig | null = SITE_CONFIG): Outcome =>
  validate(headers, typeof payload === 'string' ? payload : JSON.stringify(payload), edge(site));

function accepted(outcome: Outcome) {
  if (outcome.kind !== 'accept') throw new Error(`expected accept, got ${outcome.kind}`);
  return outcome.event;
}

/** What the consumer will eventually do with a time: must never throw. */
const isoSafe = (ms: number) => !Number.isNaN(new Date(ms).getTime()) && new Date(ms).toISOString().length === 24;

describe('past and absurd timestamps are repaired, never crash a downstream date conversion', () => {
  it('t = 1 (1970) is old but storable: kept as backfill, never rewritten (owner rule)', () => {
    const event = accepted(run({ ...base, t: 1 }));
    expect(event.occurredAt).toBe(1);
    expect(event.backfill).toBe(true);
    expect(event.warnings).toEqual([]);
    expect(isoSafe(event.occurredAt)).toBe(true);
  });

  it('426 days old stays untouched (the owner removed the age ceiling on purpose)', () => {
    const t = RECEIVED_AT - 426 * DAY;
    const event = accepted(run({ ...base, t }));
    expect(event.occurredAt).toBe(t);
    expect(event.warnings).not.toContain('timestamp_repaired_old');
  });

  it('x = 1e300 (occurredAt would be -1e300) is repaired', () => {
    const event = accepted(run({ ...base, t: 1, x: 1e300 }));
    expect(event.occurredAt).toBe(RECEIVED_AT);
    expect(event.warnings).toContain('timestamp_repaired_old');
    expect(isoSafe(event.occurredAt)).toBe(true);
  });

  it('x so large that occurredAt falls before year 0 is repaired', () => {
    const event = accepted(run({ ...base, t: 1, x: 8e15 }));
    expect(event.occurredAt).toBe(RECEIVED_AT);
  });

  it('t = 1e300 is repaired and createdAt is kept inside the storable range', () => {
    const event = accepted(run({ ...base, t: 1e300 }));
    expect(event.occurredAt).toBe(RECEIVED_AT);
    expect(isoSafe(event.createdAt)).toBe(true);
    expect(event.warnings).toContain('created_at_repaired');
  });

  // `t` must be > 0 (shape rule), so a pre-1970 time can only arrive through `x`:
  // occurredAt = receivedAt - (x - t)  =>  x = t + receivedAt - wanted
  const xFor = (wanted: number) => base.t + RECEIVED_AT - wanted;

  it('exactly 1900-01-01 (the oldest ClickHouse DateTime64 value) is kept', () => {
    const wanted = Date.UTC(1900, 0, 1);
    const event = accepted(run({ ...base, x: xFor(wanted) }));
    expect(event.occurredAt).toBe(wanted);
    expect(event.warnings).toEqual([]);
  });

  it('one millisecond before 1900 cannot be stored and is repaired with a warning', () => {
    const event = accepted(run({ ...base, x: xFor(Date.UTC(1900, 0, 1) - 1) }));
    expect(event.occurredAt).toBe(RECEIVED_AT);
    expect(event.warnings).toContain('timestamp_repaired_old');
  });

  it('a non-positive t is still a 400 (shape rule is unchanged)', () => {
    expect(run({ ...base, t: 0 })).toMatchObject({ kind: 'reject', status: 400, error: 'bad_timestamp' });
    expect(run({ ...base, t: -5 })).toMatchObject({ kind: 'reject', status: 400, error: 'bad_timestamp' });
  });

  it('4 days old is still accepted as backfill, untouched (PLAN 8.2 is preserved)', () => {
    const t = RECEIVED_AT - 4 * DAY;
    const event = accepted(run({ ...base, t }));
    expect(event.occurredAt).toBe(t);
    expect(event.backfill).toBe(true);
    expect(event.warnings).toEqual([]);
  });
});

describe('unknown fields cannot crash or poison the validator', () => {
  const withExtra = (extraJson: string) =>
    `{"s":"${SITE}","n":"pageview","u":"https://example.com/","q":1,"t":${RECEIVED_AT},"v":1,"deep":${extraJson}}`;

  it('deeply nested JSON inside a 32 KB body does not overflow the stack', () => {
    const depth = 15_000;
    const body = withExtra('['.repeat(depth) + ']'.repeat(depth));
    expect(body.length).toBeLessThan(LIMITS.maxBodyBytes);
    expect(() => run(body)).not.toThrow();
    expect(run(body).status).toBe(204);
  });

  it('nesting beyond the cap is replaced by null, shallow nesting is kept', () => {
    const event = accepted(run(withExtra('{"a":{"b":1}}')));
    expect(event.extra.deep).toEqual({ a: { b: 1 } });
    const deep = accepted(run(withExtra('['.repeat(50) + ']'.repeat(50))));
    expect(JSON.stringify(deep.extra.deep)).toContain('null');
  });

  it('__proto__ in unknown fields is dropped, not applied as a prototype', () => {
    const event = accepted(
      run(`{"s":"${SITE}","n":"pageview","u":"https://example.com/","q":1,"t":${RECEIVED_AT},"v":1,"__proto__":{"admin":true},"zz":1,"n2":{"__proto__":{"x":1}}}`),
    );
    expect(Object.getPrototypeOf(event.extra)).toBe(Object.prototype);
    expect(Object.keys(event.extra).sort()).toEqual(['n2', 'zz']);
    expect(Object.getPrototypeOf(event.extra.n2)).toBe(Object.prototype);
  });
});

describe('referrer never carries a query string, fragment or credentials', () => {
  const ref = (r: string) => accepted(run({ ...base, r })).referrer;

  it('strips a reset token and email from a search/mail referrer', () => {
    expect(ref('https://mail.example.org/reset?token=SECRET123&email=a@b.com#x')).toBe('https://mail.example.org/reset');
  });
  it('strips credentials and keeps the path', () => {
    expect(ref('https://user:pw@news.example.org/a/b?x=1')).toBe('https://news.example.org/a/b');
  });
  it('keeps a plain referrer unchanged', () => {
    expect(ref('https://ref.example/path')).toBe('https://ref.example/path');
  });
  it('a non-http referrer (app) loses its query too', () => {
    expect(ref('android-app://com.google.android.gm/?secret=1')).toBe('android-app://com.google.android.gm/');
  });
  it('garbage that is not a URL loses everything after ? or #', () => {
    expect(ref('not a url?token=1#frag')).toBe('not a url');
  });
});

describe('no 400 depends on whether the site exists (invariant 8)', () => {
  it('every rejected payload is rejected identically for a known and an unknown site', () => {
    for (const fixture of contractFixtures) {
      const body = fixtureBody(fixture);
      const known = validate(headers, body, { receivedAt: RECEIVED_AT, site: SITE_CONFIG });
      const unknown = validate(headers, body, { receivedAt: RECEIVED_AT, site: null });
      if (known.kind === 'reject' || unknown.kind === 'reject') {
        expect(known, fixture.name).toEqual(unknown);
      }
    }
  });
});

describe('fuzz: whatever a stranger sends, validate answers and never throws', () => {
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const weirdNumbers = [0, 1, -1, 0.5, 1e15, 8.64e15, 8.64e15 + 1, 1e300, -1e300, Number.MAX_SAFE_INTEGER, RECEIVED_AT, RECEIVED_AT - 3 * DAY, RECEIVED_AT + 10 * DAY];

  it('2,000 random payloads: status is 204/400/413 and every accepted time is storable', () => {
    const r = rng(7);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(r() * items.length)]!;
    for (let i = 0; i < 2000; i++) {
      const payload: Record<string, unknown> = { s: SITE, n: 'pageview', u: 'https://example.com/', q: 1, t: RECEIVED_AT, v: 1 };
      if (r() < 0.7) payload.t = pick(weirdNumbers);
      if (r() < 0.5) payload.x = pick(weirdNumbers);
      if (r() < 0.2) payload.e = pick(weirdNumbers);
      if (r() < 0.2) payload.r = pick(['', 'x?y#z', 'https://a.b/c?d=e', 5, null]);
      if (r() < 0.2) payload.p = pick([{}, [], null, { a: 1e300 }, { 'a\nb': 1 }, { k: '4111111111111111' }]);

      const outcome = run(JSON.stringify(payload));
      expect([204, 400, 413], JSON.stringify(payload)).toContain(outcome.status);

      if (outcome.kind === 'accept') {
        const e = outcome.event;
        expect(isoSafe(e.occurredAt), `occurredAt for ${JSON.stringify(payload)}`).toBe(true);
        expect(isoSafe(e.createdAt), `createdAt for ${JSON.stringify(payload)}`).toBe(true);
        expect(e.occurredAt).toBeGreaterThanOrEqual(Date.UTC(1900, 0, 1));
        expect(e.occurredAt).toBeLessThanOrEqual(RECEIVED_AT + LIMITS.maxFutureSkewMs);
      }
    }
  });
});
