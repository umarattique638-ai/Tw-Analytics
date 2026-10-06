import { describe, expect, it } from 'vitest';

import {
  AUTOMATIC_EVENTS,
  EVENT_NAME_RE,
  LIMITS,
  RESERVED_NAME_PREFIX,
  SITE_KEY_RE,
  stripControlChars,
  UNSAFE_PROP_KEYS,
} from '../src/limits';

describe('contract limits', () => {
  it('uses a 32KB maximum request body', () => {
    expect(LIMITS.maxBodyBytes).toBe(32 * 1024);
  });

  it('uses a 2048 character URL limit', () => {
    expect(LIMITS.maxUrlLength).toBe(2048);
  });

  it('uses a 2048 character referrer limit', () => {
    expect(LIMITS.maxReferrerLength).toBe(2048);
  });

  it('uses a 256 character route limit', () => {
    expect(LIMITS.maxRouteLength).toBe(256);
  });

  it('uses a 64 character insert ID limit', () => {
    expect(LIMITS.maxInsertIdLength).toBe(64);
  });

  it('uses a 512 character User-Agent limit', () => {
    expect(LIMITS.maxUserAgentLength).toBe(512);
  });

  it('uses a 25 property maximum', () => {
    expect(LIMITS.maxProps).toBe(25);
  });

  it('uses 40 character property keys', () => {
    expect(LIMITS.maxPropKeyLength).toBe(40);
  });

  it('uses 255 character property values', () => {
    expect(LIMITS.maxPropValueLength).toBe(255);
  });

  it('uses a 30 minute session timeout', () => {
    expect(LIMITS.sessionGapMs).toBe(30 * 60 * 1000);
  });

  it('uses a 10 second strict engagement threshold', () => {
    expect(LIMITS.engagedMinMs).toBe(10_000);
  });

  it('uses a 72 hour backfill threshold', () => {
    expect(LIMITS.backfillAfterMs).toBe(72 * 60 * 60 * 1000);
  });

  it('uses a five minute future clock-skew allowance', () => {
    expect(LIMITS.maxFutureSkewMs).toBe(5 * 60 * 1000);
  });

  it('accepts valid event names', () => {
    expect(EVENT_NAME_RE.test('pageview')).toBe(true);
    expect(EVENT_NAME_RE.test('signup')).toBe(true);
    expect(EVENT_NAME_RE.test('checkout_complete')).toBe(true);
    expect(EVENT_NAME_RE.test('event123')).toBe(true);
  });

  it('rejects invalid event names', () => {
    expect(EVENT_NAME_RE.test('PageView')).toBe(false);
    expect(EVENT_NAME_RE.test('page-view')).toBe(false);
    expect(EVENT_NAME_RE.test('page view')).toBe(false);
    expect(EVENT_NAME_RE.test('event.name')).toBe(false);
    expect(EVENT_NAME_RE.test('')).toBe(false);
  });

  it('rejects event names longer than 40 characters', () => {
    expect(EVENT_NAME_RE.test('a'.repeat(40))).toBe(true);
    expect(EVENT_NAME_RE.test('a'.repeat(41))).toBe(false);
  });

  it('accepts the exact public site key format', () => {
    expect(
      SITE_KEY_RE.test('tw_pub_12345678901234567890123456789012'),
    ).toBe(true);
  });

  it('rejects short public site keys', () => {
    expect(
      SITE_KEY_RE.test('tw_pub_1234567890123456789012345678901'),
    ).toBe(false);
  });

  it('rejects long public site keys', () => {
    expect(
      SITE_KEY_RE.test('tw_pub_123456789012345678901234567890123'),
    ).toBe(false);
  });

  it('rejects site keys with invalid characters', () => {
    expect(
      SITE_KEY_RE.test('tw_pub_123456789012345678901234567890-'),
    ).toBe(false);
  });

  it('contains the reserved TailWatch namespace', () => {
    expect(RESERVED_NAME_PREFIX).toBe('tw_');
  });

  it('contains the required automatic events', () => {
    expect(AUTOMATIC_EVENTS.has('pageview')).toBe(true);
    expect(AUTOMATIC_EVENTS.has('session_start')).toBe(true);
    expect(AUTOMATIC_EVENTS.has('first_visit')).toBe(true);
    expect(AUTOMATIC_EVENTS.has('engagement')).toBe(true);
  });

  it('does not treat signup as an automatic event', () => {
    expect(AUTOMATIC_EVENTS.has('signup')).toBe(false);
  });

  it('contains exactly the current automatic event catalogue', () => {
    expect(AUTOMATIC_EVENTS.size).toBe(17);
  });

  it('protects unsafe JavaScript object property keys', () => {
    expect(UNSAFE_PROP_KEYS.has('__proto__')).toBe(true);
    expect(UNSAFE_PROP_KEYS.has('constructor')).toBe(true);
    expect(UNSAFE_PROP_KEYS.has('prototype')).toBe(true);
  });

  it('removes ASCII control characters', () => {
    expect(stripControlChars('hello\nworld')).toBe('helloworld');
    expect(stripControlChars('hello\tworld')).toBe('helloworld');
    expect(stripControlChars('hello\rworld')).toBe('helloworld');
    expect(stripControlChars('hello world')).toBe('hello world');
  });

  it('does not remove normal Unicode text', () => {
    expect(stripControlChars('hello پاکستان')).toBe('hello پاکستان');
  });
});