-- ClickHouse schema v1.
-- Shape adapted from Plausible's events_v2 / sessions_v2 as described in PLAN §2.1.
--
-- Rules:
--   * UTC everywhere. Site timezone is applied at query time from MongoDB sites.timezone.
--   * Never single-row INSERT. Consumer inserts batches and sets insert_deduplication_token explicitly.
--   * Do NOT put DEFAULT now() on event/session columns: implicit timestamps defeat block-level deduplication.
--   * visitor_hash is the 64-bit anonymous hash produced by the contract identity function.
--   * raw IP is never stored here.

CREATE DATABASE IF NOT EXISTS tailwatch;

CREATE TABLE IF NOT EXISTS tailwatch.events
(
    site_id             UInt64,
    insert_id            String,
    name                 LowCardinality(String),
    timestamp            DateTime64(3, 'UTC'),
    received_at          DateTime64(3, 'UTC'),
    is_backfill          UInt8,
    hostname             LowCardinality(String),
    pathname             String,
    route                String,
    referrer             String,
    referrer_source      LowCardinality(String),
    utm_source           LowCardinality(String),
    utm_medium           LowCardinality(String),
    utm_campaign         String,
    utm_term             String,
    utm_content          String,
    country_code         LowCardinality(String),
    device               LowCardinality(String),
    browser              LowCardinality(String),
    browser_version      LowCardinality(String),
    os                   LowCardinality(String),
    os_version           LowCardinality(String),
    screen_width         UInt32,
    visitor_hash         UInt64,
    session_id           UInt64,
    seq                  UInt32,
    engagement_ms        UInt32,
    is_session_start     UInt8,
    is_first_visit       UInt8,
    tracker_version      UInt16,
    props                Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (site_id, toDate(timestamp), name, visitor_hash, timestamp);

-- Mutable session state is represented by a negative old version and positive new version.
-- version must monotonically increase for a given (site_id, visitor_hash, session_id).
CREATE TABLE IF NOT EXISTS tailwatch.sessions
(
    site_id              UInt64,
    session_id           UInt64,
    visitor_hash         UInt64,
    start                DateTime64(3, 'UTC'),
    last_seen            DateTime64(3, 'UTC'),
    entry_path           String,
    exit_path            String,
    referrer_source      LowCardinality(String),
    utm_source           LowCardinality(String),
    country_code         LowCardinality(String),
    device               LowCardinality(String),
    browser              LowCardinality(String),
    os                   LowCardinality(String),
    pageviews            UInt32,
    custom_events        UInt32,
    engagement_ms        UInt32,
    is_engaged           UInt8,
    sign                 Int8,
    version              UInt32
)
ENGINE = VersionedCollapsingMergeTree(sign, version)
PARTITION BY toYYYYMM(start)
ORDER BY (site_id, toDate(start), visitor_hash, session_id);

-- Precision/debugging surface. This is populated by the consumer in the precision stage;
-- it is deliberately not part of the hot collector path.
CREATE TABLE IF NOT EXISTS tailwatch.dropped_hits
(
    site_id              UInt64,
    at                   DateTime64(3, 'UTC'),
    reason               LowCardinality(String),
    detail               String,
    country_code         LowCardinality(String),
    asn                  UInt32,
    hits                 UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(at)
ORDER BY (site_id, at);

-- Hourly rather than daily: reporting can be re-bucketed in any site timezone,
-- including DST transitions, at query time.
CREATE TABLE IF NOT EXISTS tailwatch.rollup_hourly_pages
(
    site_id              UInt64,
    hour                 DateTime('UTC'),
    pathname             String,
    visitors             AggregateFunction(uniq, UInt64),
    pageviews            AggregateFunction(count),
    engagement_ms        AggregateFunction(sum, UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (site_id, hour, pathname);

CREATE MATERIALIZED VIEW IF NOT EXISTS tailwatch.rollup_hourly_pages_mv
TO tailwatch.rollup_hourly_pages AS
SELECT
    site_id,
    toStartOfHour(timestamp) AS hour,
    pathname,
    uniqState(visitor_hash) AS visitors,
    countState() AS pageviews,
    sumState(engagement_ms) AS engagement_ms
FROM tailwatch.events
WHERE name = 'pageview'
  AND is_session_start IN (0, 1)
GROUP BY site_id, hour, pathname;

-- Read-side example:
--
-- SELECT
--     pathname,
--     uniqMerge(visitors),
--     countMerge(pageviews)
-- FROM tailwatch.rollup_hourly_pages
-- WHERE site_id = {site:UInt64}
--   AND hour >= {from:DateTime}
--   AND hour < {to:DateTime}
-- GROUP BY pathname
-- ORDER BY 3 DESC
-- LIMIT 10;
