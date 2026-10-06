# Build order & end-to-end flow

**Companion to [PLAN.md](PLAN.md).** The plan says *what* we're building. This says **where to start,
in what order, and what the customer actually experiences.**

Markers: ✅ verified in [research/](research/) · ▶ judgment call · ⚠️ needs verification

---

# PART 1 — The customer journey

What a user does, step by step, and what happens behind each step.

```
  ①            ②              ③              ④            ⑤          ⑥
 Sign   →   Add site   →   Choose      →   Install   →   Verify  →  Data
  up        (domain)      install way      snippet       works      flows
```

### ① Sign up
Email + password (or OAuth). Creates a **tenant** document in MongoDB. No analytics infrastructure is
touched yet.

### ② Add a site — this is the "register domain" step
They type `example.com`. We do **not** touch DNS. What happens:

```
MongoDB:  insert a site document (_id, tenantId, domain, timezone, keys[])
          _id is the numeric site ID allocated by the counters collection; keys[0].publicKey = 'tw_pub_' + 32 random chars
Workers KV: PUT site:tw_pub_xxx = {domain, allowed_hosts[], flags, plan, region}
```

▶ Two things to get right here:
- **Ask for the timezone at creation.** ✅ Day-boundary handling is a classic retrofit nightmare; the
  site's timezone must exist before the first event is stored.
- **Derive `allowed_hosts` generously** — `example.com`, `www.example.com`, and by default all
  subdomains. Otherwise the first thing every customer hits is "why is nothing tracked on www?"

⚠️ **No DNS work at all in the normal path.** DNS only appears if they later opt into the CNAME option
(PLAN §7 Tier 2.2, Phase 9) — and that's a paid convenience, not the default.

### ③ Choose an install method
The dashboard shows the decision tree from PLAN §7.1 and generates the exact snippet:

**Script tag** (default, works anywhere):
```html
<script async fetchpriority="low"
        src="https://cdn.tailwatch.com/tw.js?id=tw_pub_xxx"></script>
```

**npm** (if they have a build step):
```bash
npm i @tailwatch/browser
```
```js
import { init } from '@tailwatch/browser'
init({ site: 'tw_pub_xxx' })
```

**Framework** — copy-paste block per framework, with `autoPageview: false` pre-set where the router
already fires on mount (✅ SvelteKit `afterNavigate`, Astro `astro:page-load`).

**WordPress** — install plugin → paste key → connect. ⚠️ Per PLAN §12 decision 2, the plugin sends
**nothing** until this connect step completes (wp.org Guideline 7).

### ④ Install
Customer's job. We show a live "waiting for your first pageview…" state.

### ⑤ Verify — build this, don't skip it
✅ Plausible has a `:verification_agent` drop reason in its ingest pipeline, which tells us two things:
they built an active verifier, **and** they had to exclude its own traffic from customer data.

Two checks, both needed:

**Passive** — has any event arrived for this `public_key` in the last 30 min? Cheap, definitive.

**Active** — on demand, fetch `https://example.com` with UA `TailwatchVerifier/1.0` and report
precisely which of these failed:

| Check | Failure message the customer actually needs |
|---|---|
| Site reachable | "We couldn't reach example.com (timeout)" |
| Snippet present in HTML | "The snippet isn't in the page source — if you use a cache, purge it" |
| `id` matches this site | "The snippet on your site uses a different site key" |
| Script URL reachable | "The script is blocked — check your CSP `script-src`" |
| Snippet not inside `<noscript>` / commented out | — |
| Only **one** snippet present | "We found the snippet twice; remove one" ✅ (Next.js double-loads async scripts) |

⚠️ **Our verifier must be on the bot denylist from day one** or every verification run inflates the
customer's own numbers. That's the trap Plausible's drop reason exists to solve.

### ⑥ Data flows
First beacon → `204` → queue → consumer → ClickHouse → dashboard. Target: **visible within 10 seconds**
of the first pageview. That first-data moment is the entire onboarding experience; everything else is
plumbing.

---

# PART 2 — Build order

## The sequencing rule that determines everything

> **Build each layer so it can be tested *without* the layer above it existing.**

That single rule produces the order below, and it's why the answer to "backend or frontend first?" is:
**backend first, tracker second, dashboard last** — because a collector can be tested with `curl`, but
a tracker cannot be tested without a collector, and a dashboard is meaningless without data.

▶ It also means **do not build authentication first.** Hardcode one tenant, get the pipeline working
end to end, then add multi-tenancy. Building the control plane first means designing it before you know
the data model.

---

## Stage 0 — Accounts, repo, infrastructure *(days, not weeks)*

