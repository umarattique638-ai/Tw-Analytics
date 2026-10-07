-- ClickHouse schema v1 (FROZEN with Stage 1 on 2026-10-07).
-- Shape adapted from Plausible's events_v2 / sessions_v2 as described in PLAN §2.1.
--
-- Rules:
--   * UTC everywhere. Site timezone is applied at query time from MongoDB sites.timezone.
--   * Never single-row INSERT. The consumer inserts batches and sets insert_deduplication_token explicitly.
--   * Do NOT put DEFAULT now() on event/session columns: implicit timestamps defeat block-level deduplication.
--   * non_replicated_deduplication_window: plain (self-hosted / local) MergeTree keeps NO insert
--     de-duplication history by default (window = 0), so insert_deduplication_token would silently do
--     nothing. ClickHouse Cloud tables are replicated and keep a window by default; the setting is harmless
--     there. Verified on ClickHouse 24.8 by apps/consumer/test/live (replay test).
--   * visitor_hash is the 64-bit anonymous hash produced by the contract identity function.
--   * raw IP is never stored here (the collector hashes it at the edge; STAGE-1 D1).
--   * Table TTL is a 425-day safety net. Shorter per-site retention is handled by pruning jobs (Phase 3).

CREATE DATABASE IF NOT EXISTS tailwatch;

CREATE TABLE IF NOT EXISTS tailwatch.events
(
    site_id             UInt64,
    insert_id           String,
    name                LowCardinality(String),
    timestamp           DateTime64(3, 'UTC'),
    received_at         DateTime64(3, 'UTC'),
    is_backfill         UInt8,
    hostname            LowCardinality(String),
    pathname            String,
    route               String,
    referrer            String,
    referrer_source     LowCardinality(String),
    utm_source          LowCardinality(String),
    utm_medium          LowCardinality(String),
    utm_campaign        String,
    utm_term            String,
    utm_content         String,
    country_code        LowCardinality(String),
    device              LowCardinality(String),
    browser             LowCardinality(String),
    browser_version     LowCardinality(String),
    os                  LowCardinality(String),
    os_version          LowCardinality(String),
    screen_width        UInt32,
    visitor_hash        UInt64,
    session_id          UInt64,
    seq                 UInt32,
    engagement_ms       UInt32,
    is_session_start    UInt8,
    is_first_visit      UInt8,
    tracker_version     UInt16,
    props               Map(String, String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (
    site_id,
    toDate(timestamp),
    name,
    visitor_hash,
    timestamp
)
TTL toDateTime(timestamp) + INTERVAL 425 DAY
SETTINGS non_replicated_deduplication_window = 1000;


-- Mutable session state is represented by a negative old version and positive new version.
-- version must monotonically increase for a given
-- (site_id, visitor_hash, session_id).
CREATE TABLE IF NOT EXISTS tailwatch.sessions
(
    site_id             UInt64,
    session_id          UInt64,
    visitor_hash        UInt64,
    start               DateTime64(3, 'UTC'),
    last_seen           DateTime64(3, 'UTC'),
    entry_path          String,
    exit_path           String,
    referrer_source     LowCardinality(String),
    utm_source          LowCardinality(String),
    country_code        LowCardinality(String),
    device              LowCardinality(String),
    browser             LowCardinality(String),
    os                  LowCardinality(String),
    pageviews           UInt32,
    custom_events       UInt32,
    engagement_ms       UInt32,
    is_engaged          UInt8,
    sign                Int8,
    version             UInt32
)
ENGINE = VersionedCollapsingMergeTree(sign, version)
PARTITION BY toYYYYMM(start)
ORDER BY (
    site_id,
    toDate(start),
    visitor_hash,
    session_id
)
TTL toDateTime(start) + INTERVAL 425 DAY
SETTINGS non_replicated_deduplication_window = 1000;


-- Drop-reason warnings feed (PLAN 2.4: "a dropped-at-the-consumer hit can still be counted, itemised
-- and shown to the customer"). Written from Stage 3 on: edge drops that can be attributed to a site,
-- and messages the consumer could not use (reason consumer_invalid). Same reason/minute collapse to one
-- row with hits = n.
CREATE TABLE IF NOT EXISTS tailwatch.dropped_hits
(
    site_id             UInt64,
    at                  DateTime64(3, 'UTC'),
    reason              LowCardinality(String),
    detail              String,
    country_code        LowCardinality(String),
    asn                 UInt32,
    hits                UInt32
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(at)
ORDER BY (site_id, at)
TTL toDateTime(at) + INTERVAL 425 DAY
SETTINGS non_replicated_deduplication_window = 1000;


-- 15-minute rather than hourly or daily buckets (STAGE-1 D3): every real-world UTC offset is a multiple
-- of 15 minutes (+5:30 India, +5:45 Nepal, +9:30 Adelaide), so a site's local day, including DST changes,
-- is always an exact union of buckets and can be re-bucketed at query time.
--
-- visitors uses uniq (an estimate). Exact single-day unique visitors are read from raw events with
-- uniqExact(visitor_hash); multi-day uniques are labelled "Estimated" (PLAN 5, STAGE-1 D6).
CREATE TABLE IF NOT EXISTS tailwatch.rollup_15m_pages
(
    site_id             UInt64,
    bucket              DateTime('UTC'),
    pathname            String,
    visitors            AggregateFunction(uniq, UInt64),
    pageviews           AggregateFunction(count),
    engagement_ms       AggregateFunction(sum, UInt32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(bucket)
ORDER BY (
    site_id,
    bucket,
    pathname
)
TTL bucket + INTERVAL 425 DAY;


CREATE MATERIALIZED VIEW IF NOT EXISTS tailwatch.rollup_15m_pages_mv
TO tailwatch.rollup_15m_pages AS
SELECT
    site_id,
    toStartOfFifteenMinutes(timestamp) AS bucket,
    pathname,
    uniqState(visitor_hash) AS visitors,
    countState() AS pageviews,
    sumState(engagement_ms) AS engagement_ms
FROM tailwatch.events
WHERE name = 'pageview'
GROUP BY
    site_id,
    bucket,
    pathname;


-- Read-side example (a local day in the site's timezone is [from, to) converted to UTC):
--
-- SELECT
--     pathname,
--     uniqMerge(visitors)  AS visitors_estimated,
--     countMerge(pageviews) AS pageviews
-- FROM tailwatch.rollup_15m_pages
-- WHERE site_id = {site:UInt64}
--   AND bucket >= {from:DateTime}
--   AND bucket <  {to:DateTime}
-- GROUP BY pathname
-- ORDER BY pageviews DESC
-- LIMIT 10;
