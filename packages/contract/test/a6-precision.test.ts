import { describe, expect, it } from 'vitest';
import { FLAG_AUTOMATION, FLAG_FIRST_PAGEVIEW, FLAG_UA_MISMATCH, validate } from '../src';
import { BROWSER_HEADERS, FIXTURE_SITE, SITE } from '../fixtures/payloads';

/** STAGE-1 A6 (Stage 7): automation flag at the edge, client hints forwarded to the consumer. */
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const body = (f?: number) => JSON.stringify({ s: SITE, n: 'pageview', u: 'https://example.com/', q: 1, t: NOW, v: 3, ...(f !== undefined ? { f } : {}) });
const edge = { receivedAt: NOW, site: FIXTURE_SITE, https: true };

describe('STAGE-1 A6', () => {
  it('FLAG_AUTOMATION is dropped at the edge as bot:automation (unambiguous: the browser says so)', () => {
    expect(validate(new Headers(BROWSER_HEADERS), body(FLAG_FIRST_PAGEVIEW | FLAG_AUTOMATION), edge)).toMatchObject({ kind: 'drop', reason: 'bot', detail: 'automation' });
  });
  it('FLAG_UA_MISMATCH is NOT decided at the edge: it travels to the consumer in flags', () => {
    const out = validate(new Headers(BROWSER_HEADERS), body(FLAG_UA_MISMATCH), edge);
    expect(out.kind === 'accept' && out.event.flags).toBe(FLAG_UA_MISMATCH);
  });
  it('the client hints travel with the event; https is recorded; nothing else of the headers', () => {
    const out = validate(new Headers(BROWSER_HEADERS), body(), edge);
    expect(out.kind === 'accept' && out.event.hints).toEqual({
      chUa: BROWSER_HEADERS['sec-ch-ua'],
      chPlatform: '"Windows"',
      chMobile: '?0',
      lang: true,
      https: true,
    });
    const bare = validate(new Headers({ 'user-agent': BROWSER_HEADERS['user-agent']! }), body(), { ...edge, https: false });
    expect(bare.kind === 'accept' && bare.event.hints).toEqual({ lang: false, https: false });
  });
  it('an old tracker (no flags) is unaffected', () => {
    expect(validate(new Headers(BROWSER_HEADERS), body(), edge).kind).toBe('accept');
  });
});