**Provision:** Cloudflare account (Workers, Queues, KV, R2, and Cloudflare for SaaS later) · domains
`cdn.` `in.` `app.` `api.` · ClickHouse (Cloud or self-hosted) · MongoDB · Redis · GitHub + CI.

**Repo — one monorepo, pnpm workspaces:**
```
tailwatch-analytics/
├── packages/
│   ├── core/          # engine: config, identity, queue, transport, consent  (zero deps)
│   ├── browser/       # npm entry, init()
│   ├── react/  next/  vue/  svelte/       # adapters, ≤30 lines each
│   └── contract/      # ⭐ the wire schema + types, imported by EVERYTHING
├── apps/
│   ├── collector/     # Cloudflare Worker  → /e
│   ├── consumer/      # Queue consumer
│   ├── api/           # query + control-plane REST
│   └── dashboard/     # React
└── infra/             # DDL, migrations, wrangler config, seeds
```

⭐ **`packages/contract` is the keystone.** Tracker, collector, consumer, API and tests all import the
same types and validators. ✅ PLAN §4 invariant 7 says the wire format is append-only forever — that is
only enforceable if there is exactly one definition of it.

**Done when:** `pnpm build` passes, CI runs, `wrangler dev` serves a hello-world Worker.

---

## Stage 1 — The contract *(no runtime code)*

Write, review, freeze:
1. **Wire contract v1** — every field, type, limit, optionality (PLAN §6.5)
2. **ClickHouse DDL** — `events`, `sessions`, and the first rollup MV (adopt ✅ Plausible's verified
   `events_v2`/`sessions_v2` shapes)
3. **MongoDB control-plane schema** — tenants, sites, users, memberships, embedded keys, counters
4. **URL normalisation rules** — host case, trailing slash, query allow-list, fragment
5. **Metric definitions** (PLAN §5) — sessions, engaged, visitor
6. **A fixture corpus** — ~50 hand-written payloads incl. every malformed case
7. ⚠️ **Answer the eight Cloudflare unknowns** (PLAN §2.4)

**Done when:** two people independently compute the same session count from the fixture file.

▶ Do not skip this to "start coding." Every later stage imports it; changing it later means changing
five things at once.

---

## Stage 2 — Collector *(first real code — backend)*

The Worker only. `POST /e` → validate → `204` → `ctx.waitUntil(queue.send())`.
Site config from **KV, hardcoded seed for one test site.** No auth, no dashboard, no tracker.

Build order inside the stage: size cap → parse → KV lookup → host check → cheap bot reject → respond →
enqueue. Plus `GET /e.gif` pixel and `OPTIONS`.

**How to test with nothing else built:**
```bash
curl -i -X POST https://in.tailwatch.com/e \
  -H 'Content-Type: text/plain' \
  -d '{"s":"tw_pub_test","n":"pageview","u":"https://example.com/","q":1,"t":1758600000000}'
# expect: HTTP/2 204, empty body
```
Then replay the whole fixture corpus and assert every status code from PLAN §8.2.

**Done when:** every fixture returns its specified code · p99 <20 ms · malformed input never 500s ·
messages land in the queue.

---

## Stage 3 — Storage + consumer *(backend)*

ClickHouse and MongoDB schemas applied. Consumer in the order fixed by PLAN §3.1: **R2 archive first**,
then enrich, Redis session, batched ClickHouse insert, session rows, rollup MVs.

⚠️ Two traps to handle now, not later: **never single-row INSERT** (✅ each creates one part and can trip
`parts_to_throw`, default 300), and **set `insert_deduplication_token` explicitly** (✅ a column with
`DEFAULT now()` makes block dedup silently do nothing).

**How to test:** push fixtures straight into the queue, bypassing the collector. Then
`SELECT * FROM events` and diff against expected rows.

**Done when:** fixtures in → correct rows out · rollup MVs match a raw `GROUP BY` · replaying the same
batch twice produces no duplicates · R2 holds the raw file.

⭐ **The pipeline is now end-to-end without a single line of frontend code.** That's the milestone worth
aiming at.

---

## Stage 4 — Tracker *(client)*

Now that a real collector exists, build `packages/core` + `packages/browser` + the CDN IIFE build.

Order: config resolution (query param → `data-*` → defaults) → idempotency guard → payload → transport
(`fetch` `text/plain` `keepalive` → `sendBeacon` on hide) → engagement accumulator → sequence counter →
consent gate → SPA route detection (Navigation API + fallback) → bfcache `pageshow`.

**Size budget enforced in CI from the first commit** — ≤3 KB wire, build fails otherwise. ✅ Plausible
does all of this in 1,361 bytes, so the budget is real, not aspirational.

