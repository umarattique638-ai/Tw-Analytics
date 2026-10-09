/**
 * Query API (BUILD-ORDER Stage 6): every number on the dashboard comes from one of the named queries
 * below, run against ClickHouse as the read-only user tw_read. docs/QUERIES.md lists them verbatim
 * (a test keeps it identical), so every number is reproducible by pasting the query in a SQL console.
 *
 * Time: a site's day is its LOCAL calendar day (sites.timezone, IANA). Ranges are [local midnight,
 * next local midnight) converted to UTC instants by ClickHouse itself (toDateTime64(..., tz)), so a
 * DST day has 23 or 25 hours and nothing is shifted (PLAN 5, STAGE-1 D3).
 *
 * Metric definitions are PLAN 5 / packages/contract/src/metrics.ts:
 *   visitors  = distinct daily visitor hashes. Exact for one day; for longer ranges the hash rotates
 *               daily, so the count is an upper bound and is labelled "Estimated" (STAGE-1 D6).
 *   sessions  = sum(sign) over the VersionedCollapsingMergeTree (correct before and after merges).
 *   bounce    = 1 - engaged_sessions / sessions (derived, never primary).
 *   capture   = received sequence numbers / expected, per page load (PLAN 5 ⭐).
 */
import { AUTOMATIC_EVENTS } from '@tailwatch/contract';
import type { ClickHouseClient } from './analytics';

export type RangeKey = 'today' | '7d' | '30d';
export const RANGE_KEYS: RangeKey[] = ['today', '7d', '30d'];

export interface Range {
  key: RangeKey;
  tz: string;
  /** Local dates, inclusive. */
  from: string;
  to: string;
  days: number;
  prev: { from: string; to: string };
  /** Today is shown per local hour, longer ranges per local day. */
  hourly: boolean;
}

/** YYYY-MM-DD of an instant in a timezone. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function resolveRange(key: RangeKey, tz: string, now: Date): Range {
  const days = key === 'today' ? 1 : key === '7d' ? 7 : 30;
  const to = localDate(now, tz);
  const from = addDays(to, -(days - 1));
  return { key, tz, from, to, days, prev: { from: addDays(from, -days), to: addDays(from, -1) }, hourly: key === 'today' };
}

/** Query parameters for [from 00:00, to+1 00:00) local. */
const bounds = (site: number, tz: string, from: string, to: string) => ({
  site,
  tz,
  from: `${from} 00:00:00`,
  until: `${addDays(to, 1)} 00:00:00`,
});

/** Local-day range condition on a DateTime64 column (exact across DST). */
const IN_RANGE = (col: string) =>
  `site_id = {site:UInt64} AND ${col} >= toDateTime64({from:String}, 3, {tz:String}) AND ${col} < toDateTime64({until:String}, 3, {tz:String})`;

/**
 * The documented queries. `{db}` is the database (tailwatch); everything in {name:Type} is a ClickHouse
 * query parameter (in the SQL console: SET param_site = 101, param_tz = 'Asia/Karachi', ...).
 */
