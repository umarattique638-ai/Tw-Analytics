# TailWatch Consumer (Stage 3, DONE 2026-10-07)

The Queue consumer Worker. It turns queued hits into ClickHouse rows, in the order fixed by PLAN 3.1.
Free Cloudflare features only (STAGE-1 D9): Queues, R2 and SQLite-backed Durable Objects.

## One batch, in this order (`src/process.ts`)

| Step | What | Where |
|---|---|---|
| (a) | archive the untransformed batch FIRST: `raw/{date}/{hour}/{batch token}.ndjson` | R2 `ARCHIVE` (a redelivery overwrites the same object) |
| (b) | classify; unreadable messages become `consumer_invalid` drops, never silent | memory |
| (c) | ONE load of session state + 7-day de-dup markers for the whole batch; duplicates are skipped | Durable Object `SESSIONS` |
| (d) | `INSERT INTO events` (one insert, explicit `insert_deduplication_token`) | ClickHouse |
| (e) | `INSERT INTO sessions` (−1 / +1 rows) and `INSERT INTO dropped_hits` | ClickHouse |
| (f) | rollups: the 15-minute materialized view fires inside ClickHouse | ClickHouse |
| (g) | commit session state + de-dup markers together, LAST, in one transaction per shard | Durable Object |

Any outage (R2, Durable Object, ClickHouse) throws, and the handler retries the whole batch with a
backoff (15 s, 30 s, 60 s … capped at 15 min). After `max_retries` the queue moves it to the DLQ.
Nothing in the log can carry request data: only counts and error codes (invariant 12).

## Session + de-dup store (`src/state/`) — STAGE-1 D4, D5

- `store.ts`: plain SQLite logic (tables `sessions`, `dedupe`, TTL columns, bounded sweeps). Runs in the
  Durable Object and, for tests, on `node:sqlite`.
- `object.ts`: the `SessionStateObject` Durable Object (JSON over fetch: `/load`, `/commit`; daily
  alarm sweeps expired rows). Declared with `new_sqlite_classes` in `wrangler.toml`.
- `port.ts`: the consumer side. Site `n` lives in shard `n % SESSION_SHARDS` (default 8), so a batch costs
  at most 16 Durable Object calls whatever the number of sites (Free plan: 50 subrequests per call).
- `memory.ts`: tests only. Production refuses to run without the Durable Object binding.

De-dup key: `i:{site}:{insertId}` when the tracker sent an insert id, else `m:{queue message id}`.
A tracker retry and a queue redelivery both collapse to one row.

## ClickHouse

Schema: `infra/clickhouse/001_contract.sql`. User and grants: `infra/clickhouse/002_insert_user.sql`
(INSERT on four tables + column-level SELECT the rollup view needs; nothing else). Two settings are on
every insert: `insert_deduplication_token` and `deduplicate_blocks_in_dependent_materialized_views=1`
(without the second a replayed batch is re-counted by the rollup: Amendment A1, found by the live test).

## Bindings (`wrangler.toml`)

`ARCHIVE` (R2 bucket `tailwatch-raw`) · `SESSIONS` (Durable Object) · vars `CLICKHOUSE_URL`,
`CLICKHOUSE_USER`, `CLICKHOUSE_DATABASE`, `SESSION_SHARDS` · secret `CLICKHOUSE_PASSWORD`.
`REQUIRE_ARCHIVE` is left unset: the archive is required (only the exact string `"false"` disables it).

## Tests

```bash
pnpm --filter @tailwatch/consumer test   # unit: order, batching, tokens, de-dup, sessions, drops, state store on SQLite
pnpm --filter @tailwatch/consumer live   # real ClickHouse (default http://127.0.0.1:8123): rows, metrics, rollup, replay
pnpm --filter @tailwatch/consumer e2e    # workerd: collector -> Queue -> consumer -> R2 + Durable Object -> ClickHouse
```

Stage 3 done-when, and where it is proven:

| Done-when | Proof |
|---|---|
| fixtures in → correct rows out | `test/live`: the 22 accepted wire fixtures are stored exactly as sent (every column) |
| (and the metrics are right in the database) | `test/live`: the session fixture gives 11 sessions, 5 engaged, 15 pageviews, 9 visitors **inside ClickHouse** |
| rollup MVs match a raw GROUP BY | `test/live` and `test/e2e`: equal, row for row |
| replaying the same batch twice produces no duplicates | `test/live` 4a (crash before commit: ClickHouse tokens) and 4b (after commit, regrouped: de-dup markers); `test/e2e`: a tracker retry gives one row |
| R2 holds the raw file | `test/e2e`: every queued message is in an R2 NDJSON object, without the IP |
| the milestone: "a curl producing a correct ClickHouse row" | `test/e2e`: one HTTP pageview is a correct row in ClickHouse in ~1.1 s (target 10 s) |

## Before the first real deploy

1. `wrangler r2 bucket create tailwatch-raw` (R2 is already activated on the account).
2. `wrangler queues create tailwatch-events` and `wrangler queues create tailwatch-events-dlq`.
3. Apply `infra/clickhouse/001_contract.sql`, then `002_insert_user.sql` with a real password.
4. Set `CLICKHOUSE_URL` in `wrangler.toml`, then `wrangler secret put CLICKHOUSE_PASSWORD`.
5. `wrangler deploy` (the Durable Object migration `v1` runs on the first deploy).
6. Measure CPU per batch on the Free plan (10 ms) and adjust `max_batch_size` if needed.
