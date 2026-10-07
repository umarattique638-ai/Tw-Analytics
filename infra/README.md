# infra/

Stage 1 contract artifacts (frozen 2026-10-07, see docs/contract/STAGE-1.md):

- `clickhouse/001_contract.sql` — ClickHouse events, sessions, dropped_hits, 15-minute rollup + MV.
- `clickhouse/002_insert_user.sql` — the consumer's least-privilege user (Amendment A2). Run as admin,
  with a real password typed in the console, never committed.
- `mongodb/001_control_plane.js` — MongoDB control-plane collections, validators and indexes.
- `mongodb/control-plane.schema.json` — reviewable JSON Schema; a test keeps it identical to the script.

MongoDB is the TailWatch control plane (Stage 5 onwards). ClickHouse is the analytics event store.
The edge collector touches neither. Session state lives in Cloudflare Durable Objects (STAGE-1 D4), not here.

The MongoDB script assumes a replica set because Stage 5 signup/site provisioning uses transactions.
For local development, use a single-node replica set; Atlas M0 (free) is a replica set.

How they are tested:
- ClickHouse DDL + grants: applied to a real ClickHouse by `apps/consumer/test/live` and `test/e2e`.
- MongoDB script: executed against a recording fake by `packages/contract/test/infra.test.ts`.
  One run on a real replica set is still VERIFY (STAGE-1 section 10).

Tools (read the root .env, see .env.example):
- `pnpm db:check`, `pnpm db:clickhouse`, `pnpm db:clickhouse:reset`, `pnpm db:clickhouse:user` → `tools/clickhouse.mjs`
- `pnpm db:mongo`, `pnpm verify:mongo` → `tools/mongo.mjs` (applies control-plane.schema.json, the same
  validators and indexes as the mongosh script; `verify` proves every rule on the real server)
