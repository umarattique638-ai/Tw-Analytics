import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLAG_FIRST_PAGEVIEW, FLAG_HASH_ROUTE, LIMITS, WIRE_FIELDS, validate } from '@tailwatch/contract';
import { BROWSER_UA, FIXTURE_SITE, SITE } from '../../contract/fixtures/payloads';
import {
  DEBOUNCE_MS,
  ENGAGEMENT_FLUSH_MIN_MS,
  MAX_BODY_BYTES,
  MAX_BUFFER,
  RETRY_MS,
  TRACKER_VERSION,
  createTracker,
} from '../src/index';
import type { Config, Env, Tracker } from '../src/index';

/** A fake page. The clock is vitest's fake clock, so timers and now() move together. */
function page(start = 'https://example.com/') {
  const state = { href: start, referrer: '', visible: true, focused: true, online: true };
  const sent: { body: Record<string, any>; raw: string; hide: boolean }[] = [];
  const warnings: string[] = [];
  let reply: () => Promise<boolean> = () => Promise.resolve(true);
  let n = 0;
  const env: Env = {
    now: () => Date.now(),
    href: () => state.href,
    referrer: () => state.referrer,
    width: () => 1280,
    active: () => state.visible && state.focused,
    online: () => state.online,
    id: () => `id-${++n}`,
    send: (raw, hide) => {
      sent.push({ body: JSON.parse(raw), raw, hide });
      return reply();
    },
    warn: (m) => warnings.push(m),
  };
  return {
    state,
    sent,
    warnings,
    env,
    names: () => sent.map((s) => s.body.n),
    replyWith(fn: () => Promise<boolean>) {
      reply = fn;
    },
    start(config: Partial<Config> = {}): Tracker {
      return createTracker({ key: SITE, ...config }, env);
    },
  };
}

