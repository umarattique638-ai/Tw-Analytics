# Dashboard queries

Generated from `apps/api/src/repositories/stats/queries.ts` (a test fails if this file and the code differ).
Every number on the dashboard comes from exactly one of these queries, so any of them can be
re-run by hand in the ClickHouse SQL console. Replace `{db}` with `tailwatch` and set the parameters first, e.g.:

```sql
SET param_site = 101, param_tz = 'Asia/Karachi', param_from = '2026-10-02 00:00:00', param_until = '2026-10-09 00:00:00';
SET param_now = '2026-10-08 10:00:00.000'; -- live queries: the current time in UTC
```

`from` / `until` are LOCAL midnights in the site's timezone (`until` = the day after the last day shown).
ClickHouse turns them into UTC instants with `toDateTime64(..., tz)`, so a DST day has 23 or 25 hours.
Metric definitions: PLAN section 5 and `packages/contract/src/metrics.ts`.

## visitors_pageviews

Dashboard KPIs: Visitors, Page views (and the same for the previous period, for the change %)

```sql
SELECT uniqExact(visitor_hash) AS visitors, countIf(name = 'pageview') AS pageviews, count() AS events
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String})
```

## sessions_bounce

Dashboard KPIs: Sessions, Bounce rate = 1 - engaged_sessions / sessions, Avg. visit time = engagement_ms / sessions

```sql
SELECT sum(sign) AS sessions, sum(is_engaged * sign) AS engaged_sessions, sum(engagement_ms * sign) AS engagement_ms
FROM {db}.sessions
WHERE site_id = {site:UInt64} AND start >= toDateTime64({from:String}, 3, {tz:String}) AND start < toDateTime64({until:String}, 3, {tz:String})
```

## series_daily

Visitors over time (7 / 30 days): visitors and page views per local day. Also the account export (whole stored history)

```sql
SELECT toString(toDate(timestamp, {tz:String})) AS bucket, uniqExact(visitor_hash) AS visitors, countIf(name = 'pageview') AS pageviews
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String})
GROUP BY bucket
```

## series_daily_sessions

Visitors over time (7 / 30 days): sessions per local day. Also the account export

```sql
SELECT toString(toDate(start, {tz:String})) AS bucket, sum(sign) AS sessions
FROM {db}.sessions
WHERE site_id = {site:UInt64} AND start >= toDateTime64({from:String}, 3, {tz:String}) AND start < toDateTime64({until:String}, 3, {tz:String})
GROUP BY bucket
```

## series_hourly

Visitors over time (Today): visitors and page views per local hour

```sql
SELECT toString(toUnixTimestamp(toStartOfHour(timestamp, {tz:String}))) AS bucket, uniqExact(visitor_hash) AS visitors, countIf(name = 'pageview') AS pageviews
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String})
GROUP BY bucket
```

## series_hourly_sessions

Visitors over time (Today): sessions per local hour

```sql
SELECT toString(toUnixTimestamp(toStartOfHour(start, {tz:String}))) AS bucket, sum(sign) AS sessions
FROM {db}.sessions
WHERE site_id = {site:UInt64} AND start >= toDateTime64({from:String}, 3, {tz:String}) AND start < toDateTime64({until:String}, 3, {tz:String})
GROUP BY bucket
```

## top_pages

Top pages (from the 15-minute rollup)

```sql
SELECT pathname, countMerge(pageviews) AS pageviews, uniqMerge(visitors) AS visitors
FROM {db}.rollup_15m_pages
WHERE site_id = {site:UInt64} AND bucket >= toDateTime({from:String}, {tz:String}) AND bucket < toDateTime({until:String}, {tz:String})
GROUP BY pathname
ORDER BY pageviews DESC, pathname
LIMIT 10
```

## top_pages_filtered

Top pages while the overview is filtered (raw events: the rollup has no country, device, ...)

```sql
SELECT pathname, count() AS pageviews, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND name = 'pageview'
GROUP BY pathname
ORDER BY pageviews DESC, pathname
LIMIT 10
```

## filter_values_page

Filter menu: pages of the period (search: q)