export const QUERIES = {
  visitors_pageviews: `SELECT uniqExact(visitor_hash) AS visitors, countIf(name = 'pageview') AS pageviews, count() AS events
FROM {db}.events
WHERE ${IN_RANGE('timestamp')}`,

  sessions_bounce: `SELECT sum(sign) AS sessions, sum(is_engaged * sign) AS engaged_sessions
FROM {db}.sessions
WHERE ${IN_RANGE('start')}`,

  series_daily: `SELECT toString(toDate(timestamp, {tz:String})) AS bucket, uniqExact(visitor_hash) AS visitors, countIf(name = 'pageview') AS pageviews
FROM {db}.events
WHERE ${IN_RANGE('timestamp')}
GROUP BY bucket`,

  series_daily_sessions: `SELECT toString(toDate(start, {tz:String})) AS bucket, sum(sign) AS sessions
FROM {db}.sessions
WHERE ${IN_RANGE('start')}
GROUP BY bucket`,

  series_hourly: `SELECT toString(toUnixTimestamp(toStartOfHour(timestamp, {tz:String}))) AS bucket, uniqExact(visitor_hash) AS visitors, countIf(name = 'pageview') AS pageviews
FROM {db}.events
WHERE ${IN_RANGE('timestamp')}
GROUP BY bucket`,

  series_hourly_sessions: `SELECT toString(toUnixTimestamp(toStartOfHour(start, {tz:String}))) AS bucket, sum(sign) AS sessions
FROM {db}.sessions
WHERE ${IN_RANGE('start')}
GROUP BY bucket`,

  top_pages: `SELECT pathname, countMerge(pageviews) AS pageviews, uniqMerge(visitors) AS visitors
FROM {db}.rollup_15m_pages
WHERE site_id = {site:UInt64} AND bucket >= toDateTime({from:String}, {tz:String}) AND bucket < toDateTime({until:String}, {tz:String})
GROUP BY pathname
ORDER BY pageviews DESC, pathname
LIMIT 10`,

  sources: `SELECT referrer_source AS source, sum(sign) AS sessions
FROM {db}.sessions
WHERE ${IN_RANGE('start')}
GROUP BY source
HAVING sessions > 0
ORDER BY sessions DESC, source
LIMIT 50`,

  countries: `SELECT country_code AS label, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE ${IN_RANGE('timestamp')} AND name = 'pageview'
GROUP BY label
ORDER BY visitors DESC, label
LIMIT 8`,

  devices: `SELECT device AS label, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE ${IN_RANGE('timestamp')} AND name = 'pageview'
GROUP BY label
ORDER BY visitors DESC, label
LIMIT 8`,

  browsers: `SELECT browser AS label, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE ${IN_RANGE('timestamp')} AND name = 'pageview'
GROUP BY label
ORDER BY visitors DESC, label
LIMIT 8`,

  // Every page load numbers its hits 1, 2, 3 ... (seq). Per visitor, count how often each number arrived
  // (c). Page loads that reached number k are at least as many as those that reached any later number,
  // so expected(k) = the largest count at k or above, and a missing number counts as expected too.
  // Unlike a "runs of rising seq" split, this does not break when one visitor has two tabs open or two
  // people share an IP and browser (2026-10-09 review). Beacons lost after the last one that arrived
  // cannot be seen: this stays an upper bound of the true capture rate.
  capture_rate: `SELECT sum(c) AS received, sum((seq - prev) * m) AS expected
FROM
(
    SELECT visitor_hash, seq, c,
           lagInFrame(seq, 1, 0) OVER (PARTITION BY visitor_hash ORDER BY seq ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS prev,
           max(c) OVER (PARTITION BY visitor_hash ORDER BY seq DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS m
    FROM
    (
        SELECT visitor_hash, seq, count() AS c
        FROM {db}.events
        WHERE ${IN_RANGE('timestamp')} AND seq > 0
        GROUP BY visitor_hash, seq
    )
)`,

  drops_by_reason: `SELECT reason, sum(hits) AS hits, any(detail) AS detail, toUnixTimestamp64Milli(max(at)) AS last
FROM {db}.dropped_hits
WHERE ${IN_RANGE('at')}
GROUP BY reason
ORDER BY hits DESC`,

  drops_list: `SELECT reason, detail, country_code, asn, sum(hits) AS hits, toUnixTimestamp64Milli(max(at)) AS last
FROM {db}.dropped_hits
WHERE ${IN_RANGE('at')}
GROUP BY reason, detail, country_code, asn
ORDER BY last DESC
LIMIT 200`,

  events_by_name: `SELECT name, count() AS events, toUnixTimestamp64Milli(max(received_at)) AS last
FROM {db}.events
WHERE ${IN_RANGE('timestamp')}
GROUP BY name
ORDER BY events DESC, name`,

  events_first_seen: `SELECT name, toUnixTimestamp64Milli(min(timestamp)) AS first
FROM {db}.events
WHERE site_id = {site:UInt64}
GROUP BY name`,

  // Properties with more than 100 distinct values cannot become report breakdowns (PLAN 6.5).
  high_cardinality_props: `SELECT name, key, uniqExact(value) AS distinct_values
FROM {db}.events
ARRAY JOIN mapKeys(props) AS key, mapValues(props) AS value
WHERE ${IN_RANGE('timestamp')}
GROUP BY name, key
HAVING distinct_values > 100
ORDER BY distinct_values DESC
LIMIT 20`,

  live_active: `SELECT uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE site_id = {site:UInt64} AND received_at > {now:DateTime64(3, 'UTC')} - INTERVAL 5 MINUTE AND received_at <= {now:DateTime64(3, 'UTC')}`,

  live_minutes: `SELECT toString(toUnixTimestamp(toStartOfMinute(received_at))) AS minute, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE site_id = {site:UInt64} AND received_at > {now:DateTime64(3, 'UTC')} - INTERVAL 30 MINUTE AND received_at <= {now:DateTime64(3, 'UTC')}
GROUP BY minute`,

  live_events: `SELECT name, pathname, country_code, toUnixTimestamp64Milli(received_at) AS at
FROM {db}.events
WHERE site_id = {site:UInt64} AND received_at > {now:DateTime64(3, 'UTC')} - INTERVAL 1 DAY AND received_at <= {now:DateTime64(3, 'UTC')}
ORDER BY received_at DESC
LIMIT 20`,
} as const;

export type QueryName = keyof typeof QUERIES;

// --------------------------------------------------------------------------------------------- shapes

