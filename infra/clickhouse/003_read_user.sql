-- The control-plane API's ClickHouse user (Stage 5: the verifier's "first pageview" and drop checks;
-- Stage 6: the dashboard Query API). Read-only, on the tailwatch tables only.
--
--   * SELECT on the four tables. No INSERT, no DDL, no other database.
--   * readonly = 2: may not write or change the schema, may still set per-query settings
--     (output_format_json_quote_64bit_integers, select_sequential_consistency).
--
-- Applied by `pnpm db:clickhouse:reader` with TW_CH_READ_PASSWORD from .env (never commit a password).

CREATE USER IF NOT EXISTS tw_read IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD' SETTINGS readonly = 2;

GRANT SELECT ON tailwatch.events TO tw_read;
GRANT SELECT ON tailwatch.sessions TO tw_read;
GRANT SELECT ON tailwatch.dropped_hits TO tw_read;
GRANT SELECT ON tailwatch.rollup_15m_pages TO tw_read;
