# TailWatch Analytics — Plan, Stack & Roadmap

**Version:** 1.2 · **Date:** 2026-09-23 · **Status:** for review, no code written
**Evidence base:** [research/](research/) — 574 KB, 12 files, primary-source-cited. Every decision
below carries a pointer to the finding that drove it.

Markers: ✅ = verified in research · ▶ = judgment call, mine to defend · ⚠️ = needs verification
before commitment

---

## 1. What we are building

A **platform-agnostic, cloud-only web analytics product** with four install surfaces — script tag,
npm package, framework adapters, CMS plugins — all backed by one hosted collector.

⚠️ **DECIDED 2026-09-23: no local/self-hosted mode.** See §12 for the consequences — the significant
one is that the WordPress plugin can no longer track by default and must gate on an explicit connect
step (wp.org Guideline 7).

### The positioning, in one line
> Analytics that tells you the truth about how many humans visited, and shows you its own margin of
> error.

That is not marketing gloss; it falls directly out of the research. Two things are simultaneously
true: ✅ **coverage is unwinnable** (filter lists, consent law, browser storage policy, a ~9% beacon
floor are all outside our control), and ✅ **precision is cheap to win** (GA4 counted **95 of 95**
synthetic Puppeteer sessions as human, and Google states you "cannot disable known bot traffic
exclusion or see how much known bot traffic was excluded"). So we compete on precision and honesty,
never on capture rate.

### What we will NOT build — scope discipline
| Not building | Why |
|---|---|
| Ad-blocker evasion / CNAME cloaking | ✅ Unwinnable — uBO blocks Fathom by **base64 payload signature** with the `1p` flag; EasyPrivacy carries **893 hand-added Plausible customer hostnames**. And ✅ the harder you obscure, the closer you move to the legal definition of covert tracking |
| Canvas/audio fingerprinting | ✅ Highest legal risk under ePrivacy Art 5(3); terrible optics for a security brand |
| City-level geo claims | ✅ MaxMind's own figure is **66%** accuracy for US cities within 50 km; Hong Kong is 29% |
| Session replay / heatmaps | ▶ Different product, far worse privacy optics, and ✅ only Amplitude publishes cost figures at all |
| Reporting-time sampling / thresholds | ✅ GA4's biggest user complaints; free for us to avoid at our scale |
| Cross-site / cross-device identity | ▶ Requires the tracking we're positioning against |

---

## 2. The stack

### 2.1 Decisions
| Layer | Choice | Why |
|---|---|---|
| **Tracker** | TypeScript, **zero dependencies**, esbuild → IIFE (CDN) + ESM/CJS (npm) | ✅ Budget is ≤3 KB wire; Plausible does everything we need in **1,361 bytes** |
| **Collector** | **Cloudflare Workers** | ✅ The collector's only job is to ack in <5 ms then enqueue; global edge does that natively. Solves noisy-neighbour isolation and spike absorption without ops |
| **Queue** | **Cloudflare Queues** | Native to Workers; ✅ replaces the "respond before durable write" pattern verified in Snowplow's `Service.scala` |
| **Consumer / enrichment** | TypeScript Worker (queue consumer) | Same language as tracker and dashboard; one skill set |
| **Event store (cloud)** | **ClickHouse** | ✅ Adopt Plausible's verified `events_v2` / `sessions_v2` schemas from day one. ✅ Cloudflare: 600 B/ES doc → **60 B/ClickHouse row** |
| **Control plane** | **MongoDB** (tenants, sites, keys, billing refs) | Document/transactional control plane; ClickHouse is wrong for this. Owner decision 2026-10-05. |
| **Session hot store** | **Redis** (TTL 30 min) | ✅ Plausible partitions in-process 100 ways with a 1 s lock timeout; Redis gives us that shared and portable. Durable Objects are the CF-native alternative |
| **Geo** | **Cloudflare `request.cf.country`** ⚠️ | ⭐ **This eliminates the GeoIP licensing problem entirely** — ✅ MaxMind's EULA §6.1 blocks redistribution and IP2Location LITE tops out ~65–80% city. Country from the edge is free and unlicensed. ⚠️ Verify `request.cf` field availability and accuracy before committing |
| **Bot filtering** | Ported Matomo `bots.yml` + datacentre ASN list + edge signals | ✅ 843 regexes incl. 78 AI-crawler entries, free; ✅ IAB list costs **$15,000/yr** |
| **Dashboard** | React — reuse TailWatch's existing admin-app patterns | Already built, already shipped |
| **Query API** | REST, one API serving wp-admin + cloud dashboard + mobile app | TailWatch already has exactly this three-client pattern |

### 2.2 Why ClickHouse, and why there is only one event store

✅ WP Statistics died at **4M rows, 12.5 s queries, 16 s admin pages** storing one row per hit in MySQL
and JOINing at read time. ✅ Plausible themselves migrated off Postgres — dashboard load went **5 s →
<1 s**, and their 150M-pageview customer "would not have been possible previously."

▶ With local mode dropped, there is **one event store, one code path, one schema**. That removes the
dual-backend test matrix, the MySQL rollup-ceiling question, and the buffer→cron machinery entirely.

### 2.3 The one thing that makes this stack coherent
**TypeScript from tracker to collector to consumer to dashboard.** PHP appears only in the WordPress
plugin. For a small team that is worth more than any per-layer optimum.

### 2.4 DECIDED: Cloudflare Workers — what it commits us to
*Decision taken 2026-09-23. This closes open decision #1.*

#### What we get for free (and would otherwise have to build or license)
| Gift | Replaces | Note |
|---|---|---|
| `request.cf.country` | A GeoIP database + licence | ⭐ ✅ Sidesteps MaxMind EULA §6.1 entirely |
| `request.cf.asn` / `asOrganization` | A datacentre-ASN list to detect bot hosting | ⭐ ✅ Plausible claims ~32,000 datacentre ranges; we get ASN identity per request |
| `ctx.waitUntil()` | The whole respond-then-process dance | ⭐ Literally the ✅ Snowplow pattern as a platform primitive: return `204`, enqueue after |
| Cloudflare Queues | Kafka / Kinesis / Redis Streams | Native binding, no ops |
| Workers KV | A cache tier for tenant/site lookup | Eventually consistent — fine, site config changes can lag ~a minute |
| Cloudflare for SaaS | Custom-hostname TLS provisioning | ⭐ Makes Tier 2.2 (CNAME) and Tier 2.3 feasible at all |
| Global anycast edge | CDN + multi-region deploy | The `204` is served from the visitor's nearest colo |
| Static asset serving | A separate CDN for `tw.js` | ✅ And it lets the tracker default its endpoint to its own origin, which is how dual-mode stays free |

#### ⚠️ The constraint that changes the architecture
**Workers have a hard per-request CPU budget.** ✅ Matomo's `device-detector` "runs thousands of
regular expressions for each tracking request" and Plausible wraps UA parsing in a **200 ms timeout** —
neither is compatible with an edge CPU budget.

▶ **Therefore: split bot detection across the two tiers.**

```
COLLECTOR (edge, cheap only — must stay in single-digit ms)
  ├─ obvious UA denylist        (a few dozen anchored patterns, not 843)
  ├─ request.cf.asn ∈ datacentre set   ← free, O(1)
  ├─ missing/absurd headers
  └─ size + shape validation
        └──▶ 204, then ctx.waitUntil(enqueue)

CONSUMER (queue side, no CPU pressure — full precision)
  ├─ full ported bots.yml pass (843 regexes)
  ├─ headless / automation signal scoring
  ├─ referrer-spam list (2,348 domains)
  ├─ behavioural / volume anomaly per tenant
  └─ geo + UA-CH enrichment, sessionise, dedupe
```

This is strictly better than doing it all at the edge anyway: a dropped-at-the-consumer hit can still
be **counted, itemised and shown to the customer** in the warnings feed, which is our differentiator.
A dropped-at-the-edge hit is invisible. ▶ So: **the edge drops only what is unambiguous; everything
debatable is decided in the consumer and logged with its reason.**

#### Lock-in containment
▶ The collector is written as a **pure function** with platform bindings injected:
```
validate(headers, body, edgeMeta) -> ValidatedEvent | Drop{reason}
```
No CF types in the signature; `edgeMeta` is our own shape that a CF adapter fills from `request.cf`.
Porting to Fastly/Deno/Go then means rewriting the ~50 lines of glue, not the logic. The consumer,
enrichment and query layers never touch a CF API at all.

#### EU residency — resolved without Cloudflare-specific features
✅ The research settled that **residency is a property of the tenant, not the visitor**, and that it
splits the *whole* API surface (Mixpanel documents five separate EU hostnames). ▶ So:
`in.tailwatch.com` and **`in-eu.tailwatch.com`** as separate Worker+Queue+ClickHouse stacks, chosen at
`init()`, with a tenant's key valid **only in its own region**. That works with plain Workers and does
not require the Data Localization Suite. ✅ Same model as Amplitude's `serverZone` and PostHog's
`api_host`.

#### ⚠️ Phase 0 verification list — numbers I have NOT verified and must not assume
1. `request.cf` field availability, and whether `country` is present on every plan
2. Current Workers **CPU-time** limits per request, and per-isolate regex-compilation cost
3. Cloudflare **Queues** max message size, batch size and throughput ceilings
4. Worker **bundle size** limit (matters if we ever bundle the full bot list at the edge — per above,
   we shouldn't)
5. Whether `request.cf.botManagement` is worth its add-on cost vs our own consumer-side scoring
6. Subrequest limits per request on the paid plan
7. ClickHouse connectivity from a Worker — HTTP interface is the safe assumption; confirm before
   relying on raw TCP sockets
8. Cloudflare for SaaS custom-hostname limits and cost per hostname

▶ None of these change the decision; they change sizing and the free/paid plan choice. All are
answerable in under a day.

---

## 3. Architecture

```
  ANY WEBSITE                          CLOUD MODE
  ┌────────────────┐
  │ tw.js  ≤3 KB   │   POST text/plain
  │ async, in head │──────────────────────┐
  └────────────────┘                      ▼
                              ┌────────────────────────┐
                              │ Worker: /e (edge)      │
                              │ validate → 204 <5 ms   │
                              │ then enqueue           │
                              └───────────┬────────────┘
                                          ▼
                              ┌────────────────────────┐   ┌──────────┐
                              │ Queue                  │   │ Redis    │
                              └───────────┬────────────┘   │ sessions │
                                          ▼                └────┬─────┘
                              ┌────────────────────────┐        │
                              │ Consumer: enrich       │◀───────┘
                              │ bot · geo · UA · ref   │
                              │ sessionise · dedupe    │
                              └───────────┬────────────┘
                                          ▼
                          ┌───────────────────────────────┐   ┌──────────┐
                          │ ClickHouse  events + sessions │   │ MongoDB │
                          │ + AggregatingMergeTree rollups│   │ control  │
                          └───────────────┬───────────────┘   └────┬─────┘
                                          ▼                        │
                              ┌────────────────────────┐◀──────────┘
                              │ Query API (REST)       │
                              └───┬────────┬───────┬───┘
                                  ▼        ▼       ▼
                            cloud dash  wp-admin  mobile app


```

---

### 3.1 Database write path — what touches which store, and when

```
  ① EDGE COLLECTOR                          reads only, never writes
     └─ Workers KV  GET site:{tw_pub_*}      → is the site live? domains? flags?
        (cached at the colo; eventual consistency is fine — config may lag ~1 min)
        └──▶ 204 to browser
        └──▶ ctx.waitUntil( Queue.send(event) )

  ② QUEUE                                   Cloudflare Queues, batched delivery

  ③ CONSUMER — one batch, in this exact order
     │
     ├─ (a) R2  PUT  raw/{date}/{hour}/{uuid}.ndjson        ◀ ARCHIVE FIRST
     │        the untransformed batch, before any enrichment
     │        ✅ Snowplow archives raw precisely so enrichment can be re-run.
     │        If (b)–(e) crash or a bug ships, this is the only thing that saves us.
     │
     ├─ (b) enrich in memory   bot · country · UA · referrer · normalise URL
     │        └─ drop decisions recorded WITH REASON (not discarded silently)
     │
     ├─ (c) REDIS   GET/SET  sess:{site}:{visitor_hash}   TTL 1800s
     │        → new session or continue? engaged yet? pageview count?
     │        ✅ Plausible routes each visitor to one worker so updates serialise;
     │           1 s lock timeout then drop rather than block the pipeline
     │
     ├─ (d) CLICKHOUSE  INSERT INTO events  (BATCH — never single row)
     │        ⚠️ ✅ "direct INSERTs create one part each and a single INSERT can trip
     │           parts_to_throw (default 300 parts)" — batching is mandatory, not an
     │           optimisation. Use async_insert=1, wait_for_async_insert=1
     │        idempotency: insert_deduplication_token = batch id
     │        ⚠️ TRAP: a column with DEFAULT now() gives every row a unique value, so
     │           block dedup silently does nothing. Never rely on it without a token.
     │
     ├─ (e) CLICKHOUSE  INSERT INTO sessions   (two rows per mutation)
     │        VersionedCollapsingMergeTree: old state sign=-1, new state sign=+1
     │        ✅ the correct engine for a concurrently-updated mutable row;
     │           PostHog used ReplacingMergeTree for this and calls it "a mistake"
     │
     └─ (f) ROLLUPS — no code, they fire themselves
              Materialized views on `events` write into AggregatingMergeTree targets
              with uniqState(visitor_hash) on insert / uniqMerge(...) on read
              ✅ this is what makes unique counts mergeable across any period

  ④ MONGODB                                NOT in the hot path
     └─ tenants, sites, users, teams, keys, billing, saved reports
     └─ quota counters written PERIODICALLY (rolled up), never per event
        ▶ one MongoDB write per event would recreate the exact bottleneck
          we avoided by not writing per-hit rows in the first place

  ⑤ READ PATH
     Query API ──▶ ClickHouse rollup tables (fast path, ~all dashboard queries)
                └▶ ClickHouse raw events (only for ad-hoc/segment queries)
                └▶ MongoDB (site name, timezone, settings, permissions)
```

**Write frequency per store, per event:** KV = 1 read (cached) · Queue = 1 write · R2 = 1 write per
*batch* · Redis = 1 read + 1 write · ClickHouse = 1 row in a *batch* insert · MongoDB = **0**.

**Why the archive comes first (a) and not last:** everything after it is recoverable. ✅ Snowplow's
whole failed-event and reprocessing model depends on having the raw payload. Without R2 first, an
enrichment bug is permanent data loss; with it, we re-run the consumer over a date range.

**No store holds an IP address.** It exists only in the consumer's memory during (b)/(c), then is gone.

---

## 4. Non-negotiable invariants
These are the rules that, if broken, make the product wrong. They go in CONTRIBUTING and in review.

1. **The collector never touches a database.** ✅ Snowplow acks after an in-process enqueue; Koko's
   PHP collector "never touches the database."
2. **Respond `204` in <5 ms.** The contract is "I received bytes", not "this is durable."
3. **Never one row per hit, queried live.** ✅ The WP Statistics failure mode.
4. **`Content-Type: text/plain`, always.** ✅ The Fetch spec safelists exactly three types;
   `application/json` forces an `OPTIONS` preflight that **cannot complete during page unload.** This
   is the single highest-leverage line in the whole contract.
5. **Never register `unload` or `beforeunload`.** ✅ They disable bfcache and deliver *worse* results
   (~82.9% vs ~91% for `pagehide`+`visibilitychange`).
6. **Tenant key goes in body or query string, never an `Authorization` header.** ✅ `Authorization`
   isn't CORS-safelisted → a preflight per event.
7. **The wire format is append-only forever.** Add optional fields; never rename, never re-type, never
   tighten validation. ✅ "The client you'd be rejecting is a cached script you cannot update."
8. **Respond identically whether a hit is accepted or dropped.** ✅ Plausible returns `202` either way
   with the reason in a header, so the endpoint is not a tenant-existence oracle.
9. **The tracker sends its own version on every hit.** ✅ Plausible's `b.v = 36`.
10. **De-dupe route changes in core, never in adapters.** ✅ One normalise-and-compare guard kills
    StrictMode double-fire, `replaceState` noise, and trailing-slash splits at once.
11. **Exactly one of {script auto-init, framework adapter} emits the first pageview.**
12. **Discard the raw IP immediately after enrichment.** Never a column, never a log line.
13. **Size budget ≤3 KB wire, enforced in CI.** The build fails, not a warning.

---

## 5. Metric definitions — settle these before any code

✅ GA4 and Matomo will never agree on session counts *by design*, so our definitions must be explicit,
documented, and stable.

| Metric | Definition | Source |
|---|---|---|
| **Visitor** | `hash(daily_salt + ip + user_agent + site_id)`. Salt rotates daily; **previous salt kept 48 h** so sessions crossing midnight survive | ✅ Plausible |
| **Session** | 30 min inactivity. **No midnight split. No campaign split.** | ✅ GA4's rules, which are the more modern ones |
| **session_id** | The session-start unix timestamp — sortable, derivable, nothing stored | ✅ GA4's trick |
| **Engaged session** | >10 s visible, OR ≥1 custom event, OR ≥2 pageviews | ✅ GA4 |
| **Bounce rate** | `1 − engaged_sessions / sessions`. Derived, never primary | ▶ Avoids depending on a beacon that's ~9% likely to be lost |
| **Time on page** | Accumulated **visible-and-focused** time, shipped with the next event or the hide-flush | ✅ Plausible checks `visibilityState` **and** `document.hasFocus()` |
| **Unique visitors** | Exact within a day. For multi-day ranges: HLL, **labelled "Estimated"** | ✅ Matomo refuses to show uniques for week/month/year by default and renames the metric when estimating |
| **Pageview** | One per committed navigation, after URL normalisation and de-dup | ✅ Normalise: lowercase host, trailing-slash policy, query allow-list, strip fragment |
| **`route` vs `path`** | Store **both** — the template (`/blog/[slug]`) and the actual URL | ▶ Without the template, dynamic routes shatter into thousands of rows — ✅ exactly GA4's `(other)` collapse |
| **Capture rate** ⭐ | `received_sequence_numbers / expected` per site per period — **shown in the UI** | ▶ Our differentiator. ✅ GA4's `_s` gap is the same signal; no vendor surfaces it |

---

## 6. Event catalogue — every event, automatic and custom

**One model: an event is a name plus up to 25 properties.** A pageview is an event too. ✅ This is
GA4's model and it is the right one — it means one wire contract, one storage shape, one query path.

### 6.1 Tier A — Always on, zero configuration *(Phase 1–2)*

| Event | Fires when | Notes |
|---|---|---|
| `pageview` | Every committed navigation, after URL normalise + de-dup + ~50 ms debounce | ✅ Includes bfcache restores via `pageshow`+`persisted`; defers while `visibilityState === 'prerender'` |
| `session_start` | **Derived server-side** from a flag on the pageview | ⭐ ✅ GA4's `_ss` trick — costs **zero extra beacons** |
| `first_visit` | Derived server-side from a flag | ✅ GA4's `_fv` |
| `engagement` | Accumulated visible **and focused** ms, shipped with the next event or the hide-flush | ✅ GA4's `_et`; ✅ Plausible also checks `document.hasFocus()`, so a visible-but-unfocused tab stops accruing |

▶ These four give pageviews, sessions, new-vs-returning, engaged sessions, bounce rate and
time-on-page — **from a single beacon per navigation.**

### 6.2 Tier B — Automatic, opt-in per site via a runtime flag *(Phase 5, except vitals)*

✅ One build with `data-*` flags, **not** Plausible's build-time variant matrix — measured, the fully
loaded variant saves only **818 bytes on the wire** and costs an N-dimensional build and a docs page
per combination.

| Event | Our trigger | GA4's blind spot we fix |
|---|---|---|
| `scroll` | **25 / 50 / 75 / 90 %** | ✅ GA4 fires **once, at 90 % only** — no depth distribution at all |
| `outbound_click` | Link to a different registrable domain | ✅ GA4 silently excludes links configured for cross-domain measurement |
| `file_download` | Extension list **+ configurable path patterns** | ✅ GA4 is extension-regex only, so `/download?id=123` is invisible |
| `site_search` | Query params (`q,s,search,query,keyword`) **+ path patterns** like `/search/*` | ✅ GA4 is query-string only, so `/search/shoes` is invisible |
| `form_start` / `form_submit` | First interaction / submit | ✅ GA4's `form_start` fires once **per session**, not per form |
| `video_start` / `_progress` / `_complete` | YouTube, **Vimeo, and native `<video>`**; progress at 25/50/75 | ✅ GA4 is **YouTube only**, and only with `enablejsapi=1` on the iframe |
| `rage_click` | ≥3 rapid clicks on one element | ✅ PostHog ships a content ignore-list (`next`, `prev`, `>`, `<`, plus steppers `+ - − –`, max 10 entries) because paginators and quantity steppers cause false positives. **Copy the ignore-list, don't rediscover it** |
| `dead_click` | Click causing no DOM change or navigation | ✅ PostHog bills this as a normal event; it's a genuine UX signal |
| `js_error` | `window.onerror` / `unhandledrejection` | ▶ **Nobody in the privacy-analytics tier ships this**, and it fits TailWatch's monitoring brand exactly |
| `web_vitals` | LCP / INP / CLS, flushed once at page hide *(Phase 6)* | ✅ `web-vitals` v3+ reports bfcache restores as `navigationType: 'back-forward-cache'` |

**Deliberately NOT shipped:** autocapture-everything, clipboard/copy capture, `<input>` values.
✅ Reasons: payload volume (a full DOM ancestor chain per click, PostHog caps depth at 1000 and text at
1024 chars), brittle `nth-child`/`nth-of-type` selectors that break on any markup refactor, and PII
leakage serious enough that PostHog ships **anchored regexes for credit-card numbers and SSNs** to
strip captured values. ✅ Note Mixpanel and Amplitude both default autocapture **off**.

### 6.3 Tier C — Custom events, three creation paths *(Phase 5)*

| Path | How | For whom | Needs a deploy? |
|---|---|---|---|
| **Code** | `tw.track('signup', { plan: 'pro', seats: 5 })` | Developers | Yes |
| **HTML attribute** | `<button data-tw-event="signup" data-tw-plan="pro">` | Designers, CMS editors | Template edit only |
| **Dashboard rule** | *"fire `pricing_view` when path matches `/pricing*`"* · *"fire `cta_click` when a click matches `.hero .btn`"* — delivered as a small remote-config blob | Marketers, no code at all | **No** |

#### The governance decision: send-first, curate-after
▶ **No pre-registration required.** Any event name works immediately and appears in the dashboard
within seconds, flagged as new/uncurated. The customer can then rename its display label, describe it,
mark it a conversion, attach a value, pin it, or archive it. Properties are auto-discovered.

⚠️ **GA4 does the opposite and it is a real trap we must not copy:** you can send `ep.plan=pro`
forever, but it **will not appear in any report until `plan` is registered as a custom dimension** —
capped at 50 (125 on 360) — and ✅ "deleting a custom definition at the quota does not free the slot
immediately — allow about **48 hours**." Customers lose weeks of data to that silently.

#### ⚠️ The honest limit: dashboard-created events are forward-only
✅ Heap's Virtual Events *are* retroactive — "retroactive to the moment you installed Heap" — but only
because Heap autocaptures everything first and names patterns later. **We don't autocapture, so a rule
created today collects from today.** State this in the UI rather than letting customers discover it.
▶ Optional future middle ground: *scoped* autocapture ("record clicks matching these selectors"),
which buys retroactivity inside a boundary the customer chose.

### 6.4 Tier D — Server-side events *(Phase 7)*
Same event model, no browser: `@tailwatch/node`, PHP SDK, or a raw `POST /e`. For purchases, refunds,
subscription changes, webhook-driven conversions — anything the browser can't be trusted to report.
✅ Cannot carry screen, engagement, scroll or client-side routing data.

### 6.5 Rules that apply to every event

| Rule | Value | Why |
|---|---|---|
| Name | ≤40 chars, `[a-z0-9_]` | Matches GA4 so migrations are clean |
| Properties | **25 max** | ✅ GA4's limit, and it's a sane one |
| Property key | ≤40 chars | — |
| Property value | **≤255 chars** | ▶ GA4's 100 is stingy; 255 fits a MySQL/ClickHouse column cheaply |
| Reserved names | We reserve `tw_*` and the Tier A/B names | — |
| Rejection | **Never silent.** Drop reason goes to the customer's warnings feed | ✅ GA4 silently rejects `_`, `firebase_`, `ga_`, `google_`, `gtag.` prefixes |
| PII | Server-side refusal of card/SSN-shaped values | ✅ PostHog's approach, applied server-side where it can't be bypassed |
| **Cardinality** | ⚠️ Warn in the UI above ~**500 distinct values** for a property; **never key a rollup on one** | ✅ Exactly how GA4 ends up collapsing rows into `(other)`; Google's own guidance is to treat >500 values as high-cardinality |
| Quota | Events count toward the plan's event quota | Over quota → `200` + `quota_limited` |

### 6.6 Where events land in the roadmap
| Phase | Events |
|---|---|
| **1** | `pageview` |
| **2** | `session_start`, `first_visit`, `engagement` (server-derived) |
| **5** | All of Tier B except vitals · all of Tier C · goals/conversions |
| **6** | `web_vitals` |
| **7** | Tier D server-side · funnels built on ordered events |

---

## 7. Integration methods — the complete matrix

Every way a customer can install this, what it costs us, and what it actually buys them. **All of
these share one core and one wire contract** — that is the whole reason the list can be this long
without becoming unmaintainable.

Legend — **Blocker resistance**: how well it survives EasyPrivacy/uBO. **1p cookies**: can we set a
first-party cookie with a real lifetime (opt-in cookie mode only).

### Tier 1 — Client-side JavaScript

| # | Method | How it installs | For whom | Blocker resist. | 1p cookies | Effort | Phase |
|---|---|---|---|---|---|---|---|
| 1.1 | **CDN script tag** | `<script async fetchpriority="low" src="https://cdn.tailwatch.com/tw.js?id=tw_pub_…">` in `<head>` | Everyone. The default. | **Low** — our domain will be listed | No | — | 1 |
| 1.2 | **Self-hosted script** | Customer downloads `tw.js`, serves it from their own origin, points `data-api` at our collector | Customers who can deploy a file | Medium — defeats the *domain* rule for the script; the beacon is still blockable | No | Low | 3 |
| 1.3 | **npm package** | `npm i @tailwatch/browser` → bundled into the app | Anyone with a build step | **Script: High** (it's their own first-party bundle — unblockable without breaking their site). **Beacon: still blockable** | No | Med | 3 |
| 1.4 | **Framework adapter** | `npm i @tailwatch/next` + `<TailwatchProvider>` | React/Next/Vue/Svelte/Nuxt/Astro/Angular/Remix | Same as 1.3 | No | Med | 3 |
| 1.5 | **Tag manager template** | GTM custom template; Tealium; Segment destination | Marketing-led teams with no dev access | **Low** — ✅ `/gtm.js` and `/gtag/js?` are *unanchored path rules* that match even self-hosted GTM | No | Low | 7 |

▶ **The nuance on 1.3/1.4 that matters:** bundling makes the *script* unblockable, because it is
indistinguishable from the customer's own application code. But the *beacon request* to our collector
is a separate network call and remains blockable. **Only combining a bundled script with Tier 2
gets you both halves.** Say this plainly in the docs; every vendor blurs it.

### Tier 2 — Network-level (this is the "DNS" question)

| # | Method | How it installs | Blocker resist. | 1p cookies | Effort | Phase |
|---|---|---|---|---|---|---|
| 2.1 | **Reverse proxy, same origin** | Customer maps `customer.com/tw/*` → our collector (Nginx/Apache rule, Vercel/Next `rewrites`, Netlify redirect) | **High** — same-origin, no separate host to list. ⚠️ Generic *path* rules can still catch it (✅ PostHog's documented `/ingest` path is blocked generically as `/ingest/*^ip=`) | **Yes** | Med | 5 |
| 2.2 | **CNAME / custom subdomain (DNS)** | `analytics.customer.com CNAME ingest.tailwatch.com`. **We must provision TLS for their hostname** (Cloudflare for SaaS / ACME on-demand) | **Medium, and asymmetric** — see below | Partial | **High** | 6 |
| 2.3 | **Cloudflare Worker on the customer's own zone** | We ship a Worker they install on their zone; it injects the snippet and proxies the beacon on a **relative path** | **Highest** — ✅ first-party by construction, exactly how Cloudflare's own beacon posts to a relative `/cdn-cgi/rum` | **Yes** | Med | 6 |
| 2.4 | **Edge middleware injection** | Next.js middleware / Vercel Edge / Fastly VCL injects the snippet server-side | High (same as 2.1) | Yes | Low | 7 |

#### 2.2 in detail — the honest CNAME story
This is the one most often oversold, so the plan states it precisely:

- ✅ **uBlock Origin uncloaks CNAMEs by default** (`cnameUncloakEnabled: true`) via Firefox's
  `browser.dns` API — so it does **not** work for uBO-on-Firefox (**11.07M** daily users).
- ✅ **Brave uncloaks natively** since 1.17 — doesn't work there either.
- ✅ **Chrome's uBO Lite cannot uncloak** (no `dns` API in Chrome). So it **does** work against the
  Chrome blocking population, which is the largest one.
- ✅ **Safari caps CNAME-cloaked cookies at 7 days.**
- ✅ EasyPrivacy maintains **per-vendor CNAME blocklists — 893 hand-added Plausible customer
  hostnames** in a file dedicated to Plausible alone.

▶ **Verdict: offer it, price it as a paid convenience for latency and first-party cookies, and never
market it as ad-blocker evasion.** ✅ The economics are structurally lopsided — one filter-list line
defeats a whole customer base, and each customer must independently re-obscure. It also carries the
self-defeating trade-off: the harder you obscure, the closer you move to the legal definition of
covert tracking.

#### "Can we do analytics purely at DNS level?"
No. DNS resolution tells you a hostname was looked up — not which page, referrer, session, or whether
a human was involved. It's the wrong layer. DNS is only useful here as the *routing* mechanism in 2.2.

### Tier 3 — Server-side

| # | Method | What it is | Coverage | What it CANNOT capture | Effort | Phase |
|---|---|---|---|---|---|---|
| 3.1 | **Node SDK** | `@tailwatch/node` — server events, backend conversions | Total (no browser) | screen, engagement time, scroll, client-side routing | Med | 7 |
| 3.2 | **PHP SDK** | Composer package | Total | same | Med | 7 |
| 3.3 | **Direct HTTP API** | Documented `POST /e` — any language, curl | Total | same | **None** (it's the same endpoint) | 1 |
| 3.4 | **Server log import** | Customer uploads/streams access logs; we classify and reconcile | **~100%** | everything client-side | High | 7 |

⭐ **3.4 is worth more to us than to anyone else, and it's a positioning play.** ✅ Server logs have
the *best* coverage (nothing to block, no consent-JS issue) and the *worst* precision (~53% of traffic
was bots in 2025, plus assets and retries). Our whole position is precision and honesty. So log import
shouldn't be sold as "more accurate" — it should power a **reconciliation view**:

> "Your JS recorded 1,200 humans. Your logs show 11,000 requests. Here's the breakdown: 6,400 bots,
> 2,100 assets, 900 blocked-or-consent-denied, 400 beacon loss. Here's your real capture rate."

✅ That is precisely the comparison the research proved nobody can do credibly today — "GA vs server
logs" is **two opposite-signed errors on different denominators**, and no peer-reviewed study exists.
We'd be the only vendor that does the normalisation for the customer instead of hand-waving.

### Tier 4 — No-JavaScript fallbacks

| # | Method | Use case | Caveat |
|---|---|---|---|
| 4.1 | **Tracking pixel** `<img src="https://in.tailwatch.com/e.gif?…">` | Email opens, RSS, `<noscript>`, AMP, forums/markdown where JS is impossible | No engagement, no session continuity, no SPA. ✅ Same GET fallback GoatCounter and Matomo ship |
| 4.2 | **`<noscript>` companion** | Visitors with JS disabled | Undercounts badly but is better than zero |
| 4.3 | **AMP / restricted embeds** | AMP pages | Pixel only |

### Tier 5 — Platform plugins *(all of these merely emit the Tier 1.1 snippet)*
WordPress (Phase 4) · Shopify, Webflow, Ghost (Phase 7) · Wix, Squarespace, Drupal, Joomla (later).
▶ **Hard rule: a platform plugin contains zero tracking logic.** It is a settings UI plus a script
tag plus a settings UI. ⚠️ With local mode dropped there are **no exceptions** — including WordPress.

### 7.1 Which method should a customer use? — the decision tree

```
Do you already run Cloudflare on your domain?
├─ YES ──▶ 2.3  Worker on your zone        (best result, first-party, zero code change)
└─ NO
   ├─ Do you have a build step (React/Next/Vue/…)?
   │  ├─ YES ──▶ 1.4 framework adapter  (+ 2.1 reverse proxy if you can)
   │  └─ NO
   │     ├─ On a CMS we support?  ──▶ Tier 5 plugin
   │     └─ Otherwise            ──▶ 1.1 CDN script tag
   └─ Need data with no browser at all? ──▶ 3.1/3.2/3.3 server-side
      Need the true denominator?         ──▶ add 3.4 log import
```

### 7.2 Build cost of supporting all of it
Tiers 1.1–1.4 and 3.3 are **one codebase**. Tier 2 is **configuration and TLS provisioning**, not new
tracking logic. Tier 4 is **one extra route** on the collector. Tier 5 is **a settings form per
platform**. ▶ That's why the matrix is affordable: the expensive parts are the collector and the
precision layer, and every row above shares them.

---

## 8. Runtime behaviour — the complete case list

What the product does in every state it can be in. This is the spec the tracker and collector are
tested against.

### 8.1 Client-side states
| Case | Behaviour | Why |
|---|---|---|
| Normal pageview | Send immediately | Get it out before the user bounces |
| JS disabled | Nothing (Tier 4.1/4.2 pixel if configured) | — |
| Script blocked by filter list | Nothing. **Counted as loss via the capture-rate gap** | ✅ Our honesty feature |
| Beacon blocked but script loaded | Sequence gap recorded on the next successful hit | ✅ GA4's `_s` mechanism |
| Consent unknown | **Buffer in memory, send nothing** | ✅ ePrivacy Art 5(3) applies regardless of cookies |
| Consent granted | Flush buffer | — |
| Consent denied | **Discard buffer.** Optional identifier-free count if the site opts in | ✅ GA4 "Basic" equivalent as our default |
| `prerender` visibility | Defer until visible | ✅ Plausible does this — a speculative prerender is not a view |
| bfcache restore | Emit pageview on `pageshow` + `event.persisted` | ✅ web.dev: otherwise you silently undercount |
| Tab hidden | Stop the engagement timer, flush | — |
| Tab visible but **unfocused** | Stop the timer | ✅ Plausible checks `document.hasFocus()` too |
| SPA route change | One pageview, after normalise + de-dup + ~50 ms debounce | ✅ Kills StrictMode/`replaceState`/trailing-slash bugs at once |
| Hash-only route change | Pageview **iff** `hashRouting` enabled | ✅ `pushState` never fires `hashchange` |
| `replaceState` (scroll restore, filters) | **No pageview** (normalised URL unchanged) | ✅ GA4 double-counts here |
| Offline | Queue; flush on `online` | — |
| `sendBeacon` returns `false` | **Halve the batch recursively**, floor ~16 KB, then fetch with keepalive **disabled** | ✅ PostHog's algorithm; the 64 KiB keepalive quota is shared per-origin |
| Payload >32 KB | Split, or drop with a console warning | ✅ Segment's per-event cap |
| Script loaded twice | Second copy is a **no-op** | ✅ "Next.js has a bug that loads async scripts twice… Gatsby exhibits the same behaviour" |
| Localhost / staging | Don't send (`allow_local` opt-in) | — |
| Inside an iframe | Configurable; default off | — |
| Visitor opted out (`localStorage` flag / `?tw_disable=1`) | Nothing, permanently | — |

### 8.2 Collector-side states
| Case | Response | Then |
|---|---|---|
| Valid hit | **`204`, <5 ms** | Enqueue |
| Unknown site id | **`204`** + `x-tw-dropped: not_found` | Drop. ✅ Never an existence oracle |
| URL host ≠ registered domains | `204` + `x-tw-dropped: hostname` | Drop, surface in the customer's warnings feed |
| Bot (UA / ASN / edge signal) | `204` + `x-tw-dropped: bot` | Drop, **itemised and auditable** |
| Malformed body | **`400`** | ✅ The one case Plausible 400s on |
| Over size cap | **`413`** *before parsing* | — |
| Rate limited | **`429` + `Retry-After`** | Retry is the correct client behaviour |
| Over plan quota | **`200` + `{quota_limited:[…]}`** | ✅ In-band so SDKs don't retry what retrying can't fix |
| Duplicate `insert_id` (7 days) | `204` | Drop silently |
| Queue unavailable | `204` to the browser; ▶ spill to a local durable buffer | The browser must never see our internals |
| Unknown future field | **Accept and store** | ✅ Append-only contract — the client is a cached script we cannot update |
| Clock skew | `corrected = received_at − (client_sent − client_created)` | ✅ Segment, Snowplow and PostHog all converged on this |
| Timestamp >72 h old | Accept, flag as backfill | ▶ Don't silently clamp like GA4 does |

## 9. Roadmap

### 9.1 Audit finding — what v1.0 of this plan was missing

I cross-checked the roadmap against a full commercial-product checklist. **It was
pipeline-complete but product-incomplete.** The data path was fully specified; almost everything
*around* it was absent. Missing entirely:

| Missing | Consequence had we not caught it |
|---|---|
| **Authentication, accounts, teams, roles** | No way for a customer to log in. Blocks everything |
| **Billing, plans, quota enforcement** | No revenue, and no way to stop abuse of the free tier |
| **Onboarding + snippet verification** | ✅ Plausible has a `:verification_agent` drop reason — they built a verifier because customers cannot tell if install worked |
| **Data retention & pruning policy** | ✅ Legally required (GDPR Art 5(1)(e)); also an unbounded storage bill |
| **Erasure / DSAR handling** | Legal exposure |
| **Our own DPA + subprocessor list** | ✅ We are a **processor**; EU customers cannot lawfully buy without it |
| **Reporting beyond one screen** | Date ranges, comparisons, segments, realtime, email reports, alerts, export, public dashboards — all absent |
| **GA4 import** | Adoption blocker. Nobody switches without their history |
| **Dead-letter queue + replay** | A consumer bug silently destroys data with no recovery |
| **Raw event archive** | ✅ Snowplow archives raw to S3 precisely so enrichment can be re-run. Without it, an enrichment bug is permanent |
| **Bot/spam list update pipeline** | ✅ The lists change continuously; a frozen list decays into uselessness |
| **Tracker kill switch / staged rollout** | An evergreen script means one bad release breaks every customer at once, with no rollback |
| **Observability & SLOs** | We'd learn about outages from customers |
| **Timezone model per site** | ✅ Flagged as a known trap and never made a deliverable. Painful to retrofit |
| **Key rotation / revocation** | An abused public key would be unfixable |
| **Cross-domain / subdomain sites** | Common requirement, no design |
| **Docs site, status page, wp.org review cycle** | Real calendar time, repeatedly underestimated |

▶ **Honest caveat:** no roadmap is provably complete. What I can say is what it has now been checked
against — the full data path, the account/billing surface, reporting, governance, operations, quality,
and launch. The class of thing I'd still expect to discover during build is *interface detail*
(exact query shapes, dashboard states), not whole missing subsystems.

### 9.2 Phases

Each phase has an **exit test** — demonstrably true, not "feels done."

#### Phase 0 — Specification *(no code)*
Metric definitions (§5) frozen · event catalogue (§6) frozen · wire contract v1 · ClickHouse DDL ·
URL normalisation rules · public-key threat model · **the ⚠️ Cloudflare list in
§2.4 answered** · edge-vs-consumer bot split · region naming (`in.` / `in-eu.`) · **timezone model**
(store UTC, render per-site tz — decide day-boundary semantics now) · **retention model per plan** ·
**browser support floor** · data-flow map for the DPIA (§10).
**Exit tests:** (a) two people independently compute the same "sessions" number from one fixture file;
(b) every ⚠️ in §2.4 has a verified number and a source.

#### Phase 1 — Vertical slice + minimal tenancy
Tracker (pageview only) → Worker → Queue → Consumer → ClickHouse → one dashboard screen (pageviews,
top pages, referrers, countries). **Plus the minimum tenancy to exist:** signup/login, create a site,
issue `tw_pub_*`, **snippet verification check**.
**Exit test:** a real website shows correct numbers for 48 h · tracker ≤3 KB wire · p99 collector
<20 ms · **capture-rate readout works** · a new user can self-onboard unaided.

#### Phase 2 — Precision *(the differentiator — before any features)*
Full `bots.yml` pass in the consumer · datacentre ASN · headless scoring · referrer spam (2,348
domains) · sessionisation (Redis) · engagement accumulation · `insert_id` dedupe (7 days) ·
**drop-reason warnings feed visible to the customer**.
**Exit test:** ⭐ **reproduce Plausible's Puppeteer test and score 0 of 95** (✅ GA4 scored 95/95) · every
drop itemised and attributable · a labelled regression corpus exists and passes.

#### Phase 3 — Product shell *(was entirely missing)*
Teams + roles (owner/admin/viewer) · invites · multi-site switcher · **API key rotation & revocation**
· plans + **quota enforcement** (`200` + `quota_limited`) · billing + dunning · **retention policy
enforcement + pruning job** · account deletion → export-then-erase · customer-facing audit log.
**Exit test:** a customer can sign up, pay, invite a colleague, rotate a key, hit a quota, and delete
their account with data provably gone.

#### Phase 4 — SPA + package channels
`@tailwatch/core` + `browser` + React/Next/Vue/Svelte adapters · Navigation API with monkey-patch
fallback · the single de-dup guard · bfcache `pageshow`.
**Exit test:** a Next.js App Router app, a Vite React SPA and a hash-router app each record **exactly
one** pageview per navigation — including the first — and survive React StrictMode in dev.

#### Phase 5 — Reporting depth *(was one screen)*
Date ranges + comparison periods · realtime ("last 5 minutes") · segments/filters · device/browser/OS ·
entry/exit pages · **email digests** · **traffic spike/drop alerts** (▶ routes into TailWatch's
existing push-notification + mobile-app rails) · CSV export · **public/shared dashboards** · **Stats
API for customers**.
**Exit test:** every number in the UI is reproducible from a documented query; timezone correct across
a DST boundary.

#### Phase 6 — WordPress plugin *(now much smaller)*
Feature-flag entry reusing the existing pattern · settings UI · **explicit connect/consent step before
any tracking** ✅ (Guideline 7) · injects the Tier 1.1 snippet, served locally ✅ (Guideline 8) · revise
privacy text at `Bootstrap.php:362` · reuse the existing provisioning/connect rails.
**Exit test:** a fresh install sends **nothing** until the user connects; after connecting, counts are
correct behind a full-page cache; passes a self-run wp.org compliance audit.
▶ No PHP collector, no buffer file, no cron aggregation, no MySQL. The plugin is a settings screen and
a script tag.

#### Phase 7 — Events, goals, attribution
Tier B automatics (§6.2) as runtime flags · Tier C custom events, all three creation paths · goals +
conversion value · **currency handling** · UTM capture, first/last-touch · **cardinality guard with UI
warning** · cross-domain and subdomain site configuration.
**Exit test:** a dashboard-created no-code event fires on a live site with no deploy; a >500-value
property triggers the warning and is refused as a rollup key.

#### Phase 8 — Core Web Vitals RUM
LCP/INP/CLS flushed once at page hide · `navigationType: 'back-forward-cache'` handled · `js_error`.
▶ Nearly free given the collector, and it fits the monitoring brand.

#### Phase 9 — Migration & reach
**GA4 import** (historical backfill) · server SDKs (Node, PHP) · GTM template · Shopify/Webflow ·
**EU region live** · reverse-proxy and CNAME (Tier 2) · **server-log reconciliation view** (§7 Tier 3.4).

### 9.3 Parallel workstreams — these do not fit a phase and must be scheduled anyway

**A. Operations** *(from Phase 1, continuous)*
Dead-letter queue + **replay tooling** · **raw event archive** (✅ Snowplow archives raw so enrichment
can be re-run — without it an enrichment bug is permanent) · reprocessing/backfill job · SLOs
(collector availability, ingest→queryable latency, ✅ Snowplow-style failed:loaded ratio) · alerting ·
**staged tracker rollout + kill switch** · ClickHouse schema-migration runbook (✅ adding columns is
cheap; changing `ORDER BY` is not) · cost-per-million-events tracking.

**B. Compliance & data protection** *(gates public launch — see §10)*

**C. Quality** *(continuous)*
Fixture corpus of real payloads · **labelled bot regression set** · synthetic traffic generator ·
load test to target RPS · cross-browser matrix incl. **Safari <26.2** (Navigation API fallback path) ·
**list-update pipeline** for `bots.yml`, referrer spam and datacentre ASNs, with a diff review step.

**D. Docs & launch**
Install docs per framework · migration guide from GA4 · **status page** · changelog · the honest
"what we collect, field by field" page · **wp.org submission + review rounds** (⚠️ the team's own
history shows multiple revision cycles — budget calendar time, not effort).

### 9.4 Completeness checklist

| Area | Covered in |
|---|---|
| Tracker, transport, lifecycle | §2.1, §4, §8.1 |
| Collector, validation, responses | §4, §8.2, §9 P1 |
| Enrichment, bots, geo, sessions | §2.4, §9 P2 |
| Storage, rollups, retention | §2.1, §2.2, §9 P3 |
| Events: automatic + custom | **§6** |
| Install: script / npm / framework / DNS / server / no-JS / platform | **§7** |
| Runtime edge cases | **§8** |
| Accounts, teams, billing, quotas | §9 P3 |
| Reporting, realtime, alerts, export, API | §9 P5 |
| WordPress plugin (cloud-only, connect-gated) | §9 P6 |
| Migration from GA4 | §9 P9 |
| Operations, DLQ, replay, rollout | §9.3 A |
| **Compliance & data protection** | **§10** |
| Quality, test corpus, list updates | §9.3 C |
| Docs, status, wp.org review | §9.3 D |
| Risks | §11 |

---

## 10. Compliance & data protection by design

The flow in §3 was designed so that compliance is a property of the architecture, not a policy
document bolted on. This section states the obligations and where each is satisfied.

### 10.1 Our legal role
✅ **We are a data processor; the customer is the controller.** That drives concrete deliverables:
a **DPA** offered to every customer, a published **subprocessor list** (Cloudflare, the ClickHouse
host, the Redis host, email provider), Art 28 contractual terms, Art 30 records of processing, Art 32
security measures, and Art 33/34 breach notification within **72 hours**.

⚠️ **This is a launch gate, not a nice-to-have.** An EU customer cannot lawfully buy from us without a
DPA in place.

### 10.2 ePrivacy Art 5(3) — what "cookieless" does and does not buy
✅ EDPB **Guidelines 2/2023 (v2.0, adopted 7 Oct 2024)** is unambiguous and is the thing most vendors
get wrong in their marketing:
- **¶50** — distributing a pixel "does constitute storage, at the very least through the **caching
  mechanism** of the client-side software."
- **¶51** — "it is the distribution of the applicative logic (usually a JavaScript code) that
  constitutes the instruction," amounting to a "gaining of access."
- **¶53** — "The fact that this information is being **produced locally** does not preclude the
  application of Article 5(3)."
- **¶54–55** — **IP-only tracking is in scope**; IPv6 and static outbound IPv4 originate from terminal
  equipment.
- **¶56** — but "the applicability of this article does not systematically mean that consent needs to
  be collected."

▶ **Therefore: we never claim "no cookies means no consent needed."** We claim we are *designed to
meet the strictly-necessary exemption criteria*, and we publish the self-assessment showing why.

### 10.3 CNIL exemption criteria — the operative spec, and what we may NOT say
✅ CNIL **replaced its approved-tools list with provider self-assessment on 4 July 2025**, and
providers **must not claim CNIL "certification" or "validation."**
✅ Their criteria, which the architecture must satisfy:

| Criterion | How our flow satisfies it |
|---|---|
| Sole purpose is audience measurement of *that* site | No cross-site identity (§1 exclusions); ✅ visitor hash is **salted per site** |
| Anything marketing-adjacent **disabled by default** | Tier B events are opt-in per site (§6.2) |
| **IP truncated by ≥1 octet** | ⚠️ Conflict — see §10.4 |
| No cohorts for differentiated content | Not built; §1 exclusion |
| Data not reused for other purposes | Single-purpose store; no data sales, ever |

### 10.4 ⚠️ The one unresolved conflict, stated plainly
✅ CNIL wants the IP truncated by at least the last octet. ✅ Plausible's own docs concede their bot
filter **"will drop the event silently"** without the real client IP. **Good bot filtering and
consent-exemption pull against each other.**

▶ Our resolution, and why it's better than the industry's: **`request.cf.asn` gives datacentre
detection without retaining the IP at all.** So the strict profile keeps most of its precision. Two
enrichment profiles:
- **Standard** — full IP used transiently in-memory for the salted hash and threat lookup, then
  **discarded**; never a column, never a log line.
- **EU-strict** — IP truncated before any use; ASN-based datacentre detection retained; documented
  precision loss disclosed to the customer.

### 10.5 Consent, and what we will not do
▶ We integrate with CMPs; **we do not ship a CMP.** Three-state gate in core: `unknown` → buffer and
send nothing · `granted` → flush · `denied` → discard. ✅ Default to GA4's "Basic" equivalent (send
nothing on denial), not "Advanced" cookieless pings.
▶ **Honour `Sec-GPC: 1`** (Global Privacy Control) and optionally DNT, at the collector, as a hard
drop. ✅ Firefox sends GPC in some configurations — cheap to respect, and a genuine trust signal.
✅ And we will not build dark-pattern consent UI: Nouwens et al. (CHI '20) measured that **removing the
opt-out button from the first page raises consent by 22–23 points** — that's manipulation, not measurement.

### 10.6 Data subject rights
- **Minimisation (Art 5(1)(c))** — the tracker sends no UA and no IP; the server already has both.
  Salted-hash identity is not reversible to a person; salt rotates **daily**, previous salt kept 48 h.
- **Retention (Art 5(1)(e))** — per-plan retention enforced by a pruning job (Phase 3). ▶ Note ✅ GA4
  standard caps event-level data at **2 or 14 months** — beating that is both compliant and a selling point.
- **Erasure (Art 17)** — documented DSAR path. ▶ Because we store a daily-rotating salted hash and no
  IP, there is usually **nothing to erase**, and saying so with evidence is the strongest possible answer.
- **Export** — CSV + Stats API (Phase 5); account deletion is export-then-erase.

### 10.7 Transfers and residency
✅ The EU–US **DPF is valid but contingent**: upheld at first instance (T-553/23, 3 Sep 2025) but
**appealed to the CJEU on 31 Oct 2025 (C-703/25 P)**, and the General Court expressly froze its
analysis at 2023 facts.
▶ So we do not *rely* on it: **EU customers get EU ingest, EU storage and EU-only processing**
(`in-eu.`, §2.4). That makes the transfer question moot rather than argued — and it is the same
tenant-level residency model ✅ Amplitude, PostHog, Mixpanel and Segment all use.
⚠️ Verify where Cloudflare Workers execute for EU traffic, and whether Regional Services is needed.

### 10.8 Platform and content compliance
- ✅ **wp.org Guideline 7** — "Plugins may not contact external servers without *explicit* and
  authorized consent." → ⚠️ **with no local mode this is now the plugin's critical path**: it must ship
  inert and track nothing until the user completes an explicit connect step, disclosed in `readme.txt`. ✅ **Guideline 8** — tracker served locally, not from a CDN, in the plugin.
- ⚠️ **Revise `Bootstrap.php:362`**, which currently asserts data "is never sent to any third party."
- **No PII by contract** — documented prohibition, plus ✅ server-side refusal of card/SSN-shaped
  values (PostHog's approach), and `<input>` values never captured.
- **Children's services** — document that customers must not deploy on child-directed sites without
  their own assessment; we collect no identifiers that would support profiling.
- **CCPA/CPRA** — we sell no data and share none; GPC honoured (§10.5).

### 10.9 Security posture
The collector is unauthenticated and internet-facing, so: size cap before parse (`413`) · schema
validation · rate limits on tenant/actor/IP/global · no secrets in the browser (✅ the public key is a
routing identifier, never a credential) · key rotation (Phase 3) · TLS everywhere · least-privilege
between Worker, queue and ClickHouse · ✅ input sanitisation against buffer-line injection (Koko strips
`[\x00-\x1F\x7F]` specifically so an injected newline cannot forge a record).

### 10.10 ⚠️ Limits of this plan — read this before treating it as compliance sign-off

**This is engineering research against regulator primary sources. It is not legal advice, and it is
not a compliance certification.** Three distinct categories of gap remain, and conflating them is how
teams get surprised late.

#### A. Needs a qualified lawyer, not an engineer — before public launch
| Item | Why it can't come from here |
|---|---|
| **DPA template** | Contract drafting. Art 28 has mandatory clauses; wording matters |
| **DPIA** (if required) | Requires a formal necessity/proportionality assessment for *your* processing |
| **CNIL self-assessment attestation** | ✅ CNIL explicitly warns "l'auto-évaluation… ne préjuge pas de l'analyse que la CNIL pourra en faire" — a wrong self-assessment is worse than none |
| **Terms of Service + Acceptable Use Policy** | Not drafted, not in any phase until now |
| **Controller/processor boundary in edge cases** | e.g. who is controller for the bot-score we generate? |
| **Liability caps, insurance, breach indemnity** | Commercial/legal |

#### B. ⚠️ Verification items — known unknowns, answerable by us
The eight Cloudflare items in §2.4, **plus**: where Workers physically execute for EU traffic and
whether Regional Services is required for an EU-only claim (§10.7). ▶ All are Phase 0. None change the
architecture; they change what we may truthfully claim.

#### C. Jurisdictions this plan has NOT researched
⚠️ **Coverage so far is EU/EEA (GDPR + ePrivacy), France (CNIL), and a light pass on CCPA/CPRA.**
Not researched at all:

| Jurisdiction | Why it may matter |
|---|---|
| **UK GDPR + PECR** | Post-Brexit divergence; PECR has its own cookie rules and ICO guidance |
| **Switzerland (revFADP)** | Separate adequacy and representative requirements |
| **Other US states** | Virginia, Colorado, Connecticut, Texas, Oregon and more now have live laws with differing opt-out and UOOM signal duties |
| **Brazil (LGPD)** | Requires a local DPO in some readings |
| **Canada (PIPEDA, Quebec Law 25)** | Law 25 has explicit consent and transfer-assessment duties |
| **India (DPDP Act)** | Consent-manager regime, data-fiduciary duties |
| **China (PIPL)** | Cross-border transfer approvals; likely a "don't sell there" decision |
| **Australia, Japan, South Korea** | Each has its own notice/consent shape |

▶ **Recommendation: pick target markets explicitly in Phase 0** and research only those. "Global from
day one" is the expensive answer and nobody actually needs it at launch. The architecture already
supports the hard part (regional isolation, §2.4).

#### D. Standards and assurance not in the plan until now
- **SOC 2 Type II / ISO 27001** — enterprise buyers will ask; a readiness gap, not a legal one
- **Accessibility (WCAG 2.2 AA)** for the dashboard — and the **European Accessibility Act** if selling
  to EU public sector
- **Cookie-consent obligation in cookie mode** — ⚠️ to be explicit: if a customer enables the opt-in
  first-party cookie identity (§3 of the research), **consent is required** and the strictly-necessary
  exemption argument no longer applies. The UI must say this at the toggle, not in a doc
- **PCI DSS / HIPAA** — not applicable (we take no payment data or PHI), but a stated written position
  saves sales cycles

▶ These are now folded into Workstream B (§9.3) and the checklist below.

### 10.11 Compliance deliverables checklist
| Item | Phase |
|---|---|
| Data-flow map + DPIA assessment | 0 |
| "What we collect, field by field" page | 1 |
| GPC / consent gate in core | 1 |
| DPA template + subprocessor list | **before public launch** |
| Retention enforcement + pruning | 3 |
| DSAR + erasure + export runbook | 3 |
| CNIL self-assessment attestation published | before EU marketing |
| Art 30 records, Art 32 measures, breach runbook | before public launch |
| **Target-market list fixed** (drives which jurisdictions to research) | **0** |
| **Legal review of DPA / DPIA / ToS / AUP** ⚠️ | **before public launch** |
| **Consent warning at the cookie-mode toggle** ⚠️ | 3 |
| Per-jurisdiction research for chosen markets only | before entering each |
| Accessibility (WCAG 2.2 AA) pass on the dashboard | 5 |
| SOC 2 / ISO 27001 readiness assessment | before enterprise sales |
| EU-strict profile + EU region | 9 |

---

## 11. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Blocker lists add our domain | **High / certain** | Accept it. Publish capture rate honestly. Never market evasion. ✅ Proxying is structurally unwinnable |
| ⚠️ `request.cf` geo insufficient | Medium | **Verify in Phase 0.** Fallback: a licensed GeoIP feed at the consumer, country only |
| Cloudflare lock-in | Medium | Keep the collector a **thin, portable function**: parse → validate → enqueue. Nothing CF-specific in the consumer |
| Bot filtering over-blocks real users | Medium | ✅ Plausible's 0/95 can't distinguish good filtering from over-blocking. Log every drop with its reason; make drops auditable and reversible; hold a labelled regression set |
| Shared-IP collapse (CGNAT, offices) | Medium | Inherent to salted-hash identity. ✅ Worsened by Chrome's UA freeze. Document it; offer opt-in cookie mode |
| CNIL vs bot filtering conflict | Medium | ✅ Real and unresolved: CNIL wants IP truncated ≥1 octet, Plausible's filter "will drop the event silently" without the full IP. **Decide consciously in Phase 0**, document the choice, offer a strict-EU mode |
| Spam to the public endpoint | Low→Med | ✅ Origin check (hygiene only — `curl` forges it), URL-host match, per-tenant volume anomaly detection. Only the third survives a motivated attacker |
| ⚠️ **wp.org plugin is inert until connected** | **High** | New with the cloud-only decision. Onboarding friction in the channel where incumbents (Koko, Burst, Independent Analytics) are free and work instantly. Mitigate with a one-click connect reusing existing provisioning rails |
| Every customer is now in our infra | Medium | No local escape hatch → DPA mandatory for every EU customer; retention, storage cost and breach exposure all ours |
| Scope creep into replay/heatmaps | Medium | §1 exclusion table is the contract |

---

## 12. Decisions log & what remains open

### Decided
| # | Decision | Date | Consequence |
|---|---|---|---|
| 1 | **Cloudflare Workers for the collector** | 2026-09-23 | See §2.4. Biggest knock-on: **bot detection splits edge/consumer** because of the CPU budget. Biggest win: geo and datacentre-ASN detection become free |
| 2 | **Cloud only — no local / self-hosted mode** | 2026-09-23 | See below |

#### Decision 2 in detail — what dropping local mode costs and buys

**Removed from scope entirely:** the standalone PHP collector · the buffer-file → `.busy` → cron
aggregation machinery · MySQL rollup schema design · the WP-Cron reliability problem · a bundled GeoIP
database and its licensing question · the dual-backend test matrix. ▶ That is a material simplification
— roughly a whole subsystem, and it closes a known research gap by deleting it rather than solving it.

**⚠️ Two new problems it creates:**
1. **The WordPress plugin can no longer track by default.** ✅ Guideline 7 — "Plugins may not contact
   external servers without *explicit* and authorized consent." So the plugin must ship **inert** and
   send nothing until the user completes a connect step. It is now an onboarding-friction problem in a
   channel where the incumbents — Koko, Burst, Independent Analytics, WP Statistics — are **free, local,
   and work the instant you activate them.** ▶ Mitigate by reusing TailWatch's existing
   provisioning/connect rails so it is one click, not a setup wizard.
2. **No local escape hatch means we are a processor for every customer, with no exceptions.** A DPA
   becomes mandatory for every EU customer; retention, storage cost and breach exposure are all ours.
   ✅ This makes §10's launch gates harder requirements, not softer ones.

**What we give up:** the "your data never leaves your server" claim, air-gapped/intranet deployments,
and the segment of privacy-conscious buyers who will only accept self-hosting. ▶ Defensible — Fathom is
cloud-only and successful — but it means the privacy story now rests on *architecture* (no IP retained,
daily-rotating salted hash, EU-only processing) rather than on *location*. §10 already carries that
weight; it just matters more now.

### Still open
1. **EU-strict mode: ship at launch or Phase 7?** ✅ The unresolved conflict is real — CNIL requires
   the IP truncated by ≥1 octet, while Plausible's own docs say their bot filter "will drop the event
   silently" without the full client IP. Good bot filtering and consent-exemption pull against each
   other, so we may need two enrichment profiles. ▶ I lean: **design for it in Phase 0** (the region
   split in §2.4 is most of the work), **ship it in Phase 7.**
   *Note this is now partly easier: with `request.cf.asn` giving us datacentre detection without the
   IP, the strict profile loses less precision than it would have.*
2. **Free vs paid Cloudflare plan at launch** — depends on the ⚠️ list in §2.4. Not a blocker; it's a
   sizing question answerable in a day.

---

## 13. What is still unresearched

Honest status: research has hit diminishing returns, and nothing below blocks Phase 0 or 1.
- **Dashboard & query layer** — genuinely unresearched, and it's half the product. Timezone handling
  per site is the specific trap (painful to retrofit). *Do before Phase 1's dashboard screen.*
- **Funnels/retention feasibility on rollups** — *before Phase 5.*
- ⚫ **An independent accuracy comparison is impossible** — ✅ no peer-reviewed study exists comparing
  JS analytics to server logs with modern data. This is why §5's capture-rate metric exists: we
  measure ourselves rather than cite others.

Full list and ordering: [research/RESEARCH-BACKLOG.md](research/RESEARCH-BACKLOG.md).