/** Lets resolved send() promises run their .then. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 8, 12, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe('wire payload', () => {
  it('every hit is a valid contract v1 payload, accepted by the real validator', async () => {
    const p = page('https://example.com/blog/post/?utm_source=news&email=a@b.com#top');
    p.state.referrer = 'https://google.com/search?q=secret#x';
    const t = p.start();
    t.page({ rt: '/blog/[slug]' });
    vi.advanceTimersByTime(12_000);
    t.track('signup', { plan: 'pro', seats: 3, annual: true });
    vi.advanceTimersByTime(3_000);
    t.hide();
    await settle();

    expect(p.names()).toEqual(['pageview', 'signup', 'engagement']);
    for (const { raw, body } of p.sent) {
      for (const key of Object.keys(body)) expect(WIRE_FIELDS).toContain(key);
      const outcome = validate(new Headers({ 'user-agent': BROWSER_UA }), raw, { receivedAt: Date.now(), site: FIXTURE_SITE });
      expect(outcome.kind, raw).toBe('accept');
    }
    const [pv, signup] = p.sent.map((s) => s.body);
    // Normalised on the client: non-allowlisted query (PII) and the fragment never leave the browser.
    expect(pv).toMatchObject({
      s: SITE, n: 'pageview', u: 'https://example.com/blog/post?utm_source=news', q: 1, v: TRACKER_VERSION,
      f: FLAG_FIRST_PAGEVIEW, r: 'https://google.com/search', rt: '/blog/[slug]', w: 1280,
    });
    expect(pv!.i).toBeTruthy();
    expect(pv!.x).toBe(pv!.t);
    expect(pv!.e).toBeUndefined();
    expect(signup).toMatchObject({ n: 'signup', q: 2, e: 12_000, p: { plan: 'pro', seats: 3, annual: true } });
    expect(signup!.f).toBeUndefined();
    expect(signup!.r).toBeUndefined();
  });

  it('MAX_BODY_BYTES is the collector cap', () => {
    expect(MAX_BODY_BYTES).toBe(LIMITS.maxBodyBytes);
  });

  it('a hit over 32 KB is dropped with a console warning, never sent', () => {
    const p = page();
    const t = p.start();
    t.page();
    t.track('huge', { blob: 'é'.repeat(17_000) }); // 17k chars, 34 KB of UTF-8
    expect(p.names()).toEqual(['pageview']);
    expect(p.warnings[0]).toContain('over 32 KB');
  });
});

describe('pageviews: exactly one per navigation (invariants 10, 11)', () => {
  it('exactly one first pageview, sent immediately', () => {
    const p = page();
    const t = p.start();
    t.page();
    expect(p.sent).toHaveLength(1);
    t.page(); // StrictMode double effect
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(p.sent).toHaveLength(1);
    expect(p.sent.filter((s) => (s.body.f ?? 0) & FLAG_FIRST_PAGEVIEW)).toHaveLength(1);
  });

  it('route change: one pageview after the debounce, last URL wins', () => {
    const p = page();
    const t = p.start();
    t.page();
    p.state.href = 'https://example.com/a';
    t.page();
    p.state.href = 'https://example.com/b';
    t.page();
    t.page();
    expect(p.sent).toHaveLength(1);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(p.sent.map((s) => s.body.u)).toEqual(['https://example.com/', 'https://example.com/b']);
    expect(p.sent[1]!.body.q).toBe(2);
    expect(p.sent[1]!.body.f).toBeUndefined();
  });

  it('replaceState noise, trailing slash, fragment and non-allowlisted query send nothing', () => {
    const p = page('https://example.com/shop');
    const t = p.start();
    t.page();
    for (const href of ['https://example.com/shop/', 'https://example.com/shop?sort=price', 'https://example.com/shop#reviews', 'https://EXAMPLE.com/shop']) {
      p.state.href = href;
      t.page();
      vi.advanceTimersByTime(DEBOUNCE_MS);
    }
    expect(p.sent).toHaveLength(1);
  });

  it('hash route changes count only with hashRouting', () => {
    const plain = page('https://example.com/#/home');
    const a = plain.start();
    a.page();
    plain.state.href = 'https://example.com/#/settings';
    a.page();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(plain.sent).toHaveLength(1);
    expect(plain.sent[0]!.body.u).toBe('https://example.com/');

    const hash = page('https://example.com/#/home');
    const b = hash.start({ hashRouting: true });
    b.page();
    hash.state.href = 'https://example.com/#/settings';
    b.page();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(hash.sent.map((s) => [s.body.u, s.body.f])).toEqual([
      ['https://example.com/#/home', FLAG_FIRST_PAGEVIEW | FLAG_HASH_ROUTE],
      ['https://example.com/#/settings', FLAG_HASH_ROUTE],
    ]);
  });

  it('bfcache restore (force) sends a pageview for the same URL, not marked first', () => {
    const p = page();
    const t = p.start();
    t.page();
    t.page({ force: true });
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(p.sent).toHaveLength(2);
    expect(p.sent[1]!.body.f).toBeUndefined();
  });

  it('an explicit url (adapters) is used instead of the location', () => {
    const p = page();
    const t = p.start();
    t.page({ url: 'https://example.com/from-router' });
    expect(p.sent[0]!.body.u).toBe('https://example.com/from-router');
  });

  it('non-http pages send nothing', () => {
    const p = page('file:///C:/site/index.html');
    p.start().page();
    expect(p.sent).toHaveLength(0);
  });

  it('a pending route change is flushed with the beacon when the page hides', () => {
    const p = page();
    const t = p.start();
    t.page();
    p.state.href = 'https://example.com/next';
    t.page();
    t.hide();
    expect(p.sent.map((s) => [s.body.u, s.hide])).toEqual([
      ['https://example.com/', false],
      ['https://example.com/next', true],
    ]);
  });
});

describe('engagement: visible AND focused time', () => {
  it('counts only visible+focused time and ships it with the next event', () => {
    const p = page();
    const t = p.start();
    t.page();
    vi.advanceTimersByTime(3_000); // active: 3 s
    p.state.focused = false;
    t.activity();
    vi.advanceTimersByTime(60_000); // visible but unfocused: not counted
    p.state.focused = true;
    t.activity();
    vi.advanceTimersByTime(2_000); // active: 2 s
    p.state.visible = false;
    t.activity();
    vi.advanceTimersByTime(60_000); // hidden: not counted
    p.state.visible = true;
    t.activity();
    t.track('click_cta');
    expect(p.sent[1]!.body.e).toBe(5_000);
  });

  it('hide ships unsent engagement as an `engagement` beacon, once', () => {
    const p = page();
    const t = p.start();
    t.page();
    vi.advanceTimersByTime(4_000);
    p.state.visible = false;
    t.hide(); // visibilitychange -> hidden
    t.hide(); // pagehide right after: nothing new
    expect(p.sent.map((s) => [s.body.n, s.body.e, s.hide])).toEqual([
      ['pageview', undefined, false],
      ['engagement', 4_000, true],
    ]);
  });

  it('less than a second of engagement is carried to the next event instead of its own hit', () => {
    const p = page();
    const t = p.start();
    t.page();
    vi.advanceTimersByTime(ENGAGEMENT_FLUSH_MIN_MS - 1);
    p.state.visible = false;
    t.hide();
    expect(p.sent).toHaveLength(1);
    p.state.visible = true;
    t.activity();
    t.track('later');
    expect(p.sent[1]!.body.e).toBe(ENGAGEMENT_FLUSH_MIN_MS - 1);
  });

  it('a page that starts hidden (background tab) accrues nothing until visible', () => {
    const p = page();
    p.state.visible = false;
    const t = p.start();
    t.page();
    vi.advanceTimersByTime(30_000);
    t.track('x');
    expect(p.sent[1]!.body.e).toBeUndefined();
  });
});

describe('consent gate (PLAN 10.5)', () => {
  it('unknown buffers and sends nothing; granted flushes in order with fresh sequence numbers', () => {
    const p = page();
    const t = p.start({ consent: 'unknown' });
    t.page();
    t.track('a');
    vi.advanceTimersByTime(60_000);
    expect(p.sent).toHaveLength(0);
    t.consent('granted');
    expect(p.sent.map((s) => [s.body.n, s.body.q])).toEqual([['pageview', 1], ['a', 2]]);
    expect(p.sent[0]!.body.f).toBe(FLAG_FIRST_PAGEVIEW);
  });

  it('denied discards the buffer and everything after', () => {
    const p = page();
    const t = p.start({ consent: 'unknown' });
    t.page();
    t.consent('denied');
    t.track('b');
    t.hide();
    vi.advanceTimersByTime(RETRY_MS * 2);
    expect(p.sent).toHaveLength(0);
  });

  it('the buffer is bounded', () => {
    const p = page();
    const t = p.start({ consent: 'unknown' });
    for (let i = 0; i < MAX_BUFFER + 20; i++) t.track(`e${i}`);
    t.consent('granted');
    expect(p.sent).toHaveLength(MAX_BUFFER);
    expect(p.sent[0]!.body.n).toBe('e20');
  });
});

describe('delivery: offline, 429, network errors', () => {
  it('offline: queued, flushed on `online` with the same q and insert id but a new sent time', async () => {
    const p = page();
    p.state.online = false;
    const t = p.start();
    t.page();
    expect(p.sent).toHaveLength(0);
    vi.advanceTimersByTime(5_000);
    p.state.online = true;
    t.flush();
    expect(p.sent).toHaveLength(1);
    const b = p.sent[0]!.body;
    expect(b.q).toBe(1);
    expect(b.x - b.t).toBe(5_000); // the collector's clock-skew correction uses this gap
  });

  it('a failed send is retried after RETRY_MS, keeping q and i (server de-dup)', async () => {
    const p = page();
    let calls = 0;
    p.replyWith(() => (++calls === 1 ? Promise.resolve(false) : Promise.resolve(true)));
    const t = p.start();
    t.page();
    await settle();
    expect(p.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(p.sent).toHaveLength(2);
    expect(p.sent[1]!.body.i).toBe(p.sent[0]!.body.i);
    expect(p.sent[1]!.body.q).toBe(1);
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(p.sent).toHaveLength(2);
  });

  it('a thrown transport error is retried too', async () => {
    const p = page();
    let calls = 0;
    p.replyWith(() => (++calls === 1 ? Promise.reject(new TypeError('network')) : Promise.resolve(true)));
    p.start().page();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(p.sent).toHaveLength(2);
  });

  it('hide flushes the retry queue with the beacon', async () => {
    const p = page();
    let calls = 0;
    p.replyWith(() => Promise.resolve(++calls > 1));
    const t = p.start();
    t.page();
    await settle();
    t.hide();
    expect(p.sent.map((s) => s.hide)).toEqual([false, true]);
  });

  it('a sequence gap appears only when a dispatched beacon is lost', () => {
    const p = page();
    const t = p.start();
    t.page();
    t.track('a');
    p.sent.pop(); // the network ate it, but transport reported success (e.g. a blocker)
    t.track('b');
    expect(p.sent.map((s) => s.body.q)).toEqual([1, 3]);
  });
});