```sql
SELECT pathname AS value, count() AS n
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND name = 'pageview' AND pathname != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(pathname, {q:String}) > 0)
GROUP BY value
ORDER BY n DESC, value
LIMIT 100
```

## filter_values_country

Filter menu: countries of the period

```sql
SELECT country_code AS value, count() AS n
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND name = 'pageview' AND country_code != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(country_code, {q:String}) > 0)
GROUP BY value
ORDER BY n DESC, value
LIMIT 100
```

## filter_values_source

Filter menu: referrers of the period

```sql
SELECT referrer_source AS value, sum(sign) AS n
FROM {db}.sessions
WHERE site_id = {site:UInt64} AND start >= toDateTime64({from:String}, 3, {tz:String}) AND start < toDateTime64({until:String}, 3, {tz:String}) AND referrer_source != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(referrer_source, {q:String}) > 0)
GROUP BY value
HAVING n > 0
ORDER BY n DESC, value
LIMIT 100
```

## filter_values_device

Filter menu: devices of the period

```sql
SELECT device AS value, count() AS n
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND name = 'pageview' AND device != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(device, {q:String}) > 0)
GROUP BY value
ORDER BY n DESC, value
LIMIT 100
```

## filter_values_browser

Filter menu: browsers of the period

```sql
SELECT browser AS value, count() AS n
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND name = 'pageview' AND browser != '' AND ({q:String} = '' OR positionCaseInsensitiveUTF8(browser, {q:String}) > 0)
GROUP BY value
ORDER BY n DESC, value
LIMIT 100
```

## pages_all

Account export (Settings > Download your data): every page of a site over its stored history

```sql
SELECT pathname, countMerge(pageviews) AS pageviews, uniqMerge(visitors) AS visitors
FROM {db}.rollup_15m_pages
WHERE site_id = {site:UInt64} AND bucket >= toDateTime({from:String}, {tz:String}) AND bucket < toDateTime({until:String}, {tz:String})
GROUP BY pathname
ORDER BY pageviews DESC, pathname
LIMIT 1000
```

## sources

Traffic sources (grouped into Direct / Search / Social / Referral by apps/api/src/repositories/stats/channels.ts channelOf) and Top referrers

```sql
SELECT referrer_source AS source, sum(sign) AS sessions
FROM {db}.sessions
WHERE site_id = {site:UInt64} AND start >= toDateTime64({from:String}, 3, {tz:String}) AND start < toDateTime64({until:String}, 3, {tz:String})
GROUP BY source
HAVING sessions > 0
ORDER BY sessions DESC, source
LIMIT 50
```

## countries

Top locations

```sql
SELECT country_code AS label, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND name = 'pageview'
GROUP BY label
ORDER BY visitors DESC, label
LIMIT 8
```

## devices

Device breakdown

```sql
SELECT device AS label, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND name = 'pageview'
GROUP BY label
ORDER BY visitors DESC, label
LIMIT 8
```

## browsers

Browser breakdown

```sql
SELECT browser AS label, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND name = 'pageview'
GROUP BY label
ORDER BY visitors DESC, label
LIMIT 8
```

## capture_rate

Capture rate = received / expected

```sql
SELECT sum(c) AS received, sum((seq - prev) * m) AS expected
FROM
(
    SELECT visitor_hash, seq, c,
           lagInFrame(seq, 1, 0) OVER (PARTITION BY visitor_hash ORDER BY seq ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS prev,
           max(c) OVER (PARTITION BY visitor_hash ORDER BY seq DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS m
    FROM
    (
        SELECT visitor_hash, seq, count() AS c
        FROM {db}.events
        WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND seq > 0
        GROUP BY visitor_hash, seq
    )
)
```

## drops_by_reason

Dashboard warnings feed

```sql
SELECT reason, sum(hits) AS hits, any(detail) AS detail, toUnixTimestamp64Milli(max(at)) AS last
FROM {db}.dropped_hits
WHERE site_id = {site:UInt64} AND at >= toDateTime64({from:String}, 3, {tz:String}) AND at < toDateTime64({until:String}, 3, {tz:String})
GROUP BY reason
ORDER BY hits DESC
```

