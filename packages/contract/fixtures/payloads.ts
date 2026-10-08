import type { DropReason, SiteConfig, ValidatedEvent } from '../src';

/**
 * Stage 1 fixture corpus: exactly 50 hand-written cases, FROZEN with wire v1.
 *
 * Every fixture states its exact outcome. The same corpus is replayed:
 *   - through validate() in packages/contract (Stage 1),
 *   - over HTTP through the collector Worker (Stage 2 done-when: "every fixture returns its code"),
 *   - and, for the accepted ones, through the consumer into ClickHouse (Stage 3).
 *
 * Context shared by all fixtures (the "edge" they are evaluated at):
 *   site     = FIXTURE_SITE (example.com and *.example.com)
 *   received = FIXTURE_RECEIVED_AT
 *   headers  = a desktop Chrome User-Agent unless the fixture overrides it
 */

export const SITE = 'tw_pub_1234567890ABCDEFGHIJKLMNOPQRSTUV';
export const OTHER_SITE = 'tw_pub_ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ';
export const URL = 'https://example.com/page';

/** The moment every fixture is evaluated at (2026-09-30 12:05:00 UTC). */
export const FIXTURE_RECEIVED_AT = Date.UTC(2026, 8, 30, 12, 5, 0);
/** Client created time used by most fixtures: five minutes before receipt. */
export const BASE = Date.UTC(2026, 8, 30, 12, 0, 0);

export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * Every header a real Chrome 126 on Windows sends with the tracker's POST (Stage 7). The consumer's
 * headless scoring treats a "Chrome" without client hints and without Accept-Language as a script.
 */
