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

  sessions_bounce: `SELECT sum(sign) AS sessions, sum(is_engaged * sign) AS engaged_sessions, sum(engagement_ms * sign) AS engagement_ms
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

  // The same list from raw events, for a filtered overview (the rollup has no country, device, ...).
  top_pages_filtered: `SELECT pathname, count() AS pageviews, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE ${IN_RANGE('timestamp')} AND name = 'pageview'
GROUP BY pathname
ORDER BY pageviews DESC, pathname
LIMIT 10`,

  // The Filter menu (decision 30): the values a filter can take in the period, most used first, optionally
  // narrowed by a search ({q:String}, case-insensitive, '' = everything).
  filter_values_page: `SELECT pathname AS value, count() AS n
FROM {db}.events
WHERE ${IN_RANGE('timestamp')} AND name = 'pageview' AND pathname != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(pathname, {q:String}) > 0)
GROUP BY value
ORDER BY n DESC, value
LIMIT 100`,

  filter_values_country: `SELECT country_code AS value, count() AS n
FROM {db}.events
WHERE ${IN_RANGE('timestamp')} AND name = 'pageview' AND country_code != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(country_code, {q:String}) > 0)
GROUP BY value
ORDER BY n DESC, value
LIMIT 100`,

  filter_values_source: `SELECT referrer_source AS value, sum(sign) AS n
FROM {db}.sessions
WHERE ${IN_RANGE('start')} AND referrer_source != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(referrer_source, {q:String}) > 0)
GROUP BY value
HAVING n > 0
ORDER BY n DESC, value
LIMIT 100`,

  filter_values_device: `SELECT device AS value, count() AS n
FROM {db}.events
WHERE ${IN_RANGE('timestamp')} AND name = 'pageview' AND device != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(device, {q:String}) > 0)
GROUP BY value
ORDER BY n DESC, value
LIMIT 100`,

  filter_values_browser: `SELECT browser AS value, count() AS n
FROM {db}.events
WHERE ${IN_RANGE('timestamp')} AND name = 'pageview' AND browser != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(browser, {q:String}) > 0)
GROUP BY value
ORDER BY n DESC, value
LIMIT 100`,

  pages_all: `SELECT pathname, countMerge(pageviews) AS pageviews, uniqMerge(visitors) AS visitors
FROM {db}.rollup_15m_pages
WHERE site_id = {site:UInt64} AND bucket >= toDateTime({from:String}, {tz:String}) AND bucket < toDateTime({until:String}, {tz:String})
GROUP BY pathname
ORDER BY pageviews DESC, pathname
LIMIT 1000`,

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
WHERE site_id = {site:UInt64} AND received_at >= toStartOfMinute({now:DateTime64(3, 'UTC')}) AND received_at <= {now:DateTime64(3, 'UTC')}`,

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

/**
 * Overview filters (decision 30): a page, country, referrer, device or browser picked in the dashboard's
 * Filter menu narrows the whole overview to it. Each filter adds one condition after the range condition of a query; the value is always
 * a ClickHouse parameter ({f_page:String}, ...), never pasted into the SQL. Several filters: all of them.
 *
 * Event queries (visitors, page views, charts, lists) and session queries (sessions, bounce, time on
 * site, sources) each get their own form. "Page" counts, for events, the hits ON that page, and for
 * sessions, the visits that viewed it. A referrer is stored on the session (only a visit's first hit
 * carries it), so the event form asks the sessions table.
 */
export const FILTER_KEYS = ['page', 'country', 'source', 'device', 'browser'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];
export type Filters = Partial<Record<FilterKey, string>>;

export const EVENT_FILTERS: Record<FilterKey, string> = {
  page: 'pathname = {f_page:String}',
  country: 'country_code = {f_country:String}',
  source: `session_id IN (SELECT session_id FROM {db}.sessions WHERE ${IN_RANGE('start')} AND referrer_source = {f_source:String})`,
  device: 'device = {f_device:String}',
  browser: 'browser = {f_browser:String}',
};

export const SESSION_FILTERS: Record<FilterKey, string> = {
  page: `session_id IN (SELECT session_id FROM {db}.events WHERE ${IN_RANGE('timestamp')} AND name = 'pageview' AND pathname = {f_page:String})`,
  country: 'country_code = {f_country:String}',
  source: 'referrer_source = {f_source:String}',
  device: 'device = {f_device:String}',
  browser: 'browser = {f_browser:String}',
};

/** The overview queries that take filters, and which table each reads. Capture rate and warnings never do. */
export const FILTERABLE: Partial<Record<QueryName, 'events' | 'sessions'>> = {
  visitors_pageviews: 'events',
  sessions_bounce: 'sessions',
  series_daily: 'events',
  series_daily_sessions: 'sessions',
  series_hourly: 'events',
  series_hourly_sessions: 'sessions',
  top_pages_filtered: 'events',
  sources: 'sessions',
  countries: 'events',
  devices: 'events',
  browsers: 'events',
};

/** Only the filters that are set (an empty value is no filter). */
export const activeFilters = (f: Filters = {}): [FilterKey, string][] =>
  FILTER_KEYS.filter((k) => typeof f[k] === 'string' && f[k] !== '').map((k) => [k, f[k]!]);

/** A query with its filter conditions, and the parameters they need. Unfilterable or unfiltered: unchanged. */
export function filtered(name: QueryName, filters: Filters = {}): { sql: string; params: Record<string, string> } {
  const table = FILTERABLE[name];
  const active = activeFilters(filters);
  if (!table || active.length === 0) return { sql: QUERIES[name], params: {} };
  const range = IN_RANGE(table === 'events' ? 'timestamp' : 'start');
  const forms = table === 'events' ? EVENT_FILTERS : SESSION_FILTERS;
  const extra = active.map(([k]) => ` AND ${forms[k]}`).join('');
  return { sql: QUERIES[name].replace(range, range + extra), params: Object.fromEntries(active.map(([k, v]) => [`f_${k}`, v])) };
}