export interface Bar {
  label: string;
  value: number;
}
export interface Overview {
  range: Range;
  kpis: {
    visitors: number;
    visitorsEstimated: boolean;
    sessions: number;
    pageviews: number;
    bounceRate: number | null;
    previous: { visitors: number; sessions: number; pageviews: number; bounceRate: number | null };
  };
  series: { bucket: string; label: string; visitors: number; sessions: number; pageviews: number }[];
  sources: { name: string; sessions: number }[];
  referrers: Bar[];
  pages: Bar[];
  countries: Bar[];
  devices: Bar[];
  browsers: Bar[];
  capture: { received: number; expected: number; rate: number | null };
  drops: { reason: string; hits: number; detail: string; last: number }[];
}

export interface Live {
  now: number;
  active: number;
  minutes: { minute: number; visitors: number }[];
  events: { name: string; path: string; country: string; at: number }[];
}

export interface EventsReport {
  range: Range;
  events: { name: string; kind: 'automatic' | 'custom'; events: number; last: number; firstSeen: number; isNew: boolean }[];
  highCardinality: { name: string; key: string; distinctValues: number }[];
}

export interface DropsReport {
  range: Range;
  rows: { reason: string; detail: string; country: string; asn: number; hits: number; last: number }[];
}

// -------------------------------------------------------------------------------------- source groups

const SEARCH = /(^|\.)(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave|startpage|naver|seznam|qwant)\./;
const SOCIAL = /(^|\.)(facebook|fb|instagram|twitter|x|t|linkedin|lnkd|reddit|youtube|tiktok|pinterest|threads|mastodon|whatsapp|telegram|discord)\.(com|co|net|org|me|social|in)$/;

/** Referrer host -> channel. Direct = no referrer (or a self-referral, removed by the consumer). */
export function channelOf(source: string): 'Direct' | 'Search' | 'Social' | 'Referral' {
  if (!source) return 'Direct';
  if (SEARCH.test(source)) return 'Search';
  if (SOCIAL.test(source)) return 'Social';
  return 'Referral';
}

// ------------------------------------------------------------------------------------------- reader

const n = (v: unknown) => Number(v ?? 0) || 0;

export class StatsReader {
  constructor(private readonly ch: ClickHouseClient) {}

  private run<T>(name: QueryName, params: Record<string, string | number>): Promise<T[]> {
    return this.ch.query<T>(QUERIES[name].replaceAll('{db}', this.ch.database), params);
  }

  private async totals(site: number, tz: string, from: string, to: string) {
    const p = bounds(site, tz, from, to);
    const [[ev], [se]] = await Promise.all([
      this.run<{ visitors: string; pageviews: string }>('visitors_pageviews', p),
      this.run<{ sessions: string; engaged_sessions: string }>('sessions_bounce', p),
    ]);
    const sessions = n(se?.sessions);
    return {
      visitors: n(ev?.visitors),
      pageviews: n(ev?.pageviews),
      sessions,
      bounceRate: sessions > 0 ? 1 - n(se?.engaged_sessions) / sessions : null,
    };
  }