export const BROWSER_HEADERS: Readonly<Record<string, string>> = {
  'user-agent': BROWSER_UA,
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

/** Fixture-only client address. Used ONLY inside the hash computation, never stored. */
export const FIXTURE_IP = '203.0.113.7';

export const FIXTURE_SITE: SiteConfig = {
  id: 123,
  publicKey: SITE,
  allowedHosts: ['example.com', '*.example.com'],
  live: true,
  region: 'in',
  identitySecret: 'fixture-identity-secret-not-for-production',
};

export type FixtureExpectation =
  | {
      kind: 'accept';
      /** Exact warning list (default: none). */
      warnings?: string[];
      /** Fields of the ValidatedEvent that must match exactly. */
      event?: Partial<ValidatedEvent>;
    }
  | { kind: 'drop'; reason: DropReason }
  | { kind: 'reject'; status: 400 | 413; error: string };

export interface ContractFixture {
  name: string;
  /** JSON-encoded into the request body. Ignored when `body` is set. */
  payload?: unknown;
  /** Raw body, for cases JSON.stringify cannot produce. */
  body?: string;
  /** Header overrides. `null` removes the header. Default: { 'user-agent': BROWSER_UA }. */
  headers?: Record<string, string | null>;
  /** request.cf.asn for this request. */
  asn?: number;
  expect: FixtureExpectation;
}

const p = (extra: Record<string, unknown> = {}) => ({ s: SITE, n: 'pageview', u: URL, q: 1, t: BASE, v: 1, ...extra });
const accept = (event?: Partial<ValidatedEvent>, warnings: string[] = []): FixtureExpectation => ({ kind: 'accept', event, warnings });
const drop = (reason: DropReason): FixtureExpectation => ({ kind: 'drop', reason });
const bad = (error: string): FixtureExpectation => ({ kind: 'reject', status: 400, error });

export const contractFixtures: ContractFixture[] = [
  // ---------------------------------------------------------------- accepted (22)
  {
    name: 'pageview_minimal',
    payload: p(),
    expect: accept({ siteId: 123, name: 'pageview', url: 'https://example.com/page', host: 'example.com', path: '/page', seq: 1, createdAt: BASE, occurredAt: BASE, backfill: false, trackerVersion: 1, flags: 0, props: {} }),
  },
  {
    name: 'pageview_all_fields',
    payload: p({ u: 'https://Example.com/page/1/?b=2&a=1#fragment', q: 2, r: 'https://ref.example/path', rt: '/page/[id]', w: 1440, i: 'insert-0002', e: 1200, f: 0 }),
    expect: accept({ url: 'https://example.com/page/1', path: '/page/1', route: '/page/[id]', referrer: 'https://ref.example/path', width: 1440, insertId: 'insert-0002', engagementMs: 1200, seq: 2 }),
  },
  {
    name: 'custom_event_with_props',
    payload: p({ n: 'signup', q: 3, i: 'insert-0003', p: { plan: 'pro', seats: 5, trial: false } }),
    expect: accept({ name: 'signup', props: { plan: 'pro', seats: 5, trial: false } }),
  },
  {
    name: 'utm_kept_others_dropped_and_sorted',
    payload: p({ u: 'https://example.com/landing?utm_source=news&x=1&utm_medium=email&gclid=abc', q: 4 }),
    expect: accept({ url: 'https://example.com/landing?utm_medium=email&utm_source=news', path: '/landing' }),
  },
  {
    name: 'host_case_and_trailing_slash_normalised',
    payload: p({ u: 'HTTPS://WWW.EXAMPLE.COM/Blog/', q: 5 }),
    expect: accept({ url: 'https://www.example.com/Blog', host: 'www.example.com', path: '/Blog' }),
  },
  {
    name: 'subdomain_allowed_by_wildcard',
    payload: p({ u: 'https://shop.example.com/cart', q: 6 }),
    expect: accept({ host: 'shop.example.com', path: '/cart' }),
  },
  {
    name: 'explicit_port_kept',
    payload: p({ u: 'https://example.com:8443/admin', q: 7 }),
    expect: accept({ url: 'https://example.com:8443/admin', host: 'example.com' }),
  },
  {
    name: 'referrer_query_and_fragment_stripped',
    payload: p({ r: 'https://google.com/search?q=private+words#frag', q: 8 }),
    expect: accept({ referrer: 'https://google.com/search' }),
  },
  {
    name: 'clock_skew_corrected_with_sent_at',
    // Device clock is 1 h slow. Created 2 s before it was sent.
    payload: p({ t: FIXTURE_RECEIVED_AT - 3_600_000 - 2_000, x: FIXTURE_RECEIVED_AT - 3_600_000, q: 9 }),
    expect: accept({ occurredAt: FIXTURE_RECEIVED_AT - 2_000, createdAt: FIXTURE_RECEIVED_AT - 3_602_000, backfill: false }),
  },
  {
    name: 'old_event_is_backfill_not_rewritten',
    payload: p({ t: FIXTURE_RECEIVED_AT - 4 * 86_400_000, q: 10 }),
    expect: accept({ occurredAt: FIXTURE_RECEIVED_AT - 4 * 86_400_000, backfill: true }),
  },
  {
    name: 'future_timestamp_repaired_with_warning',
    payload: p({ t: FIXTURE_RECEIVED_AT + 86_400_000, q: 11 }),
    expect: accept({ occurredAt: FIXTURE_RECEIVED_AT, backfill: false }, ['timestamp_repaired_future']),
  },
  {
    name: 'unknown_future_field_accepted_and_kept',
    payload: p({ q: 12, zz: 'from-a-newer-tracker' }),
    expect: accept({ extra: { zz: 'from-a-newer-tracker' } }),
  },
  {
    name: 'card_number_property_refused',
    payload: p({ n: 'checkout', q: 13, p: { card: '4111 1111 1111 1111', step: 'pay' } }),
    expect: accept({ props: { step: 'pay' } }, ['sensitive_prop_refused:card']),
  },
  {
    name: 'ssn_property_refused',
    payload: p({ n: 'apply', q: 14, p: { ssn: '123-45-6789' } }),
    expect: accept({ props: {} }, ['sensitive_prop_refused:ssn']),
  },
  {
    name: 'too_many_props_truncated_to_25',
    payload: p({ n: 'big', q: 15, p: Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`k${String(i).padStart(2, '0')}`, i])) }),
    expect: accept(undefined, ['props_truncated:26']),
  },
  {
    name: 'proto_prop_key_ignored',
    payload: p({ n: 'evt', q: 16, p: JSON.parse('{"__proto__":"x","ok":1}') }),
    expect: accept({ props: { ok: 1 } }, ['prop_key_invalid']),
  },
  {
    name: 'prop_value_over_255_ignored',
    payload: p({ n: 'evt', q: 17, p: { long: 'a'.repeat(256), short: 'b' } }),
    expect: accept({ props: { short: 'b' } }, ['prop_value_too_long:long']),
  },
  {
    name: 'nested_prop_value_ignored',
    payload: p({ n: 'evt', q: 18, p: { nested: { a: 1 }, flat: true } }),
    expect: accept({ props: { flat: true } }, ['prop_type_invalid:nested']),
  },
  {
    name: 'control_chars_stripped_from_route',
    payload: p({ q: 19, rt: '/a\nb\u0000c' }),
    expect: accept({ route: '/abc' }),
  },
  {
    name: 'engagement_event',
    payload: p({ n: 'engagement', q: 20, e: 15_000 }),
    expect: accept({ name: 'engagement', engagementMs: 15_000 }),
  },
  {
    name: 'first_pageview_flag',
    payload: p({ q: 21, f: 1 }),
    expect: accept({ flags: 1 }),
  },
  {
    name: 'percent_encoded_path_kept',
    payload: p({ q: 22, u: 'https://example.com/caf%C3%A9' }),
    expect: accept({ path: '/caf%C3%A9' }),
  },

  // ---------------------------------------------------------------- dropped, still 204 (9)
  { name: 'unknown_site_key', payload: p({ s: OTHER_SITE }), expect: drop('not_found') },
  { name: 'hostname_not_registered', payload: p({ u: 'https://evil-example.com/' }), expect: drop('hostname') },
  { name: 'lookalike_suffix_host', payload: p({ u: 'https://example.com.evil.net/' }), expect: drop('hostname') },
  { name: 'global_privacy_control', payload: p(), headers: { 'sec-gpc': '1' }, expect: drop('gpc') },
  { name: 'curl_user_agent', payload: p(), headers: { 'user-agent': 'curl/8.4.0' }, expect: drop('bot') },
  { name: 'missing_user_agent', payload: p(), headers: { 'user-agent': null }, expect: drop('bot') },
  { name: 'headless_chrome', payload: p(), headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/126.0.0.0 Safari/537.36' }, expect: drop('bot') },
  { name: 'install_verifier', payload: p(), headers: { 'user-agent': 'TailwatchVerifier/1.0' }, expect: drop('verification_agent') },
  { name: 'datacentre_asn', payload: p(), asn: 16509, expect: drop('bot') },

  // ---------------------------------------------------------------- rejected (19)
  { name: 'not_json', body: '{{{', expect: bad('invalid_json') },
  { name: 'json_array', body: '[]', expect: bad('not_an_object') },
  { name: 'bad_site_key', payload: p({ s: 'tw_bad' }), expect: bad('bad_site_key') },
  { name: 'uppercase_event_name', payload: p({ n: 'PageView' }), expect: bad('bad_event_name') },
  { name: 'empty_event_name', payload: p({ n: '' }), expect: bad('bad_event_name') },
  { name: 'event_name_41_chars', payload: p({ n: 'a'.repeat(41) }), expect: bad('bad_event_name') },
  { name: 'url_not_a_string', payload: p({ u: 123 }), expect: bad('bad_url') },
  { name: 'empty_url', payload: p({ u: '' }), expect: bad('bad_url') },
  { name: 'url_not_http', payload: p({ u: 'ftp://example.com/file' }), expect: bad('bad_url') },
  { name: 'sequence_zero', payload: p({ q: 0 }), expect: bad('bad_seq') },
  { name: 'sequence_fraction', payload: p({ q: 1.5 }), expect: bad('bad_seq') },
  { name: 'timestamp_zero', payload: p({ t: 0 }), expect: bad('bad_timestamp') },
  { name: 'missing_version', payload: { s: SITE, n: 'pageview', u: URL, q: 1, t: BASE }, expect: bad('bad_version') },
  { name: 'version_as_string', payload: p({ v: '1' }), expect: bad('bad_version') },
  { name: 'referrer_not_a_string', payload: p({ r: 42 }), expect: bad('bad_referrer') },
  { name: 'negative_engagement', payload: p({ e: -1 }), expect: bad('bad_engagement') },
  { name: 'flags_over_255', payload: p({ f: 256 }), expect: bad('bad_flags') },
  { name: 'props_is_array', payload: p({ p: [] }), expect: bad('bad_props') },
  {
    name: 'body_over_32_kib',
    payload: p({ pad: 'x'.repeat(33 * 1024) }),
    expect: { kind: 'reject', status: 413, error: 'body_too_large' },
  },
];

/** The request body a fixture produces. */
export function fixtureBody(fixture: ContractFixture): string {
  return fixture.body ?? JSON.stringify(fixture.payload);
}

/** The request headers a fixture produces (lower-case names; `null` means "absent"). */
export function fixtureHeaders(fixture: ContractFixture): Record<string, string> {
  const merged: Record<string, string | null> = { ...BROWSER_HEADERS, ...fixture.headers };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (v !== null) out[k.toLowerCase()] = v;
  return out;
}

export const acceptedFixtures = (): ContractFixture[] => contractFixtures.filter((f) => f.expect.kind === 'accept');
export const droppedFixtures = (): ContractFixture[] => contractFixtures.filter((f) => f.expect.kind === 'drop');
export const rejectedFixtures = (): ContractFixture[] => contractFixtures.filter((f) => f.expect.kind === 'reject');
