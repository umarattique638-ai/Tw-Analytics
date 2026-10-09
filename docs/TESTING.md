# Testing Stages 1–6 on your computer

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
| `The Workers runtime failed to start` + `access violation` / `has overflowed its stack` (Windows) | install the latest **Microsoft Visual C++ Redistributable (x64)**: https://aka.ms/vs/17/release/vc_redist.x64.exe, **restart the computer**, then open a new terminal and run steps 6 and 8 again. If it still crashes, run them in WSL (Ubuntu) or rely on the GitHub CI `pipeline` job, which runs the same tests on Linux |
| a 19-digit `visitor_hash` differs only in the last digits | old copy of the tests: newer ClickHouse prints UInt64 unquoted in JSON and JavaScript rounds it. Fixed in the tests by `output_format_json_quote_64bit_integers=1` |

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


---

## 7. Stage 4 — the tracker (tw.js)

Every command says the folder it runs in. `ttw` = your project folder (`C:\Users\Umar\Downloads\ttw\ttw`).

### 7.1 Tests on your computer (nothing deployed)

```powershell
# folder: ttw
pnpm install
pnpm --filter @tailwatch/collector exec playwright-core install chromium   # once: a test Chromium (~150 MB, free)
pnpm --filter @tailwatch/browser build      # prints the tw.js size; FAILS over 3072 B gzip
pnpm --filter @tailwatch/core test          # engine: 23 tests
pnpm e2e:collector                          # collector fixtures + the tracker in a real Chromium
```

`e2e:collector` must end with `Test Files 2 passed`. The tracker file proves, in a real browser against
the collector on workerd: one first pageview, text/plain with no preflight, exactly one pageview per SPA
navigation (Navigation API and the fallback), hash routes, script loaded twice, consent unknown/granted/
denied, opt-out, the engagement beacon on leaving, back navigation, localhost skipped, and the demo page.

Instead of the download you can use your installed Chrome or Edge:
`$env:TW_CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'` (same terminal), then `pnpm e2e:collector`.

### 7.2 Deploy tw.js (the collector serves it)

```powershell
# folder: ttw
pnpm --filter @tailwatch/collector run deploy
```

The output must say `Read 2 files from the assets directory`. Check:
`https://tailwatch-collector.umarattique638.workers.dev/tw.js` opens a small JavaScript file in the browser.

### 7.3 A real page on a real domain

1. Deploy the demo site (static files only, free):
   ```powershell
   # folder: ttw\apps\demo
   npx wrangler deploy
   ```
   It prints `https://tailwatch-demo.umarattique638.workers.dev`.
2. Register it as a site (id 2) whose allowed host is that address:
   ```powershell
   # folder: ttw\apps\collector
   $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.ToCharArray()
   $key = 'tw_pub_' + (-join (1..32 | ForEach-Object { $chars | Get-Random }))
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
   $secret = ($b | ForEach-Object { $_.ToString('x2') }) -join ''
   @{ id = 2; publicKey = $key; allowedHosts = @('tailwatch-demo.umarattique638.workers.dev'); live = $true; region = 'in'; identitySecret = $secret } | ConvertTo-Json -Compress | Set-Content -Encoding ascii site.json
   npx wrangler kv key put "site:$key" --path site.json --namespace-id 0878a2b0f1c148148ec8dbe73cac767c --remote
   Remove-Item site.json
   $key
   ```
   The last line prints the key. It is a PUBLIC key (it sits in every page), so it is fine to keep it.
3. **Wait one minute** (KV propagation, STAGE-1 D8).
4. In Chrome open `https://tailwatch-demo.umarattique638.workers.dev/?key=` followed by the key.
   Click: **Pricing**, **Sort by price**, **Docs**, **Sign up**. Then switch to another tab for a moment.
5. After ~10 s, in the ClickHouse Cloud SQL console:
   ```sql
   SELECT timestamp, name, pathname, seq, engagement_ms, is_session_start, props
   FROM tailwatch.events WHERE site_id = 2 ORDER BY timestamp;
   ```
   Expected: `pageview /` (seq 1, session start), `pageview /pricing`, `pageview /docs`, `signup /docs`
   with `{'plan':'pro'}`, and an `engagement` row with engagement_ms > 0 when you switched tabs.
   **No** row for "Sort by price" (same page, only a filter changed).

If no rows: an ad blocker may block the collector (that is the "beacon blocked" case PLAN 7 talks
about; try a window without extensions), or the minute in step 3 was not over.

### 7.4 Framework apps (Stage 4 done-when)

```powershell
# folder: ttw
pnpm e2e:frameworks
```

This starts three real dev servers one after another, each with React StrictMode / dev mode on:
`examples/next-app` (Next.js App Router), `examples/vite-react` (Vite + React Router) and
`examples/vue-hash` (Vue + hash router). Chromium opens each one as `http://<name>.localhost:<port>` and walks
Home → About → Blog → Sign up → Back. Each app must record exactly 4 pageviews (only the first one flagged
first) + 1 signup, sequence 1-5, no errors. Next.js runs the walk twice: once with the browser's
Navigation API, once without it (the older-browser path). Expected: `Tests 3 passed`. The first run takes
1-2 minutes while Next compiles.

