import type { WirePayload } from '../src';

/** Stage 1: exactly 50 hand-written contract fixtures. */
export const SITE = 'tw_pub_1234567890ABCDEFGHIJKLMNOPQRSTUV';
export const URL = 'https://example.com/page';
export const BASE = Date.UTC(2026, 8, 30, 12, 0, 0);

export interface ContractFixture {
  name: string;
  payload: unknown;
  expected: 'accept' | string;
}

export const contractFixtures: ContractFixture[] = [
  { name: 'valid_01', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/1/?b=2&a=1#fragment`, q: 1, t: BASE + 1 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-01', e: 100, f: 0, p: { plan: 'free', index: 1, active: true } }, expected: 'accept' },
  { name: 'valid_02', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/2/?b=2&a=1#fragment`, q: 2, t: BASE + 2 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-02', e: 200, f: 0, p: { plan: 'free', index: 2, active: true } }, expected: 'accept' },
  { name: 'valid_03', payload: { s: SITE, n: 'signup', u: `https://Example.com/page/3/?b=2&a=1#fragment`, q: 3, t: BASE + 3 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-03', e: 300, f: 0, p: { plan: 'free', index: 3, active: true } }, expected: 'accept' },
  { name: 'valid_04', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/4/?b=2&a=1#fragment`, q: 4, t: BASE + 4 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-04', e: 400, f: 0, p: { plan: 'free', index: 4, active: true } }, expected: 'accept' },
  { name: 'valid_05', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/5/?b=2&a=1#fragment`, q: 5, t: BASE + 5 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-05', e: 500, f: 0, p: { plan: 'free', index: 5, active: true } }, expected: 'accept' },
  { name: 'valid_06', payload: { s: SITE, n: 'signup', u: `https://Example.com/page/6/?b=2&a=1#fragment`, q: 6, t: BASE + 6 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-06', e: 600, f: 0, p: { plan: 'free', index: 6, active: true } }, expected: 'accept' },
  { name: 'valid_07', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/7/?b=2&a=1#fragment`, q: 7, t: BASE + 7 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-07', e: 700, f: 0, p: { plan: 'free', index: 7, active: true } }, expected: 'accept' },
  { name: 'valid_08', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/8/?b=2&a=1#fragment`, q: 8, t: BASE + 8 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-08', e: 800, f: 0, p: { plan: 'free', index: 8, active: true } }, expected: 'accept' },
  { name: 'valid_09', payload: { s: SITE, n: 'signup', u: `https://Example.com/page/9/?b=2&a=1#fragment`, q: 9, t: BASE + 9 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-09', e: 900, f: 0, p: { plan: 'free', index: 9, active: true } }, expected: 'accept' },
  { name: 'valid_10', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/10/?b=2&a=1#fragment`, q: 10, t: BASE + 10 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-10', e: 1000, f: 0, p: { plan: 'free', index: 10, active: true } }, expected: 'accept' },
  { name: 'valid_11', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/11/?b=2&a=1#fragment`, q: 11, t: BASE + 11 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-11', e: 1100, f: 0, p: { plan: 'free', index: 11, active: true } }, expected: 'accept' },
  { name: 'valid_12', payload: { s: SITE, n: 'signup', u: `https://Example.com/page/12/?b=2&a=1#fragment`, q: 12, t: BASE + 12 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-12', e: 1200, f: 0, p: { plan: 'free', index: 12, active: true } }, expected: 'accept' },
  { name: 'valid_13', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/13/?b=2&a=1#fragment`, q: 13, t: BASE + 13 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-13', e: 1300, f: 0, p: { plan: 'free', index: 13, active: true } }, expected: 'accept' },
  { name: 'valid_14', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/14/?b=2&a=1#fragment`, q: 14, t: BASE + 14 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-14', e: 1400, f: 0, p: { plan: 'free', index: 14, active: true } }, expected: 'accept' },
  { name: 'valid_15', payload: { s: SITE, n: 'signup', u: `https://Example.com/page/15/?b=2&a=1#fragment`, q: 15, t: BASE + 15 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-15', e: 1500, f: 0, p: { plan: 'free', index: 15, active: true } }, expected: 'accept' },
  { name: 'valid_16', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/16/?b=2&a=1#fragment`, q: 16, t: BASE + 16 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-16', e: 1600, f: 0, p: { plan: 'free', index: 16, active: true } }, expected: 'accept' },
  { name: 'valid_17', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/17/?b=2&a=1#fragment`, q: 17, t: BASE + 17 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-17', e: 1700, f: 0, p: { plan: 'free', index: 17, active: true } }, expected: 'accept' },
  { name: 'valid_18', payload: { s: SITE, n: 'signup', u: `https://Example.com/page/18/?b=2&a=1#fragment`, q: 18, t: BASE + 18 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-18', e: 1800, f: 0, p: { plan: 'free', index: 18, active: true } }, expected: 'accept' },
  { name: 'valid_19', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/19/?b=2&a=1#fragment`, q: 19, t: BASE + 19 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-19', e: 1900, f: 0, p: { plan: 'free', index: 19, active: true } }, expected: 'accept' },
  { name: 'valid_20', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/20/?b=2&a=1#fragment`, q: 20, t: BASE + 20 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-20', e: 2000, f: 0, p: { plan: 'free', index: 20, active: true } }, expected: 'accept' },
  { name: 'valid_21', payload: { s: SITE, n: 'signup', u: `https://Example.com/page/21/?b=2&a=1#fragment`, q: 21, t: BASE + 21 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-21', e: 2100, f: 0, p: { plan: 'free', index: 21, active: true } }, expected: 'accept' },
  { name: 'valid_22', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/22/?b=2&a=1#fragment`, q: 22, t: BASE + 22 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-22', e: 2200, f: 0, p: { plan: 'free', index: 22, active: true } }, expected: 'accept' },
  { name: 'valid_23', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/23/?b=2&a=1#fragment`, q: 23, t: BASE + 23 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-23', e: 2300, f: 0, p: { plan: 'free', index: 23, active: true } }, expected: 'accept' },
  { name: 'valid_24', payload: { s: SITE, n: 'signup', u: `https://Example.com/page/24/?b=2&a=1#fragment`, q: 24, t: BASE + 24 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-24', e: 2400, f: 0, p: { plan: 'free', index: 24, active: true } }, expected: 'accept' },
  { name: 'valid_25', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/25/?b=2&a=1#fragment`, q: 25, t: BASE + 25 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-25', e: 2500, f: 0, p: { plan: 'free', index: 25, active: true } }, expected: 'accept' },
  { name: 'valid_26', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/26/?b=2&a=1#fragment`, q: 26, t: BASE + 26 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-26', e: 2600, f: 0, p: { plan: 'free', index: 26, active: true } }, expected: 'accept' },
  { name: 'valid_27', payload: { s: SITE, n: 'signup', u: `https://Example.com/page/27/?b=2&a=1#fragment`, q: 27, t: BASE + 27 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-27', e: 2700, f: 0, p: { plan: 'free', index: 27, active: true } }, expected: 'accept' },
  { name: 'valid_28', payload: { s: SITE, n: 'pageview', u: `https://Example.com/page/28/?b=2&a=1#fragment`, q: 28, t: BASE + 28 * 1000, v: 1, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-28', e: 2800, f: 0, p: { plan: 'free', index: 28, active: true } }, expected: 'accept' },
  { name: 'bad_site_key', payload: { s: 'tw_bad', n: 'pageview', u: URL, q: 31, t: BASE, v: 1 }, expected: 'bad_site_key' },
  { name: 'bad_event_name', payload: { s: SITE, n: 'PageView', u: URL, q: 32, t: BASE, v: 1 }, expected: 'bad_event_name' },
  { name: 'empty_event_name', payload: { s: SITE, n: '', u: URL, q: 33, t: BASE, v: 1 }, expected: 'bad_event_name' },
  { name: 'bad_url_type', payload: { s: SITE, n: 'pageview', u: 123, q: 34, t: BASE, v: 1 }, expected: 'bad_url' },
  { name: 'empty_url', payload: { s: SITE, n: 'pageview', u: '', q: 35, t: BASE, v: 1 }, expected: 'bad_url' },
  { name: 'bad_seq_zero', payload: { s: SITE, n: 'pageview', u: URL, q: 0, t: BASE, v: 1 }, expected: 'bad_seq' },
  { name: 'bad_seq_fraction', payload: { s: SITE, n: 'pageview', u: URL, q: 1.5, t: BASE, v: 1 }, expected: 'bad_seq' },
  { name: 'bad_timestamp', payload: { s: SITE, n: 'pageview', u: URL, q: 36, t: 0, v: 1 }, expected: 'bad_timestamp' },
  { name: 'missing_version', payload: { s: SITE, n: 'pageview', u: URL, q: 37, t: BASE }, expected: 'bad_version' },
  { name: 'bad_version_string', payload: { s: SITE, n: 'pageview', u: URL, q: 38, t: BASE, v: '1' }, expected: 'bad_version' },
  { name: 'bad_referrer', payload: { s: SITE, n: 'pageview', u: URL, q: 39, t: BASE, v: 1, r: 42 }, expected: 'bad_referrer' },
  { name: 'bad_engagement', payload: { s: SITE, n: 'pageview', u: URL, q: 40, t: BASE, v: 1, e: -1 }, expected: 'bad_engagement' },
  { name: 'bad_route', payload: { s: SITE, n: 'pageview', u: URL, q: 41, t: BASE, v: 1, rt: 42 }, expected: 'bad_route' },
  { name: 'bad_width', payload: { s: SITE, n: 'pageview', u: URL, q: 42, t: BASE, v: 1, w: -1 }, expected: 'bad_width' },
  { name: 'bad_insert_id', payload: { s: SITE, n: 'pageview', u: URL, q: 43, t: BASE, v: 1, i: 42 }, expected: 'bad_insert_id' },
  { name: 'bad_sent_at', payload: { s: SITE, n: 'pageview', u: URL, q: 44, t: BASE, v: 1, x: 0 }, expected: 'bad_sent_at' },
  { name: 'bad_flags', payload: { s: SITE, n: 'pageview', u: URL, q: 45, t: BASE, v: 1, f: 256 }, expected: 'bad_flags' },
  { name: 'props_array', payload: { s: SITE, n: 'pageview', u: URL, q: 46, t: BASE, v: 1, p: [] }, expected: 'bad_props' },
  { name: 'props_null', payload: { s: SITE, n: 'pageview', u: URL, q: 47, t: BASE, v: 1, p: null }, expected: 'bad_props' },
  { name: 'too_many_props', payload: { s: SITE, n: 'pageview', u: URL, q: 48, t: BASE, v: 1, p: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`k${i}`, i])) }, expected: 'accept_warning' },
  { name: 'unsafe_prop', payload: { s: SITE, n: 'pageview', u: URL, q: 49, t: BASE, v: 1, p: JSON.parse('{"__proto__":"x"}') }, expected: 'accept_warning' },
  { name: 'bad_props_boolean', payload: { s: SITE, n: 'pageview', u: URL, q: 50, t: BASE, v: 1, p: true }, expected: 'bad_props' },
] as ContractFixture[];

export const validWireFixtures: WirePayload[] = contractFixtures
  .filter((fixture) => fixture.expected === 'accept')
  .map((fixture) => fixture.payload as WirePayload);

export const malformedFixtureCount = contractFixtures.filter(
  (fixture) => fixture.expected !== 'accept',
).length;