**Done when:** a real page on a real domain produces correct rows · tracker ≤3 KB · a Next.js App Router
app, a Vite SPA and a hash-router app each record exactly one pageview per navigation including the
first, and survive React StrictMode in dev.

---

## Stage 5 — Control plane + onboarding *(backend, then minimal UI)*

Now the data model is known, so build it once: auth · tenants · sites (with timezone) · key issue and
**rotation** · KV sync on write · the **verifier** from Part 1 ⑤ · snippet generator.

**Done when:** a brand-new user can sign up, add a site, copy a snippet, install it, pass verification,
and see their first pageview — **unaided, with no one touching a database.** That is Stage 5's whole
point and the real test of the product.

---

## Stage 6 — Dashboard *(frontend)*

Last, because only now is it meaningful. Query API over rollups → React. First screen: pageviews over
time, top pages, referrers, countries, plus the ⭐ **capture-rate readout** and the **drop-reason
warnings feed**.

**Done when:** every number is reproducible from a documented query, and correct across a DST boundary.

---

## Stage 7 — Precision *(PLAN Phase 2 — before any new features)*

Full 843-regex `bots.yml` pass in the consumer, datacentre ASN, headless scoring, referrer spam,
sessionisation hardening, `insert_id` dedupe.

**Done when:** ⭐ **Plausible's Puppeteer test scores 0 of 95** (✅ GA4 scored 95/95) and every drop is
itemised and attributable.

---

# PART 3 — Dependency graph

```
Stage 0  infra + repo + contract pkg
            │
Stage 1  CONTRACT  (spec, DDL, fixtures)  ◀── everything below imports this
            │
    ┌───────┴───────┐
    ▼               ▼
Stage 2         Stage 3
COLLECTOR       STORAGE + CONSUMER      ← these two are parallelisable
    └───────┬───────┘
            ▼
Stage 4  TRACKER            (needs a live collector to test against)
            │
Stage 5  CONTROL PLANE      (needs the data model to be settled)
            │
Stage 6  DASHBOARD          (needs data to exist)
            │
Stage 7  PRECISION          (needs volume to tune against)
```

**Parallel from Stage 2 onward:** the fixture corpus and bot regression set (Workstream C) · the
"what we collect, field by field" page · the DPA/legal track (PLAN §10 — long lead time, start early).

---

# PART 4 — Environments & local development

| Env | Collector | Store | Purpose |
|---|---|---|---|
| **local** | `wrangler dev` | Docker ClickHouse + MongoDB replica set + Redis | fixtures, unit tests |
| **staging** | `in-staging.` | separate DB | real browsers, real domains |
| **prod** | `in.` | prod | — |

**Two local-dev frictions worth solving on day one:**
1. **`sendBeacon` and `keepalive` behave differently on `http://localhost`.** Test the transport path
   against staging over HTTPS, not localhost. ✅ And remember `localhost` is excluded by default — add
   an `allow_local` flag for dev (✅ GoatCounter ships exactly this).
2. **The tracker must be testable headlessly and in real browsers.** Headless for logic; a real-browser
   matrix incl. **Safari <26.2** for the Navigation API fallback path.

---

# PART 5 — Concretely, the first two weeks

| Day | Work |
|---|---|
| 1–2 | Stage 0: accounts, domains, monorepo, CI, `wrangler dev` hello world |
| 3–5 | Stage 1: contract, DDL, normalisation rules, fixture corpus, ⚠️ answer the 8 CF unknowns |
| 6–8 | Stage 2: collector + all status codes + `curl` test suite green |
| 9–12 | Stage 3: ClickHouse + consumer + R2 archive + rollup MV; fixtures → correct rows |
| 13–14 | **Milestone: end-to-end pipeline, no frontend.** Then start Stage 4 |

▶ **The first real milestone is not a screenshot — it's a `curl` producing a correct ClickHouse row.**
If you aim at a dashboard first, you'll build the data model twice.

---

# PART 6 — Five sequencing mistakes to avoid

1. **Auth first.** Tempting because it feels like the foundation. It isn't — it locks in a data model
   you don't understand yet. Hardcode one tenant through Stage 4.
2. **Dashboard first.** You'll design queries against imagined data, then rebuild them.
3. **Tracker first.** Nothing to send to; you end up testing against a mock that lies.
4. **Skipping the contract.** The single most expensive shortcut available, because PLAN §4's
   append-only rule stops being enforceable.
5. **Deferring the size budget.** ✅ 3 KB is achievable from the start and nearly impossible to retrofit
   — GA4's 151 KB is what "we'll optimise later" looks like after ten years.