  async overview(site: number, range: Range): Promise<Overview> {
    const p = bounds(site, range.tz, range.from, range.to);
    const [cur, prev, s1, s2, pages, sources, countries, devices, browsers, capture, drops] = await Promise.all([
      this.totals(site, range.tz, range.from, range.to),
      this.totals(site, range.tz, range.prev.from, range.prev.to),
      this.run<{ bucket: string; visitors: string; pageviews: string }>(range.hourly ? 'series_hourly' : 'series_daily', p),
      this.run<{ bucket: string; sessions: string }>(range.hourly ? 'series_hourly_sessions' : 'series_daily_sessions', p),
      this.run<{ pathname: string; pageviews: string }>('top_pages', p),
      this.run<{ source: string; sessions: string }>('sources', p),
      this.run<{ label: string; visitors: string }>('countries', p),
      this.run<{ label: string; visitors: string }>('devices', p),
      this.run<{ label: string; visitors: string }>('browsers', p),
      this.run<{ received: string; expected: string }>('capture_rate', p),
      this.run<{ reason: string; hits: string; detail: string; last: string }>('drops_by_reason', p),
    ]);

    // Every bucket of the range, also the empty ones (the chart must not skip a quiet day or hour).
    const byBucket = new Map(s1.map((r) => [r.bucket, r]));
    const sessionsBy = new Map(s2.map((r) => [r.bucket, n(r.sessions)]));
    const buckets: { bucket: string; label: string }[] = [];
    if (range.hourly) {
      const start = Date.parse(`${range.from}T00:00:00Z`) - 14 * 3_600_000;
      const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: range.tz, hour: '2-digit', minute: '2-digit', hour12: false });
      const seen = new Set<number>();
      // Walk UTC quarter-hours across the local day and keep each local hour start once (+5:30, +5:45 safe).
      for (let t = start; t < start + 52 * 3_600_000; t += 15 * 60_000) {
        const at = new Date(t);
        if (localDate(at, range.tz) !== range.from) continue;
        const [hh, mm] = fmt.format(at).split(':');
        if (mm !== '00') continue;
        const sec = t / 1000;
        if (seen.has(sec)) continue;
        seen.add(sec);
        buckets.push({ bucket: String(sec), label: `${hh}:00` });
      }
    } else {
      for (let i = 0; i < range.days; i++) {
        const d = addDays(range.from, i);
        const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${d}T12:00:00Z`));
        buckets.push({ bucket: d, label });
      }
    }
    const series = buckets.map(({ bucket, label }) => ({
      bucket,
      label,
      visitors: n(byBucket.get(bucket)?.visitors),
      pageviews: n(byBucket.get(bucket)?.pageviews),
      sessions: sessionsBy.get(bucket) ?? 0,
    }));

    const channels = new Map<string, number>();
    for (const s of sources) channels.set(channelOf(s.source), (channels.get(channelOf(s.source)) ?? 0) + n(s.sessions));
    const received = n(capture[0]?.received);
    const expected = n(capture[0]?.expected);
    const bars = (rows: { label: string; visitors: string }[]) => rows.map((r) => ({ label: r.label, value: n(r.visitors) }));

    return {
      range,
      kpis: { ...cur, visitorsEstimated: range.days > 1, previous: prev },
      series,
      sources: (['Direct', 'Search', 'Social', 'Referral'] as const).map((name) => ({ name, sessions: channels.get(name) ?? 0 })).filter((s) => s.sessions > 0),
      referrers: sources.filter((s) => s.source).slice(0, 8).map((s) => ({ label: s.source, value: n(s.sessions) })),
      pages: pages.map((r) => ({ label: r.pathname, value: n(r.pageviews) })),
      countries: bars(countries),
      devices: bars(devices),
      browsers: bars(browsers),
      capture: { received, expected, rate: expected > 0 ? received / expected : null },
      drops: drops.map((d) => ({ reason: d.reason, hits: n(d.hits), detail: d.detail, last: n(d.last) })),
    };
  }

  async live(site: number, now: Date): Promise<Live> {
    const p = { site, now: now.toISOString().replace('T', ' ').replace('Z', '') };
    const [[active], minutes, events] = await Promise.all([
      this.run<{ visitors: string }>('live_active', p),
      this.run<{ minute: string; visitors: string }>('live_minutes', p),
      this.run<{ name: string; pathname: string; country_code: string; at: string }>('live_events', p),
    ]);
    const byMinute = new Map(minutes.map((m) => [Number(m.minute), n(m.visitors)]));
    const last = Math.floor(now.getTime() / 60_000) * 60;
    return {
      now: now.getTime(),
      active: n(active?.visitors),
      minutes: Array.from({ length: 30 }, (_, i) => last - (29 - i) * 60).map((minute) => ({ minute: minute * 1000, visitors: byMinute.get(minute) ?? 0 })),
      events: events.map((e) => ({ name: e.name, path: e.pathname, country: e.country_code, at: n(e.at) })),
    };
  }

  async events(site: number, range: Range, now: Date): Promise<EventsReport> {
    const p = bounds(site, range.tz, range.from, range.to);
    const [rows, first, high] = await Promise.all([
      this.run<{ name: string; events: string; last: string }>('events_by_name', p),
      this.run<{ name: string; first: string }>('events_first_seen', { site }),
      this.run<{ name: string; key: string; distinct_values: string }>('high_cardinality_props', p),
    ]);
    const firstSeen = new Map(first.map((f) => [f.name, n(f.first)]));
    const week = now.getTime() - 7 * 86_400_000;
    return {
      range,
      events: rows.map((r) => {
        const f = firstSeen.get(r.name) ?? 0;
        const kind = AUTOMATIC_EVENTS.has(r.name) ? ('automatic' as const) : ('custom' as const);
        return { name: r.name, kind, events: n(r.events), last: n(r.last), firstSeen: f, isNew: kind === 'custom' && f >= week };
      }),
      highCardinality: high.map((h) => ({ name: h.name, key: h.key, distinctValues: n(h.distinct_values) })),
    };
  }

  async drops(site: number, range: Range): Promise<DropsReport> {
    const rows = await this.run<{ reason: string; detail: string; country_code: string; asn: string; hits: string; last: string }>(
      'drops_list',
      bounds(site, range.tz, range.from, range.to),
    );
    return { range, rows: rows.map((r) => ({ reason: r.reason, detail: r.detail, country: r.country_code, asn: n(r.asn), hits: n(r.hits), last: n(r.last) })) };
  }
}