To try an app by hand (folder: `ttw\examples\vite-react`): `pnpm dev`, then open the printed address.
Without `VITE_TW_KEY` / `VITE_TW_API` it renders but sends nothing.


---

## 8. Stage 5 — sign up, add a site, install, verify (the API + dashboard)

`ttw` = `C:\Users\Umar\Downloads\ttw\ttw`. Every command says its folder.

### 8.1 One-time setup

1. **MongoDB replica set** (done 2026-10-08): `mongod.cfg` has `replication: replSetName: rs0`,
   `rs.initiate(...)` ran once, and `.env` has `TW_MONGO_URL=mongodb://localhost:27017/?replicaSet=rs0`.
2. **Schema update** (adds `sessions` and `users.name`, STAGE-1 A5):
   ```powershell
   # folder: ttw
   pnpm db:mongo
   pnpm verify:mongo      # 16 PASS (2 new session checks), "transactions available"
   ```
3. **ClickHouse read-only user** for the first-pageview check: put a new strong password in `.env` as
   `TW_CH_READ_PASSWORD=` (12+ chars, upper, lower, digit, special), then
   ```powershell
   # folder: ttw
   pnpm db:clickhouse:reader
   ```
4. **Cloudflare API token** (free) so the API can write sites into the collector's KV:
   Cloudflare dashboard → top right profile → **My Profile** → **API Tokens** → **Create Token** →
   **Create Custom Token** → name `tailwatch-api-kv` → Permissions: **Account | Workers KV Storage | Edit**
   → Account Resources: your account → **Continue to summary** → **Create Token** → copy it (shown once).
   In `.env`:
   ```
   TW_COLLECTOR_URL=https://tailwatch-collector.umarattique638.workers.dev
   CF_ACCOUNT_ID=a4f0ab5a55729cc4acfc9cb056904a95
   CF_KV_NAMESPACE_ID=0878a2b0f1c148148ec8dbe73cac767c
   CF_API_TOKEN=<the token>
   ```
   Never paste the token in chat.

### 8.2 Tests

```powershell
# folder: ttw
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm live:api      # the API on YOUR MongoDB (scratch database, dropped after): 7 passed
pnpm e2e:api       # signup -> site -> snippet -> verify -> first pageview, in Chromium: 2 passed
```

### 8.3 The real thing (BUILD-ORDER Stage 5 done-when)

1. Start the API + dashboard:
   ```powershell
   # folder: ttw
   pnpm app
   ```
   It prints `TailWatch API + dashboard: http://localhost:8788` and no WARNING lines. Keep it running.
2. Open http://localhost:8788 → **Sign up** (any e-mail) → **Add your site**:
   domain `tailwatch-demo.umarattique638.workers.dev`, timezone `Asia/Karachi` → **Add site**.
3. **Install** step → Script tag → **Copy**.
4. Be the customer: open `apps\demo\public\shop\index.html`, paste the snippet on the empty line between
   `<!-- TAILWATCH SNIPPET START -->` and `<!-- TAILWATCH SNIPPET END -->`, save, then
   ```powershell
   # folder: ttw\apps\demo
   npx wrangler deploy
   ```
5. Back in the dashboard → **I added it** → Page to check:
   `https://tailwatch-demo.umarattique638.workers.dev/shop/` → **Run check**: 7 green ticks.
6. Wait one minute (KV, STAGE-1 D8), then open `https://tailwatch-demo.umarattique638.workers.dev/shop/` in an
   Incognito window. Within ~10 s the verify screen says **First pageview received**.
7. **Finish and go to dashboard.** Nobody touched a database: that is Stage 5 done.

If something is off: `pnpm --filter @tailwatch/api resync` rewrites every site's KV entry from MongoDB.


---

## 9. Stage 6 — the dashboard on real data

```powershell
# folder: ttw
pnpm install
pnpm --filter @tailwatch/api test   # includes: docs/QUERIES.md equals the code
pnpm live:api                        # MongoDB 7 + Query API on YOUR ClickHouse Cloud with known rows (DST too): 17 passed
pnpm e2e:api                         # onboarding + dashboard pages in Chromium: 3 passed
pnpm app                             # http://localhost:8788
```

`live:api` creates a scratch database `tw_stats_<number>` in ClickHouse Cloud, inserts known events,
checks every dashboard number against hand-computed values, and drops it again.

Then open the dashboard. Every number is real (Live traffic, Events, Suspicious activity, Reports → Export CSV).
To check any number yourself, copy its query from `docs/QUERIES.md` into the ClickHouse SQL console.

## 10. Stage 7 — precision (bots)

```powershell
# folder: ttw
pnpm install
pnpm lists:check          # the bot / spam / ASN modules match infra/lists
pnpm --filter @tailwatch/consumer test   # includes the labelled corpus: 0 false positives, 0 misses
pnpm e2e:precision        # ⭐ Plausible's Puppeteer test on YOUR ClickHouse Cloud: "TailWatch counted 0 of 95"
```

