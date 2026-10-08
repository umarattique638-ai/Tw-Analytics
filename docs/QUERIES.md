# Dashboard queries

Generated from `apps/api/src/stats.ts` (a test fails if this file and the code differ).
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

Dashboard KPIs: Sessions, Bounce rate = 1 - engaged_sessions / sessions

```sql
SELECT sum(sign) AS sessions, sum(is_engaged * sign) AS engaged_sessions
FROM {db}.sessions
WHERE site_id = {site:UInt64} AND start >= toDateTime64({from:String}, 3, {tz:String}) AND start < toDateTime64({until:String}, 3, {tz:String})
```

## series_daily

Visitors over time (7 / 30 days): visitors and page views per local day

```sql
SELECT toString(toDate(timestamp, {tz:String})) AS bucket, uniqExact(visitor_hash) AS visitors, countIf(name = 'pageview') AS pageviews
FROM {db}.events
WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String})
GROUP BY bucket
```

## series_daily_sessions

Visitors over time (7 / 30 days): sessions per local day

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

## sources

Traffic sources (grouped into Direct / Search / Social / Referral by apps/api/src/stats.ts channelOf) and Top referrers

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
SELECT sum(received) AS received, sum(expected) AS expected
FROM
(
    SELECT visitor_hash, load, uniqExact(seq) AS received, max(seq) AS expected
    FROM
    (
        SELECT visitor_hash, seq,
               sum(new_load) OVER (PARTITION BY visitor_hash ORDER BY timestamp, seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS load
        FROM
        (
            SELECT visitor_hash, seq, timestamp,
                   if(seq <= lagInFrame(seq, 1, 0) OVER (PARTITION BY visitor_hash ORDER BY timestamp, seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 1, 0) AS new_load
            FROM {db}.events
            WHERE site_id = {site:UInt64} AND timestamp >= toDateTime64({from:String}, 3, {tz:String}) AND timestamp < toDateTime64({until:String}, 3, {tz:String}) AND seq > 0
        )
    )
    GROUP BY visitor_hash, load
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

Suspicious activity page

```sql
SELECT reason, detail, country_code, asn, sum(hits) AS hits, toUnixTimestamp64Milli(max(at)) AS last
FROM {db}.dropped_hits
WHERE site_id = {site:UInt64} AND at >= toDateTime64({from:String}, 3, {tz:String}) AND at < toDateTime64({until:String}, 3, {tz:String})
GROUP BY reason, detail, country_code, asn
ORDER BY last DESC
LIMIT 200
```

## events_by_name

Events page: count and last seen per event name

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

Active visitors (last 5 minutes)

```sql
SELECT uniqExact(visitor_hash) AS visitors
FROM {db}.events
WHERE site_id = {site:UInt64} AND received_at > {now:DateTime64(3, 'UTC')} - INTERVAL 5 MINUTE AND received_at <= {now:DateTime64(3, 'UTC')}
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

Live events list

```sql
SELECT name, pathname, country_code, toUnixTimestamp64Milli(received_at) AS at
FROM {db}.events
WHERE site_id = {site:UInt64} AND received_at > {now:DateTime64(3, 'UTC')} - INTERVAL 1 DAY AND received_at <= {now:DateTime64(3, 'UTC')}
ORDER BY received_at DESC
LIMIT 20
```
