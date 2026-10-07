# TailWatch Analytics

Cloud-only web analytics: one hosted collector, four install surfaces. Read in this order:

1. `docs/PROJECT-NOTES.md` - the working notes: rules, checklists, decisions, status board. Start here.
2. `docs/PLAN.md` - what we are building and why.
3. `docs/BUILD-ORDER.md` - where to start, in what order, what the customer experiences.
4. `docs/contract/STAGE-1.md` - the frozen contract and the decisions D1-D13 / amendments A1-A3.
5. `docs/TESTING.md` - how to test Stages 1-3 against ClickHouse Cloud and your local MongoDB.

Status (2026-10-07): Stage 1 frozen, Stage 2 (collector) and Stage 3 (consumer + storage) done and proven
end to end on the Workers runtime with a real ClickHouse. Cloudflare free features only.

Requires Node 22+ and pnpm 9 (`corepack enable`).

```
pnpm install
cp .env.example .env          # then fill in ClickHouse Cloud + local MongoDB (Windows: copy .env.example .env)
pnpm db:check                 # ClickHouse Cloud reachable? schema present?
pnpm db:clickhouse            # create schema v1 (or db:clickhouse:reset to replace the old first-attempt database)
pnpm db:mongo                 # create tailwatch_control in your local MongoDB (see it in Compass)
pnpm verify:stages            # every Stage 1-3 check, against the real databases (docs/TESTING.md)

pnpm --filter @tailwatch/collector dev   # wrangler dev, then open http://localhost:8787/health
```

| Path | What |
|---|---|
| `packages/contract` | wire v1, validator, identity, metrics, fixtures: the single definition everything imports |
| `apps/collector` | edge Worker `POST /e`, `GET /e.gif` (Stage 2) |
| `apps/consumer` | Queue consumer + `SessionStateObject` Durable Object (Stage 3) |
| `infra/` | ClickHouse DDL + insert user, MongoDB control-plane schema |
| `packages/core`, `packages/browser` | tracker draft from an earlier session, not yet reviewed (Stage 4) |
