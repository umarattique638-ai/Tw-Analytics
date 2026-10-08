import { describe, expect, it } from 'vitest';

import {
  FLAG_FIRST_PAGEVIEW,
  WIRE_FIELDS,
  WIRE_VERSION,
  isKnownWireField,
} from '../src/wire';

import type { WirePayload } from '../src/wire';

describe('wire contract', () => {
  it('has wire version 1', () => {
    expect(WIRE_VERSION).toBe(1);
  });

  it('has the first pageview flag', () => {
    expect(FLAG_FIRST_PAGEVIEW).toBe(1);
  });

  it('contains exactly the frozen v1 fields', () => {
    expect(WIRE_FIELDS).toEqual([
      's',
      'n',
      'u',
      'q',
      't',
      'v',
      'r',
      'e',
      'rt',
      'w',
      'i',
      'x',
      'f',
      'p',
    ]);
  });

  it('contains no duplicate fields', () => {
    expect(new Set(WIRE_FIELDS).size).toBe(WIRE_FIELDS.length);
  });

  it('accepts the minimum valid payload', () => {
    const payload: WirePayload = {
      s: 'tw_pub_12345678901234567890123456789012',
      n: 'pageview',
      u: 'https://example.com/',
      q: 1,
      t: 1_760_000_000_000,
      v: 1,
    };

    expect(payload.s).toMatch(/^tw_pub_[A-Za-z0-9]{32}$/);
    expect(payload.n).toBe('pageview');
    expect(payload.q).toBe(1);
  });

  it('accepts optional v1 fields', () => {
    const payload: WirePayload = {
      s: 'tw_pub_12345678901234567890123456789012',
      n: 'pageview',
      u: 'https://example.com/',
      q: 1,
      t: 1_760_000_000_000,

      v: 1,
      r: 'https://google.com/',
      e: 12_500,
      rt: '/blog/[slug]',
      w: 1440,
      i: 'event-123',
      x: 123,
      f: FLAG_FIRST_PAGEVIEW,
      p: {
        plan: 'pro',
        seats: 5,
        active: true,
      },
    };

    expect(payload.v).toBe(1);
    expect(payload.e).toBe(12_500);
    expect(payload.w).toBe(1440);
    expect(payload.f).toBe(FLAG_FIRST_PAGEVIEW);
    expect(payload.p).toEqual({
      plan: 'pro',
      seats: 5,
      active: true,
    });
  });

  it('allows unknown future fields', () => {
    const payload: WirePayload = {
      s: 'tw_pub_12345678901234567890123456789012',
      n: 'pageview',
      u: 'https://example.com/',
      q: 1,
      t: 1_760_000_000_000,
      v: 1,

      future_field: 'future-value',
      future_number: 123,
    };

    expect(payload.future_field).toBe('future-value');
    expect(payload.future_number).toBe(123);
  });

  it('recognizes known fields', () => {
    expect(isKnownWireField('s')).toBe(true);
    expect(isKnownWireField('n')).toBe(true);
    expect(isKnownWireField('u')).toBe(true);
    expect(isKnownWireField('q')).toBe(true);
    expect(isKnownWireField('t')).toBe(true);
    expect(isKnownWireField('p')).toBe(true);
  });

  it('does not classify future fields as known', () => {
    expect(isKnownWireField('future_field')).toBe(false);
    expect(isKnownWireField('foo')).toBe(false);
  });

  it('keeps the wire field count at 14', () => {
    expect(WIRE_FIELDS).toHaveLength(14);
  });
});
describe('STAGE-1 A6 flags (Stage 7)', () => {
  it('bit values are frozen', async () => {
    const w = await import('../src/wire');
    expect([w.FLAG_FIRST_PAGEVIEW, w.FLAG_HASH_ROUTE, w.FLAG_AUTOMATION, w.FLAG_UA_MISMATCH]).toEqual([1, 2, 4, 8]);
  });
});
