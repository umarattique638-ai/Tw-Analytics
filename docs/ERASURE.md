# Data subject requests: export, erasure, retention (runbook)

PLAN 9.2 Phase 3 lists "DSAR + erasure + export runbook". This is it. Decision 19 in PROJECT-NOTES has the why.

## What TailWatch stores about a person

| Where | What | Personal? |
|---|---|---|
| MongoDB `users` | name, e-mail, password hash | yes: the customer |
| MongoDB `audit_log` | who changed what in a workspace (user id + name), no IP, no user agent | yes: the customer |
| MongoDB `sessions`, `password_resets` | SHA-256 of tokens | linked to the customer |
| ClickHouse `events`, `sessions`, ... | pages, referrers, country, device, a visitor hash that changes every day | no identifier of a website visitor (no IP, no cookie id) |
| R2 `tailwatch-raw` (raw/, dlq/, dlq-dead/) | the raw incoming events, before processing | same as above |

A website VISITOR who asks "delete my data" usually has nothing that can be found: we store no IP and the
visitor hash rotates daily with a per-site secret. Answer with that, in writing. A CUSTOMER (site owner)
can do everything below themselves.

## Export (Art 15 / 20)

Dashboard > Settings > **Download all data**: one JSON file (`GET /api/v1/account/export`). Contains the
account, every site (deleted ones too), per-day numbers over the whole stored history, the 1,000 top
pages, events, blocked traffic, the list of saved reports and the activity log. Never the sites' identity
secrets.

## Erasure (Art 17)

Dashboard > Settings > **Delete account** (owner, password, type DELETE). What happens:

1. At once, in one MongoDB transaction: user(s), workspace, memberships, sites, reports, activity log,
   login sessions, reset links and KV-outbox entries are deleted; an `erasures` record is created.
2. At once (retried nightly): every key of every site is removed from Cloudflare KV, so the collector
   refuses new hits; the ClickHouse rows of the sites get `ALTER TABLE ... DELETE`.
3. Nightly (`/api/v1/internal/maintenance`): the KV keys are deleted again, sites created by a request
   that raced the deletion are found and erased too, the rows are counted again and deletes re-sent if
   needed. The erasure is complete when a count finds nothing at least 2 days after the request. Then the
   customer gets a last e-mail and the e-mail address is removed from the record.
   For 30 more days the same nightly checks run (late events are deleted and counted in
   `rowsAfterCompletion`).
4. Raw copies in R2 expire within 30 days (lifecycle rules below). Durable Object state expires on its
   own (30 minutes / 7 days). ClickHouse Cloud backups age out on the service's own backup schedule.

Check an erasure by hand (MongoDB Compass, database `tailwatch_control`, collection `erasures`):
`status: "completed"`, `rowsFound` = what was there, `lastError` = why it is still waiting.
`lastError` mentioning `TW_CH_PRUNE_PASSWORD` = the ClickHouse delete user is not set on Vercel.

## Retention (Art 5(1)(e))

Each site keeps data 30, 90, 180 or 395 days (Settings > Data retention; default 395, owner/admin only).
The same nightly maintenance run deletes older rows in weekly batches (as soon as some rows are 6 days
past the retention, everything past it goes in one delete), so data is gone at most 7 days after its
retention, and writes "Removed data of ... older than N days" into the workspace's activity log. The
ClickHouse table TTL (425 days) is only a safety net.

## One-time setup (owner)

1. ClickHouse user (repo root, needs the admin `TW_CH_USER` / `TW_CH_PASSWORD` and a new
   `TW_CH_PRUNE_PASSWORD` in `.env`): `pnpm db:clickhouse:pruner`
2. Vercel > Settings > Environment Variables: `TW_CH_PRUNE_USER=tw_prune`, `TW_CH_PRUNE_PASSWORD=...`
   (and `CRON_SECRET`, already there for the KV reconcile). Redeploy.
3. MongoDB validators for the new collections (optional, needs an admin user): `pnpm db:mongo`
4. R2 lifecycle (in `apps/consumer`):
   ```
   pnpm exec wrangler r2 bucket lifecycle add tailwatch-raw raw-30-days raw/ --expire-days 30 --force
   pnpm exec wrangler r2 bucket lifecycle add tailwatch-raw dlq-30-days dlq/ --expire-days 30 --force
   pnpm exec wrangler r2 bucket lifecycle add tailwatch-raw dlq-dead-30-days dlq-dead/ --expire-days 30 --force
   ```