## drops_list

Suspicious activity page. Also the account export (the latest 200 groups)

```sql
SELECT reason, detail, country_code, asn, sum(hits) AS hits, toUnixTimestamp64Milli(max(at)) AS last
FROM {db}.dropped_hits
WHERE site_id = {site:UInt64} AND at >= toDateTime64({from:String}, 3, {tz:String}) AND at < toDateTime64({until:String}, 3, {tz:String})
GROUP BY reason, detail, country_code, asn
ORDER BY last DESC
LIMIT 200
```

## events_by_name

Events page: count and last seen per event name. Also the account export (whole stored history)

```sql
SELECT name, count() AS events, toUnixTimestamp64Milli(max(received_at)) AS last
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String})
GROUP BY name
ORDER BY events DESC, name
```

## events_first_seen

Events page: "New" = a custom event first seen in the last 7 days

```sql
SELECT name, toUnixTimestamp64Milli(min(timestamp)) AS first
FROM {db}.events
WHERE site_id = {site:UInt64}
GROUP BY name
```

## high_cardinality_props

Events page: high-cardinality property warning

```sql
SELECT name, key, uniqExact(value) AS distinct_values
FROM {db}.events
ARRAY JOIN mapKeys(props) AS key, mapValues(props) AS value
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String})
GROUP BY name, key
HAVING distinct_values > 100
ORDER BY distinct_values DESC
LIMIT 20
```

## live_active

Active now: distinct visitors in the current minute (the newest point of the Live visitors chart)

```sql
SELECT uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE site_id = {site:UInt64} AND received_at >= toStartOfMinute({now:DateTime64(3, 'UTC')}) AND received_at <= {now:DateTime64(3, 'UTC')}
```

## live_minutes

Live chart: visitors per minute, last 30 minutes

```sql
SELECT toString(toUnixTimestamp(toStartOfMinute(received_at))) AS minute, uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE site_id = {site:UInt64} AND received_at > {now:DateTime64(3, 'UTC')} - INTERVAL 30 MINUTE AND received_at <= {now:DateTime64(3, 'UTC')}
GROUP BY minute
```

## live_events

Latest hits: the newest 20 page views and events of the last 24 hours (engagement hits are left out: they only carry time on page)

```sql
SELECT name, pathname, country_code, toUnixTimestamp64Milli(received_at) AS at
FROM {db}.events
WHERE site_id = {site:UInt64} AND received_at > {now:DateTime64(3, 'UTC')} - INTERVAL 1 DAY AND received_at <= {now:DateTime64(3, 'UTC')} AND name != 'engagement'
ORDER BY received_at DESC
LIMIT 20
```

## Filters

A page, country, referrer, device or browser picked in the Filter menu filters the overview (decision 30). Each filter adds
one condition right after the range condition of these queries; set its parameter too, e.g.
`SET param_f_page = '/pricing'`. Capture rate and the warnings feed are never filtered.

Event queries: visitors_pageviews, series_daily, series_hourly, top_pages_filtered, countries, devices, browsers.
Session queries: sessions_bounce, series_daily_sessions, series_hourly_sessions, sources.

### page

```sql
-- events:   AND pathname = {f_page:String}
-- sessions: AND session_id IN (SELECT session_id FROM {db}.events WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND name = 'pageview' AND pathname = {f_page:String})
```

### country

```sql
-- events:   AND country_code = {f_country:String}
-- sessions: AND country_code = {f_country:String}
```

### source

```sql
-- events:   AND session_id IN (SELECT session_id FROM {db}.sessions WHERE site_id = {site:UInt64} AND start >= toDateTime64({from:String}, 3, {tz:String}) AND start < toDateTime64({until:String}, 3, {tz:String}) AND referrer_source = {f_source:String})
-- sessions: AND referrer_source = {f_source:String}
```

### device

```sql
-- events:   AND device = {f_device:String}
-- sessions: AND device = {f_device:String}
```

### browser

```sql
-- events:   AND browser = {f_browser:String}
-- sessions: AND browser = {f_browser:String}
```