`e2e:precision` runs 95 real Puppeteer sessions (+10 stealth) through tw.js → collector → queue → consumer
→ a scratch database `tw_p95_<number>` in ClickHouse Cloud, prints a table of what was dropped and why,
and drops the database again. It needs the Chromium from Stage 4 (`playwright-core install chromium`).

### Live, against your real demo site

Deploy the new consumer FIRST, then the collector (the collector serves the new tw.js v3):

```powershell
# folder: ttw\apps\consumer
pnpm exec wrangler deploy
# folder: ttw\apps\collector
pnpm run deploy
# folder: ttw   (do not open the demo site yourself while this runs)
pnpm bots:live
```

`bots:live` sends 95 Puppeteer sessions from your PC to the demo site (site 101), waits for the
pipeline, then asks ClickHouse (read-only user) what was counted. PASS = `TailWatch counted 0 of 95`.
The drops then show up, itemised, on the dashboard's **Suspicious activity** page.

### Updating the lists (every few weeks)

```powershell
# folder: ttw
pnpm lists:update   # prints what was added/removed upstream — READ IT (a new ASN that is a home ISP? add it to infra/lists/asn-overrides.json "never")
pnpm --filter @tailwatch/consumer test
```

## 11. The dashboard online (Render free + MongoDB Atlas free)

What goes online: the API + dashboard (one Node service on Render) and the control-plane database
(MongoDB Atlas). Collector, consumer, queue, KV, R2 and ClickHouse are already online and do not change.

**A. MongoDB Atlas (free M0)**
1. https://www.mongodb.com/cloud/atlas/register → sign up → create a **Free (M0)** cluster
   (provider AWS, region **Frankfurt eu-central-1** or **Bahrain me-south-1**).
2. *Database Access* → **Add New Database User** → `tw_app`, a long generated password,
   role **Read and write to any database** (simplest; later: readWrite on `tailwatch_control` only).
3. *Network Access* → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`).
   Render's free servers have no fixed address, so this is needed; the long password protects it.
4. *Clusters* → **Connect** → **Drivers** → copy the `mongodb+srv://tw_app:<password>@...` string,
   put the password in, add the database name: `...mongodb.net/tailwatch_control?retryWrites=true&w=majority`.

**B. Copy your accounts and sites to Atlas (folder `ttw`)**
Put the Atlas string in the root `.env` as `TW_MONGO_TARGET_URL="mongodb+srv://..."`, then:
```powershell
pnpm db:mongo:copy
```
It applies the schema on Atlas, then copies accounts, workspaces, sites (with their keys, so site 101 stays
101 and keeps its ClickHouse data) and the site-id counter. Optional proof on Atlas:
`$env:TW_MONGO_URL = "<atlas string>"; pnpm verify:mongo` (needs an Atlas user with admin rights).

**C. Vercel (free Hobby plan, no card) — the way we use**
1. https://vercel.com/signup → **Continue with GitHub** → Hobby.
2. **Add New → Project** → import the GitHub repo. Framework Preset: **Other**. Leave Root Directory,
   Build and Install commands empty: `vercel.json` sets them.
3. **Environment Variables** (Production): `TW_MONGO_URL` (Atlas, user tw_app), `TW_SIGNUP_ALLOWLIST`
   (your e-mail), `TW_COLLECTOR_URL`, `TW_REGION=in`, `CF_ACCOUNT_ID`, `CF_KV_NAMESPACE_ID`,
   `CF_API_TOKEN`, `TW_CH_URL`, `TW_CH_READ_USER=tw_read`, `TW_CH_READ_PASSWORD`.
4. **Deploy**. Your dashboard: `https://<project>.vercel.app`. Every `git push` deploys again.

How it runs: `pnpm --filter @tailwatch/api build:vercel` writes `.vercel/output` (Build Output API):
the dashboard as static files on Vercel's CDN, and the API (`apps/api/src/vercel.ts`, same createApp and
rules as `pnpm app`) as one Node 22 function behind `/api/*`. Settings rules are shared in
`apps/api/src/runtime.ts`.

**C2. Render (free, but asks for a card)**
1. Push `ttw` to GitHub (it contains `render.yaml`).
2. https://render.com → sign in with GitHub → **New → Blueprint** → choose the repo.
3. Render asks for the secret values once: `TW_MONGO_URL` (the Atlas string), `TW_SIGNUP_ALLOWLIST`
   (your e-mail), `CF_API_TOKEN`, `TW_CH_URL`, `TW_CH_READ_PASSWORD` (same as in your `.env`).
4. **Apply**. The first build takes a few minutes. Your dashboard: `https://tailwatch-xxxx.onrender.com`.

Free plan: the service sleeps after 15 minutes without visits and the first visit then takes about a
minute. Data collection is not affected (that is Cloudflare). A public server refuses to start without
`TW_SIGNUP_ALLOWLIST`, so nobody else can create an account until Phase 3.
