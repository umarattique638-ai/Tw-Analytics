-- The consumer's ClickHouse user (PROJECT-NOTES 16: never the `default` user from a Worker).
-- Least privilege, verified on ClickHouse 24.8 by apps/consumer/test/e2e (pipeline test):
--
--   * INSERT on the three tables the consumer writes, plus the rollup target the MV writes.
--   * Column-level SELECT on exactly the events columns the rollup MV reads: a materialized view runs
--     its SELECT with the INSERTING user's rights, so without this every events insert fails with
--     "Code: 497 ACCESS_DENIED ... necessary to have the grant SELECT(site_id, timestamp, ...)".
--   * Nothing else: no reads of sessions, drops or rollups, no DDL.
--
-- Run as an admin, replacing the password placeholder in your SQL console (never commit a password).
-- Then: wrangler secret put CLICKHOUSE_PASSWORD   (the consumer reads it as a secret, never a var).

CREATE USER IF NOT EXISTS tw_insert IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';

GRANT INSERT ON tailwatch.events TO tw_insert;
GRANT INSERT ON tailwatch.sessions TO tw_insert;
GRANT INSERT ON tailwatch.dropped_hits TO tw_insert;
GRANT INSERT ON tailwatch.rollup_15m_pages TO tw_insert;
GRANT SELECT(site_id, timestamp, pathname, visitor_hash, engagement_ms, name) ON tailwatch.events TO tw_insert;
