-- The deleting ClickHouse user (Phase 3): retention pruning and account erasure, run by the API's nightly
-- maintenance job (GET /api/v1/internal/maintenance) and right after an account is deleted.
--
--   * SELECT on the four tables: the job counts what is older than a site's retention (or, for an erasure,
--     everything of the deleted sites) before it deletes, and verifies afterwards that nothing is left.
--   * ALTER DELETE on the same four tables: `ALTER TABLE ... DELETE WHERE site_id IN (...) [AND time < cutoff]`.
--     ClickHouse rewrites the affected parts in the background; afterwards the rows are physically gone.
--   * Nothing else: no INSERT, no DDL, no other database, no other ALTER.
--
-- Applied by `pnpm db:clickhouse:pruner` with TW_CH_PRUNE_PASSWORD from .env (never commit a password).
-- The API reads TW_CH_PRUNE_USER (default tw_prune) and TW_CH_PRUNE_PASSWORD.

CREATE USER IF NOT EXISTS tw_prune IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';

GRANT SELECT, ALTER DELETE ON tailwatch.events TO tw_prune;
GRANT SELECT, ALTER DELETE ON tailwatch.sessions TO tw_prune;
GRANT SELECT, ALTER DELETE ON tailwatch.dropped_hits TO tw_prune;
GRANT SELECT, ALTER DELETE ON tailwatch.rollup_15m_pages TO tw_prune;
