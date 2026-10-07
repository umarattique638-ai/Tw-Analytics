# Testing Stages 1–3 on your computer

Real systems, no mocks: **ClickHouse Cloud** (online) and **your local MongoDB** (the one you open in
MongoDB Compass). Cloudflare Workers, Queues, KV, R2 and Durable Objects run locally inside workerd
(Miniflare), exactly the runtime Cloudflare uses, so nothing is deployed and nothing is billed.

When every step below says OK, Stages 1, 2 and 3 are complete and frozen, and Stage 4 can start.

---

## 1. One-time setup

1. **Node 22+** and **pnpm 9**: install Node from nodejs.org, then in a terminal: `corepack enable`
2. Open a terminal **in the project folder** (the folder that has `package.json`, `apps`, `packages`).
3. `pnpm install`
4. Copy `.env.example` to `.env` (same folder) and fill it in:

| Variable | Where to get it |
|---|---|
| `TW_CH_URL` | ClickHouse Cloud console → your service → **Connect** → HTTPS. Looks like `https://abc123.il-central-1.aws.clickhouse.cloud:8443` |
| `TW_CH_USER` / `TW_CH_PASSWORD` | the `default` user and its password (it may create databases and users, which the tests need) |
| `TW_MONGO_URL` | the connection string you use in Compass, usually `mongodb://127.0.0.1:27017` (prefer `127.0.0.1` over `localhost`) |

`.env` is git-ignored. Never commit it and never paste it into a chat.

5. **ClickHouse Cloud checklist**
   - The service is **running**. An idle service wakes up on the first query; if the first command times
     out, run it again.
   - **Settings → IP Access List** contains your current IP (or "Anywhere" while testing). Without it
     every command fails with a connection error.
6. **MongoDB**: it is running if Compass can connect. Nothing to create by hand.

---

## 2. Create the databases (once)

```bash
pnpm db:check            # ClickHouse: can I connect? what is in the `tailwatch` database?
```
- `does not exist yet` → `pnpm db:clickhouse`
- `OLD schema from the first attempt` → `pnpm db:clickhouse:reset` (drops the old `tailwatch` database you
  already decided to delete, then creates schema v1). Nothing else on your service is touched.
- `schema v1 present` → nothing to do.

```bash
pnpm db:mongo            # MongoDB: creates tailwatch_control with validators, indexes, site-id counter
```
In **Compass** you now see the database `tailwatch_control` with `counters`, `memberships`, `sites`,
`tenants`, `users`. Click a collection → **Validation** tab (the rules) and **Indexes** tab.

---

## 3. The full check — one command

```bash
pnpm verify:stages
```

It runs these steps in order and stops at the first failure:

| # | Step | What it proves | You should see |
|---|---|---|---|
| 1 | `pnpm typecheck` | all TypeScript is consistent | no `error` lines |
| 2 | `pnpm test` | **Stage 1** contract (250 tests: 50 fixtures with exact outcomes, metrics, identity, URL rules, DDL and MongoDB-script checks) + collector and consumer unit tests | `Tests 250 passed`, `45 passed`, `71 passed` |
| 3 | `pnpm build` | both Workers bundle for Cloudflare | `Done` |
| 4 | `pnpm verify:mongo` | **Stage 1**: every MongoDB rule on YOUR server (a scratch database, dropped after) | 14 × `PASS`, then `OK: every control-plane rule holds` |
| 5 | `pnpm db:check` | ClickHouse Cloud reachable, schema v1 in place | `schema v1 present` |
| 6 | `pnpm e2e:collector` | **Stage 2** on workerd: all 50 fixtures return their exact code, never a 5xx, messages land in the Queue, latency | `Tests 5 passed` and a latency line |
| 7 | `pnpm live:consumer` | **Stage 3** on ClickHouse Cloud: exact rows, session metrics inside the database, rollup = GROUP BY, replay without duplicates | `Tests 6 passed` |
| 8 | `pnpm e2e:consumer` | **Stage 3 milestone**: HTTP → collector → Queue → consumer → R2 + Durable Object → ClickHouse Cloud | `first row visible in ClickHouse after … s` and `Tests 5 passed` |

Steps 7 and 8 create throwaway databases on your ClickHouse service (`tw_stage3_…`, `tw_e2e_…`) and a
throwaway user, and drop them at the end. Your `tailwatch` database is never touched by tests.

Expected timings: steps 1–5 a minute, 6–8 one to three minutes (Cloud round trips from your location).

---

## 4. See the data with your own eyes

Keep the test database instead of dropping it:

```bash
# macOS / Linux / Git Bash
TW_KEEP_TEST_DB=1 pnpm e2e:consumer
# Windows PowerShell
$env:TW_KEEP_TEST_DB="1"; pnpm e2e:consumer; Remove-Item Env:TW_KEEP_TEST_DB
```
The test prints the kept name, e.g. `tw_e2e_1791380000000`. In the ClickHouse Cloud **SQL console**:

```sql
SELECT name, pathname, utm_source, country_code, browser, visitor_hash, is_session_start
FROM tw_e2e_1791380000000.events ORDER BY timestamp;

SELECT reason, sum(hits) FROM tw_e2e_1791380000000.dropped_hits GROUP BY reason;   -- the warnings feed

SELECT sum(sign) AS sessions, sum(toInt64(pageviews) * sign) AS pageviews
FROM tw_e2e_1791380000000.sessions;

SELECT pathname, countMerge(pageviews) FROM tw_e2e_1791380000000.rollup_15m_pages GROUP BY pathname;

DROP DATABASE tw_e2e_1791380000000;   -- when you are done
```
There is no IP address in any table (that is invariant 12; the tests check it too).

---

## 5. When something fails

| Message | Fix |
|---|---|
| `cannot reach https://…clickhouse.cloud:8443` | service asleep (run again), wrong URL, or your IP is not in the IP Access List |
| `… Authentication failed …` | wrong `TW_CH_USER` / `TW_CH_PASSWORD` |
| `Refusing to apply on top of the old schema` | run `pnpm db:clickhouse:reset` |
| `cannot connect to mongodb://…` | start MongoDB; use the exact string from Compass in `TW_MONGO_URL` |
| `FAIL` lines in `verify:mongo` | copy the whole output into the next chat: that is a real schema finding |
| `NOTE: this MongoDB is a standalone server` | fine for Stages 1–4. Before Stage 5, make it a single-node replica set (the note says how) |
| `ExperimentalWarning: SQLite` | harmless (Node's built-in SQLite is used by one unit test) |
| `first row visible … after 12 s` and a failure | the Cloud service was waking up: run step 8 again |

---

## 6. Freeze

When `pnpm verify:stages` finishes without a failure:

```bash
git tag stage-1-frozen
git tag stage-2-done
git tag stage-3-done
git push origin main --tags
```

Then update the status board in `docs/PROJECT-NOTES.md` section 17 (tick "MongoDB real run") and start
Stage 4 (tracker). Stages 1–3 are not edited again except by the append-only rules in
`docs/contract/STAGE-1.md`.

Still open after this, by design (they need a real Cloudflare deploy, not a test):
the deployed collector's p99, the Free-plan CPU per consumer batch, and whether the Rate Limiting
binding exists on the Free plan. Deploy steps: `apps/consumer/README.md`, end of the file.
