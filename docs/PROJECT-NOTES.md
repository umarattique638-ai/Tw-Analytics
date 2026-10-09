# PROJECT-NOTES

Working notes made by reading PLAN.md (957 lines, sections 1-13) and BUILD-ORDER.md (321 lines, Parts 1-6)
line by line. Both documents are copied next to this file and are the source of truth. If this file and
them disagree, they win, and this file gets fixed.

The assistant keeps no memory between chats. Upload this file (and the two documents) at the start of any
new chat. Update the status boxes in section 17 after every stage.

Markers (same as the plan): VERIFIED = checked in research/ or in practice | JUDGMENT = a call someone must defend |
VERIFY = not yet checked, do not assume.

---------------------------------------------------------------------------------------------------------

## 0. How we work (rules for every session)

1. One stage at a time, in BUILD-ORDER order. No stage is started until the previous "Done when" is true.
2. Every stage ends with a test that passes, not "feels done".
3. Build each layer so it can be tested WITHOUT the layer above it (BUILD-ORDER Part 2).
4. Do not build authentication first. Hardcode one tenant through Stage 4.
5. packages/contract is the single definition of the wire format. Nobody re-declares a field.
6. Never put secrets (passwords, API keys) in chat or in files. Cloudflare secrets via `wrangler secret put`.
7. Anything not verified is written as VERIFY, never as fact.
8. When the documents are silent or contradict each other, stop and decide on purpose (section 15), then write the decision down.

---------------------------------------------------------------------------------------------------------

## 1. The product (PLAN section 1)

- Platform-agnostic, cloud-only web analytics. Four install surfaces: script tag, npm package, framework adapters, CMS plugins. One hosted collector behind all of them.
- DECIDED 2026-09-23: no local / self-hosted mode. Consequence: the WordPress plugin ships inert and sends nothing until an explicit connect step (wp.org Guideline 7).
- Positioning: "Analytics that tells you the truth about how many humans visited, and shows you its own margin of error."
- Why: coverage is unwinnable (filter lists, consent law, browser storage policy, ~9% beacon floor). Precision is cheap to win (GA4 counted 95 of 95 synthetic Puppeteer sessions as human). We compete on precision and honesty, never on capture rate.

NOT building (scope contract):
| Not building | Why |
|---|---|
| Ad-blocker evasion / CNAME cloaking | Unwinnable; the harder you obscure the closer to legal "covert tracking" |
| Canvas / audio fingerprinting | Highest ePrivacy Art 5(3) risk |
| City-level geo claims | MaxMind own figure: 66% (US cities, 50 km), Hong Kong 29% |
| Session replay / heatmaps | Different product, worse privacy optics |
| Reporting-time sampling / thresholds | GA4's biggest complaint |
| Cross-site / cross-device identity | Needs the tracking we position against |

---------------------------------------------------------------------------------------------------------

## 2. The stack (PLAN 2.1) - exactly as written

| Layer | Choice |
|---|---|
| Tracker | TypeScript, zero deps, esbuild -> IIFE (CDN) + ESM/CJS (npm). Budget <= 3 KB wire (Plausible: 1,361 bytes) |
| Collector | Cloudflare Workers. Only job: ack in < 5 ms, then enqueue |
| Queue | Cloudflare Queues |
| Consumer / enrichment | TypeScript Worker (queue consumer) |
| Event store | ClickHouse. Adopt Plausible's events_v2 / sessions_v2 shapes from day one |
| Control plane | **MongoDB** (tenants, sites, keys, billing refs). OWNER DECISION 2026-10-05: replaces the Postgres written in PLAN 2.1 / BUILD-ORDER. See 2b |
| Session hot store | **Cloudflare Durable Objects (SQLite)**, one per site, TTL 30 min. DECIDED 2026-10-07 (STAGE-1 D4): free Cloudflare features only, Redis is not on Cloudflare |
| Geo | Cloudflare request.cf.country (VERIFY availability/accuracy) |
| Bot filtering | Ported Matomo bots.yml (843 regexes, 78 AI crawlers) + datacentre ASN + edge signals |
| Dashboard | React, reuse TailWatch's existing admin-app patterns |
| Query API | One REST API serving wp-admin + cloud dashboard + mobile app |

- One event store, one code path, one schema (2.2). WP Statistics died at 4M rows / 12.5 s queries with one MySQL row per hit; Plausible went 5 s -> < 1 s moving to ClickHouse.
- 2.3: TypeScript from tracker to dashboard; PHP only in the WordPress plugin.
- NOTE: the documents say Postgres; the owner chose MongoDB on 2026-10-05 (section 2b). Redis and R2 stay as the documents say.

## 2b. Decision: MongoDB + ClickHouse (owner, 2026-10-05) and what it changes

The former Postgres references in PLAN / BUILD-ORDER are now MongoDB (PLAN 2.1, 3.1 step 4 and the diagram, BUILD-ORDER Part 1 steps 1-2, Stage 0 provisioning, Stage 1 item 3, Stage 3), read "MongoDB". The hot path is unchanged: MongoDB gets ZERO writes per event, quota counters are rolled up periodically.
Consequences, all to be handled in Stage 1 / Stage 5:
- The MongoDB driver needs raw TCP, so it cannot run inside a Cloudflare Worker. apps/api (query + control-plane REST) is a NODE service on a normal host. The collector is unaffected: it only reads KV, which the API fills on every site/key change.
- Signup writes user + tenant + membership in several documents: use a TRANSACTION, which needs a replica set. Atlas clusters are replica sets (VERIFY free-tier limits and region before choosing a plan).
- No foreign keys: deleting a tenant or site must cascade in code (memberships, sites, event definitions). Test it.
- ClickHouse needs UInt64 site_id, so the site id is a number from a counters collection (findOneAndUpdate with $inc). The public key stays the text tw_pub_ + 32 random chars.
- Keys live inside the site document so rotation (add new, revoke old) is one atomic single-document update; several keys may be active so rotation has no downtime. Revoked keys are removed from KV.
- Case-insensitive unique email/username via collation (strength 2). Validate shapes with $jsonSchema validators.
- Billing: the payment provider stays the source of truth for money; MongoDB only stores references.
- OPEN: where EU tenants' account data (emails) lives, i.e. whether the control-plane cluster must also be in the EU.
- The first attempt had a draft MongoDB schema. It was never run against a real MongoDB. Treat it as a sketch: Stage 1 re-writes it, runs it on Atlas or a local replica set, and tests it.

---------------------------------------------------------------------------------------------------------

## 3. What Cloudflare Workers commits us to (PLAN 2.4)

Free gifts: request.cf.country (no GeoIP licence) | request.cf.asn / asOrganization (datacentre detection) | ctx.waitUntil() (return 204, enqueue after) | Queues | KV (eventually consistent, ~1 min lag is fine) | Cloudflare for SaaS (custom-hostname TLS, makes Tier 2.2 feasible) | anycast edge | static asset serving (lets tw.js default its endpoint to its own origin).

Constraint: hard per-request CPU budget. Matomo device-detector runs thousands of regexes per hit; Plausible wraps UA parsing in 200 ms. Neither fits the edge. Therefore bot detection is split:

- COLLECTOR (edge, cheap, single-digit ms): obvious UA denylist (a few dozen anchored patterns, not 843) | cf.asn in datacentre set | missing/absurd headers | size + shape validation -> 204, then waitUntil(enqueue).
- CONSUMER (no CPU pressure): full bots.yml pass | headless/automation scoring | referrer-spam list (2,348 domains) | behavioural/volume anomaly per tenant | geo + UA-CH enrichment, sessionise, dedupe.
- Rule: the edge drops only what is unambiguous. Everything debatable is decided in the consumer and logged with its reason, because a drop at the consumer can still be counted and shown in the warnings feed; a drop at the edge is invisible.

Lock-in containment: the collector is a pure function with platform bindings injected:
`validate(headers, body, edgeMeta) -> ValidatedEvent | Drop{reason}`. No CF types in the signature. edgeMeta is our own shape that a thin CF adapter fills from request.cf. The consumer, enrichment and query layers never touch a CF API.

EU residency: residency is a property of the TENANT, not the visitor. `in.tailwatch.com` and `in-eu.tailwatch.com` are separate Worker + Queue + ClickHouse stacks, chosen at init(); a tenant key is valid only in its own region. Works with plain Workers.

The 8 Cloudflare unknowns (PLAN 2.4 / BUILD-ORDER Stage 1 item 7). Answers below were read from Cloudflare docs on 2026-10-02 in an earlier session. Limits change: re-verify the numbers before sizing, and record source + date.
| # | Question | Answer then |
|---|---|---|
| 1 | request.cf fields | asn, asOrganization documented on all plans; country documented; botManagement is an object |
| 2 | CPU per request | Free 10 ms; Paid default 30 s, max 5 min; typical Worker ~2.2 ms. Per-isolate regex compile cost NOT documented: measure |
| 3 | Queues | message 128 KB; consumer batch 100; sendBatch 100 msgs or 256 KB; 5,000 msg/s per queue; retention 14 days; 250 concurrent push consumers; consumer CPU 30 s default |
| 4 | Bundle size | Free 3 MB, Paid 10 MB |
| 5 | botManagement worth its cost | NOT verified. Plan: skip, use our own consumer scoring |
| 6 | Subrequests | Free 50/request, Paid 10,000 (older docs said 1,000); KV and Queue calls count |
| 7 | ClickHouse from a Worker | HTTP works (official @clickhouse/client-web supports Workers). In practice a plain fetch to port 8443 worked on 2026-10-02 |
| 8 | Cloudflare for SaaS | 100 custom hostnames included on Free/Pro/Business, then $0.10 per extra per month, max 50,000; wildcard custom hostnames Enterprise only |
| extra | EU-only processing | Regional Services for Workers applies only to a Workers Custom Domain with a region and regionalises execution only. Until confirmed, claim EU STORAGE only |

---------------------------------------------------------------------------------------------------------

## 4. Architecture and the write path (PLAN 3, 3.1)

Flow: tw.js (<= 3 KB, async, in head) -> POST text/plain -> Worker /e (validate, 204 < 5 ms, then enqueue) -> Queue -> Consumer (enrich: bot, geo, UA, referrer; sessionise; dedupe) -> ClickHouse (events + sessions + AggregatingMergeTree rollups); Redis (sessions) and MongoDB (control) on the side -> Query API (REST) -> cloud dashboard, wp-admin, mobile app.

Write path, in this exact order:
1. EDGE COLLECTOR: reads only, never writes. KV GET site:{tw_pub_*} (live? domains? flags?) -> 204 -> ctx.waitUntil(Queue.send(event)).
2. QUEUE: batched delivery.
3. CONSUMER, one batch, this order:
   - (a) R2 PUT raw/{date}/{hour}/{uuid}.ndjson. ARCHIVE FIRST, the untransformed batch, before any enrichment. If (b)-(e) crash or a bug ships, this is the only thing that saves us (Snowplow model).
   - (b) enrich in memory: bot, country, UA, referrer, normalise URL. Drop decisions recorded WITH REASON.
   - (c) Durable Object (SQLite, STAGE-1 D4) load of sess:{site}:{visitor_hash} (TTL 1800 s) and 7-day de-dup markers, one call per state shard; committed LAST together in one transaction. (PLAN said Redis; free-only rule.)
   - (d) ClickHouse INSERT INTO events, BATCH only. Use async_insert=1, wait_for_async_insert=1. Idempotency: insert_deduplication_token = batch id. TRAP: a column with DEFAULT now() makes block dedup silently do nothing.
   - (e) ClickHouse INSERT INTO sessions, two rows per mutation, VersionedCollapsingMergeTree: old state sign=-1, new state sign=+1 (PostHog used ReplacingMergeTree and calls it a mistake).
   - (f) ROLLUPS: no code. Materialized views on events write into AggregatingMergeTree targets with uniqState(visitor_hash) on insert, uniqMerge on read.
4. MONGODB: NOT in the hot path. tenants, sites, users, teams, keys, billing, saved reports. Quota counters written periodically (rolled up), never per event. One MongoDB write per event would recreate the bottleneck we avoided.
5. READ PATH: Query API -> ClickHouse rollups (fast path) -> raw events (ad-hoc/segments only) -> MongoDB (site name, timezone, settings, permissions).

Writes per event: KV = 1 read (cached) | Queue = 1 write | R2 = 1 per BATCH | Redis = 1 read + 1 write | ClickHouse = 1 row inside a batch | MongoDB = 0.
Why archive first: everything after it is recoverable; without it an enrichment bug is permanent data loss.
"No store holds an IP address. It exists only in the consumer's memory during (b)/(c)." See section 15 item 2: this conflicts with (a).

---------------------------------------------------------------------------------------------------------

## 5. The 13 non-negotiable invariants (PLAN 4) - every one is a review gate

1. The collector never touches a database.
2. Respond 204 in < 5 ms. The contract is "I received bytes", not "this is durable".
3. Never one row per hit, queried live.
4. Content-Type: text/plain, always. application/json forces a preflight that cannot complete during page unload.
5. Never register unload or beforeunload (they disable bfcache; ~82.9% vs ~91% delivery for pagehide + visibilitychange).
6. Tenant key goes in body or query string, never an Authorization header (not CORS-safelisted -> preflight per event).
7. The wire format is append-only forever. Add optional fields; never rename, never re-type, never tighten validation.
8. Respond identically whether a hit is accepted or dropped (reason in a header). The endpoint is not a tenant-existence oracle.
9. The tracker sends its own version on every hit.
10. De-dupe route changes in core, never in adapters (one normalise-and-compare guard).
11. Exactly one of {script auto-init, framework adapter} emits the first pageview.
12. Discard the raw IP immediately after enrichment. Never a column, never a log line.
13. Size budget <= 3 KB wire, enforced in CI. The build fails, not a warning.

---------------------------------------------------------------------------------------------------------

## 6. Metric definitions (PLAN 5) - frozen before any code, documented, stable

| Metric | Definition |
|---|---|
| Visitor | hash(daily_salt + ip + user_agent + site_id). Salt rotates daily; previous salt kept 48 h so sessions crossing midnight survive |
| Session | 30 min inactivity. No midnight split. No campaign split |
| session_id | The session-start unix timestamp (sortable, derivable, nothing stored) |
| Engaged session | > 10 s visible, OR >= 1 custom event, OR >= 2 pageviews |
| Bounce rate | 1 - engaged_sessions / sessions. Derived, never primary |
| Time on page | Accumulated visible AND focused time (visibilityState and document.hasFocus()), shipped with the next event or the hide-flush |
| Unique visitors | Exact within a day. Multi-day: HLL, labelled "Estimated" |
| Pageview | One per committed navigation, after URL normalisation + de-dup. Normalise: lowercase host, trailing-slash policy, query allow-list, strip fragment |
| route vs path | Store BOTH: template (/blog/[slug]) and actual URL. Without the template, dynamic routes shatter (GA4 "(other)") |
| Capture rate (differentiator) | received_sequence_numbers / expected, per site per period, SHOWN IN THE UI |

Timezone model (Phase 0 / BUILD-ORDER step 2): store UTC everywhere, render per-site timezone, ask for the timezone at site creation, decide day-boundary semantics now. Hourly rollups so any timezone (incl. DST) can be re-bucketed at read time.

---------------------------------------------------------------------------------------------------------

## 7. Event model (PLAN 6)

One model: an event is a name plus up to 25 properties. A pageview is an event.
- Tier A (always on, Phase 1-2): pageview | session_start (derived server-side from a flag, zero extra beacons) | first_visit (derived from a flag) | engagement (visible AND focused ms, shipped with next event or hide-flush). Together: pageviews, sessions, new vs returning, engaged sessions, bounce, time on page from ONE beacon per navigation.
- Tier B (automatic, opt-in per site via data-* flag, Phase 5 except vitals): scroll 25/50/75/90 | outbound_click | file_download (extension list + path patterns) | site_search (params q,s,search,query,keyword + path patterns) | form_start/form_submit | video_* (YouTube, Vimeo, native) | rage_click (>= 3 rapid clicks; copy PostHog's ignore list) | dead_click | js_error | web_vitals (LCP/INP/CLS at hide, Phase 6/8). One build with runtime flags, not a build-time variant matrix. Deliberately NOT shipped: autocapture-everything, clipboard capture, input values.
- Tier C (custom, Phase 5/7): code `tw.track('signup', {...})` | HTML attributes data-tw-event | dashboard rules via remote-config blob. Send-first, curate-after: no pre-registration, appears within seconds. Dashboard-created events are forward-only: say so in the UI.
- Tier D (server-side, Phase 7/9): @tailwatch/node, PHP SDK, raw POST /e. Cannot carry screen, engagement, scroll, routing.
- Rules for every event (6.5): name <= 40 chars [a-z0-9_] | 25 props | key <= 40 | value <= 255 | reserved: tw_* and Tier A/B names | rejection never silent (drop reason to the warnings feed) | server-side refusal of card/SSN-shaped values | warn above ~500 distinct values per property, never key a rollup on one | over quota -> 200 + quota_limited.
- Roadmap (6.6): Phase 1 pageview | 2 session_start, first_visit, engagement | 5 Tier B (not vitals), Tier C, goals | 6 web_vitals | 7 Tier D, funnels.

---------------------------------------------------------------------------------------------------------

## 8. Integration matrix (PLAN 7)

All share one core and one wire contract.
- Tier 1 client JS: 1.1 CDN script tag (default, Phase 1) | 1.2 self-hosted script (3) | 1.3 npm package (3) | 1.4 framework adapter (3) | 1.5 tag-manager template (7). Bundling makes the SCRIPT unblockable but the BEACON stays blockable: say so plainly in docs.
- Tier 2 network: 2.1 same-origin reverse proxy (5) | 2.2 CNAME/custom subdomain, needs TLS provisioning (6) | 2.3 Cloudflare Worker on the customer's zone (6) | 2.4 edge middleware injection (7). CNAME verdict: offer it as a paid convenience for latency and first-party cookies, never market it as evasion (uBO and Brave uncloak; Chrome uBO Lite cannot; Safari caps 7 days; EasyPrivacy lists 893 Plausible customer hostnames). DNS alone cannot do analytics.
- Tier 3 server-side: 3.1 Node SDK | 3.2 PHP SDK | 3.3 direct POST /e (Phase 1, same endpoint) | 3.4 server log import as a RECONCILIATION view, not "more accurate" (Phase 7/9).
- Tier 4 no-JS: 4.1 pixel GET /e.gif?... (email, RSS, noscript, AMP) | 4.2 noscript companion | 4.3 AMP pixel only. One extra route on the collector.
- Tier 5 platform plugins: zero tracking logic, settings UI + script tag. WordPress Phase 4 (matrix) / Phase 6 (roadmap); no exceptions.
- Decision tree (7.1): Cloudflare on your domain -> 2.3 | build step -> 1.4 (+ 2.1) | CMS we support -> Tier 5 | otherwise 1.1 | no browser -> 3.x | true denominator -> add 3.4.

---------------------------------------------------------------------------------------------------------

## 9. Runtime behaviour (PLAN 8) - the spec tracker and collector are tested against

Client states (8.1):
- Normal pageview: send immediately. JS disabled: nothing (pixel if configured). Script blocked: nothing, counted as loss via the capture-rate gap. Beacon blocked: sequence gap recorded on the next successful hit.
- Consent unknown: buffer in memory, send nothing. Granted: flush. Denied: discard (default = GA4 "Basic"; optional identifier-free count if the site opts in).
- prerender: defer until visible. bfcache restore: pageview on pageshow + persisted. Tab hidden: stop engagement timer, flush. Visible but unfocused: stop the timer.
- SPA route change: one pageview after normalise + de-dup + ~50 ms debounce. Hash-only change: pageview iff hashRouting enabled. replaceState: no pageview if normalised URL unchanged.
- Offline: queue, flush on `online`. sendBeacon returns false: halve the batch recursively (floor ~16 KB), then fetch with keepalive disabled. Payload > 32 KB: split or drop with console warning.
- Script loaded twice: second copy is a no-op. localhost/staging: don't send (allow_local opt-in). Iframe: configurable, default off. Opt-out (localStorage flag / ?tw_disable=1): nothing, permanently.

Collector states (8.2):
| Case | Response | Then |
|---|---|---|
| Valid hit | 204, < 5 ms | enqueue |
| Unknown site id | 204 + x-tw-dropped: not_found | drop, never an existence oracle |
| URL host not registered | 204 + x-tw-dropped: hostname | drop, show in warnings feed |
| Bot (UA / ASN / edge signal) | 204 + x-tw-dropped: bot | drop, itemised and auditable |
| Malformed body | 400 | the one case Plausible 400s on |
| Over size cap | 413 BEFORE parsing | - |
| Rate limited | 429 + Retry-After | client should retry |
| Over plan quota | 200 + {quota_limited:[...]} | in-band so SDKs don't retry |
| Duplicate insert_id (7 days) | 204 | drop silently |
| Queue unavailable | 204 to the browser; spill to a durable buffer | browser never sees internals |
| Unknown future field | accept and store | append-only |
| Clock skew | corrected = received_at - (client_sent - client_created) | Segment/Snowplow/PostHog converged |
| Timestamp > 72 h old | accept, flag as backfill | don't silently clamp like GA4 |

---------------------------------------------------------------------------------------------------------

## 10. Customer journey (BUILD-ORDER Part 1)

1 Sign up (email+password or OAuth; creates a tenant document in MongoDB; no analytics infra touched).
2 Add site (they type example.com; NO DNS): MongoDB insert into sites (tenant_id, domain, timezone, public_key) with public_key = 'tw_pub_' + 32 random chars; Workers KV PUT site:tw_pub_xxx = {domain, allowed_hosts[], flags, plan, region}. Ask the timezone at creation. Derive allowed_hosts generously (apex, www, all subdomains).
3 Choose install method; dashboard shows the PLAN 7.1 tree and the exact snippet: script tag `<script async fetchpriority="low" src="https://cdn.tailwatch.com/tw.js?id=tw_pub_xxx">`; npm `import { init } from '@tailwatch/browser'; init({ site })`; framework block with autoPageview:false where the router already fires on mount (SvelteKit afterNavigate, Astro astro:page-load); WordPress: install, paste key, connect (inert until connect).
4 Install: customer's job; UI shows "waiting for your first pageview...".
5 Verify (do not skip). Passive: any event for this public_key in the last 30 min. Active: fetch the site with UA `TailwatchVerifier/1.0` and report exactly which failed: unreachable | snippet not in page source (cache?) | id mismatch | script URL blocked (CSP script-src) | snippet inside <noscript> or commented out | snippet present twice (Next.js double-load). The verifier UA must be on the bot denylist from day one (drop reason verification_agent) or it inflates the customer's numbers.
6 Data flows: first beacon -> 204 -> queue -> consumer -> ClickHouse -> dashboard, visible within 10 seconds. That moment is the whole onboarding experience.

---------------------------------------------------------------------------------------------------------

## 11. Build order, stage by stage (BUILD-ORDER Part 2)

Stage 0 - Accounts, repo, infra (days). Provision: Cloudflare (Workers, Queues, KV, R2; CF for SaaS later) | domains cdn. in. app. api. | ClickHouse | MongoDB replica set | Redis | GitHub + CI. Repo = pnpm monorepo: packages/{core, browser, react, next, vue, svelte, contract}, apps/{collector, consumer, api, dashboard}, infra/. contract is the keystone. DONE WHEN: pnpm build passes, CI runs, wrangler dev serves a hello-world Worker.

Stage 1 - The contract (NO runtime code). Write, review, freeze: (1) wire contract v1, every field/type/limit/optionality | (2) ClickHouse DDL: events, sessions, first rollup MV, adopting Plausible's verified shapes | (3) MongoDB control-plane schema: tenants, sites, users, memberships, embedded keys, counters | (4) URL normalisation rules | (5) metric definitions | (6) fixture corpus, ~50 hand-written payloads incl. every malformed case | (7) answer the eight Cloudflare unknowns. DONE WHEN: two people independently compute the same session count from the fixture file. Do not skip this to "start coding".

Stage 2 - Collector (first real code). Worker only: POST /e -> validate -> 204 -> ctx.waitUntil(queue.send()). KV site config with a hardcoded seed for one test site. No auth, dashboard or tracker. Inside the stage: size cap -> parse -> KV lookup -> host check -> cheap bot reject -> respond -> enqueue. Plus GET /e.gif and OPTIONS. Test with curl, then replay the whole fixture corpus and assert every PLAN 8.2 status. DONE WHEN: every fixture returns its specified code | p99 < 20 ms | malformed input never 500s | messages land in the queue.

Stage 3 - Storage + consumer. ClickHouse and MongoDB schemas applied. Consumer in PLAN 3.1 order: R2 archive first, enrich, Redis session, batched ClickHouse insert, session rows, rollup MVs. Traps now: never single-row INSERT (parts_to_throw default 300); set insert_deduplication_token explicitly. Test: push fixtures straight into the queue, bypassing the collector, SELECT * FROM events and diff. DONE WHEN: fixtures in -> correct rows out | rollup MVs match a raw GROUP BY | replaying the same batch twice produces no duplicates | R2 holds the raw file. The pipeline is then end-to-end with zero frontend code: THE milestone (a curl producing a correct ClickHouse row, not a screenshot).

Stage 4 - Tracker. packages/core + packages/browser + CDN IIFE build. Order: config resolution (query param -> data-* -> defaults) -> idempotency guard -> payload -> transport (fetch text/plain keepalive -> sendBeacon on hide) -> engagement accumulator -> sequence counter -> consent gate -> SPA route detection (Navigation API + fallback) -> bfcache pageshow. Size budget enforced in CI from the first commit. DONE WHEN: a real page on a real domain produces correct rows | tracker <= 3 KB | a Next.js App Router app, a Vite SPA and a hash-router app each record exactly one pageview per navigation including the first, and survive React StrictMode in dev.

Stage 5 - Control plane + onboarding. Auth | tenants | sites (with timezone) | key issue and rotation | KV sync on write | the verifier | snippet generator. DONE WHEN: a brand-new user can sign up, add a site, copy a snippet, install it, pass verification and see their first pageview, unaided, with no one touching a database.

Stage 6 - Dashboard. Query API over rollups -> React. First screen: pageviews over time, top pages, referrers, countries, plus the capture-rate readout and the drop-reason warnings feed. DONE WHEN: every number is reproducible from a documented query and correct across a DST boundary.

Stage 7 - Precision (PLAN Phase 2, before any new features). Full 843-regex bots.yml pass in the consumer, datacentre ASN, headless scoring, referrer spam, sessionisation hardening, insert_id dedupe. DONE WHEN: Plausible's Puppeteer test scores 0 of 95 (GA4: 95/95) and every drop is itemised and attributable.

Dependency graph: 0 -> 1 -> {2 collector, 3 storage+consumer in parallel} -> 4 tracker (needs a live collector) -> 5 control plane (needs the data model settled) -> 6 dashboard (needs data) -> 7 precision (needs volume).
Parallel from Stage 2: fixture corpus + bot regression set | "what we collect, field by field" page | DPA / legal track (long lead time).

Environments: local = wrangler dev + Docker ClickHouse/MongoDB replica set/Redis | staging = in-staging. with separate DB | prod = in. Day-one frictions: sendBeacon/keepalive behave differently on http://localhost, so test the transport against staging over HTTPS; add an allow_local flag; tracker testable headless (logic) and in real browsers (incl. Safari < 26.2 for the Navigation API fallback).

First two weeks: day 1-2 Stage 0 | 3-5 Stage 1 | 6-8 Stage 2 | 9-12 Stage 3 | 13-14 milestone, then Stage 4.

Five sequencing mistakes: auth first | dashboard first | tracker first | skipping the contract | deferring the size budget (GA4's 151 KB).

---------------------------------------------------------------------------------------------------------

## 12. Roadmap phases and how they map to stages (PLAN 9)

| PLAN phase | Content | Exit test | BUILD-ORDER stage |
|---|---|---|---|
| 0 Specification | metrics, events, wire contract, DDL, URL rules, public-key threat model, CF list, edge/consumer split, regions, timezone model, retention model, browser support floor, DPIA data-flow map, target-market list | two people compute same sessions; every CF warning has a verified number + source | 0-1 |
| 1 Vertical slice + minimal tenancy | tracker -> Worker -> Queue -> Consumer -> ClickHouse -> one dashboard screen; signup/login, create site, issue tw_pub_*, snippet verification | real site shows correct numbers for 48 h; tracker <= 3 KB; p99 < 20 ms; capture-rate readout works; new user onboards unaided | 2-6 |
| 2 Precision | full bots.yml, datacentre ASN, headless scoring, referrer spam, sessionisation (Redis), engagement, insert_id dedupe (7 days), drop-reason warnings feed | Puppeteer 0 of 95; every drop itemised; labelled regression corpus passes | 7 |
| 3 Product shell | teams + roles (owner/admin/viewer), invites, multi-site, key rotation/revocation, plans + quota enforcement, billing + dunning, retention pruning, export-then-erase, audit log | sign up, pay, invite, rotate key, hit quota, delete account with data provably gone | after 7 |
| 4 SPA + packages | @tailwatch/core + browser + adapters, Navigation API + monkey-patch fallback, single de-dup guard, bfcache | Next App Router, Vite SPA, hash-router: exactly one pageview per navigation incl. first, StrictMode-safe | core+browser inside Stage 4; adapters after |
| 5 Reporting depth | ranges, comparisons, realtime, segments, device/browser/OS, entry/exit, email digests, spike alerts, CSV, shared dashboards, Stats API | every number reproducible from a documented query; DST-correct | after |
| 6 WordPress plugin | inert until explicit connect; Tier 1.1 snippet served locally (Guideline 8); revise Bootstrap.php:362 privacy text | fresh install sends nothing until connect; correct behind full-page cache; wp.org self-audit | after |
| 7 Events, goals, attribution | Tier B flags, Tier C all paths, goals, currency, UTM first/last touch, cardinality guard, cross-domain | no-code event fires with no deploy; > 500-value property warns and is refused as a rollup key | after |
| 8 Web Vitals RUM | LCP/INP/CLS at hide, bfcache nav type, js_error | - | after |
| 9 Migration + reach | GA4 import, server SDKs, GTM, Shopify/Webflow, EU region live, reverse proxy + CNAME, log reconciliation | - | after |

Parallel workstreams (9.3): A Operations (dead-letter queue + replay, raw archive, reprocessing job, SLOs, alerting, staged tracker rollout + kill switch, ClickHouse migration runbook, cost per million events) | B Compliance (section 13) | C Quality (fixture corpus, labelled bot regression set, synthetic traffic generator, load test, cross-browser matrix, list-update pipeline with diff review) | D Docs and launch (install docs per framework, GA4 migration guide, status page, changelog, "what we collect, field by field", wp.org review rounds).
Missing-subsystem audit (9.1) to keep in view: auth/teams/roles | billing/quota | onboarding + verification | retention/pruning | erasure/DSAR | DPA + subprocessor list | reporting beyond one screen | GA4 import | DLQ + replay | raw archive | bot/spam list update pipeline | tracker kill switch/staged rollout | observability + SLOs | per-site timezone | key rotation/revocation | cross-domain/subdomain sites | docs, status page, wp.org cycle.

---------------------------------------------------------------------------------------------------------

## 13. Compliance and security (PLAN 10) - launch gates marked LAUNCH GATE

- Role: we are a data PROCESSOR, the customer is the controller. Needs: DPA for every customer, published subprocessor list (Cloudflare, ClickHouse host, Redis host, email provider), Art 28 terms, Art 30 records, Art 32 measures, Art 33/34 breach notice within 72 h. LAUNCH GATE: an EU customer cannot lawfully buy without a DPA.
- ePrivacy Art 5(3) (EDPB Guidelines 2/2023 v2.0): pixel distribution is storage via caching (para 50); distributing JS is the instruction / gaining of access (51); locally produced info is still in scope (53); IP-only tracking is in scope (54-55); consent is not systematically required (56). We NEVER claim "no cookies means no consent needed"; we claim we are designed to meet the strictly-necessary exemption criteria and publish the self-assessment.
- CNIL (self-assessment since 4 July 2025; never claim "certified"/"validated"): sole purpose audience measurement of that site (visitor hash salted per site) | marketing-adjacent disabled by default (Tier B opt-in) | IP truncated by >= 1 octet (CONFLICT, below) | no cohorts | no reuse of data, no data sales.
- The unresolved conflict (10.4): CNIL wants the IP truncated; Plausible's bot filter drops silently without the real IP. Resolution: request.cf.asn gives datacentre detection without keeping the IP. Two profiles: Standard (full IP used transiently in memory for the salted hash and threat lookup, then discarded; never a column or log line) and EU-strict (IP truncated before any use; ASN detection kept; precision loss disclosed). Design in Phase 0, ship in Phase 7 (open decision 1).
- Consent: we integrate with CMPs, we do not ship one. Three-state gate in core (unknown buffers, granted flushes, denied discards). Honour Sec-GPC: 1 (and optionally DNT) at the collector as a HARD DROP. No dark-pattern consent UI.
- Data subject rights: minimisation (tracker sends no UA and no IP; server already has both) | retention enforced by a pruning job (GA4 caps at 2 or 14 months; beating that is a selling point) | erasure: usually nothing to erase, say so with evidence | export: CSV + Stats API; account deletion is export-then-erase.
- Transfers: EU-US DPF is valid but contingent (T-553/23 upheld; appealed C-703/25 P). So we do not rely on it: EU customers get EU ingest, EU storage, EU-only processing (in-eu.). VERIFY where Workers execute for EU traffic and whether Regional Services is needed.
- Platform: wp.org Guideline 7 (no external contact without explicit consent) and 8 (tracker served locally); revise Bootstrap.php:362 ("never sent to any third party"); no PII by contract + server-side refusal of card/SSN-shaped values; children's services: customers must assess themselves; CCPA/CPRA: we sell/share nothing, GPC honoured.
- Security posture (collector is unauthenticated and internet-facing): size cap before parse (413) | schema validation | rate limits on tenant/actor/IP/global | no secrets in the browser (public key = routing id, never a credential) | key rotation | TLS everywhere | least privilege between Worker, queue, ClickHouse | strip [\x00-\x1F\x7F] from strings so an injected newline cannot forge a record.
- Limits of the plan (10.10): not legal advice. Needs a lawyer BEFORE launch: DPA template, DPIA (if required), CNIL self-assessment attestation, ToS + AUP, controller/processor edge cases, liability/insurance. Jurisdictions NOT researched: UK GDPR + PECR, Switzerland, other US states, Brazil, Canada/Quebec, India, China, Australia/Japan/Korea. Recommendation: pick target markets in Phase 0 and research only those. Also not in plan: SOC 2 / ISO 27001, WCAG 2.2 AA (+ European Accessibility Act), consent obligation in cookie mode (the UI must say it at the toggle), PCI/HIPAA written position.
- Deliverables checklist (10.11): data-flow map + DPIA (0) | "what we collect" page (1) | GPC/consent gate in core (1) | DPA + subprocessors (before launch) | retention + pruning (3) | DSAR/erasure/export runbook (3) | CNIL attestation (before EU marketing) | Art 30/32/breach runbook (before launch) | target-market list (0) | legal review (before launch) | cookie-mode consent warning (3) | per-jurisdiction research (before entering) | WCAG pass (5) | SOC 2 readiness (before enterprise) | EU-strict + EU region (9).

---------------------------------------------------------------------------------------------------------

## 14. Risks, decisions log, unresearched (PLAN 11-13)

Risks (severity): blocker lists add our domain (High/certain: accept, publish capture rate) | request.cf geo insufficient (Medium: verify; fallback a licensed country-only GeoIP at the consumer) | Cloudflare lock-in (Medium: thin portable collector) | bot filtering over-blocks (Medium: log every drop, make drops auditable and reversible, hold a labelled regression set) | shared-IP collapse CGNAT/offices (Medium: document, opt-in cookie mode) | CNIL vs bot filtering (Medium) | spam to the public endpoint (Low-Med: origin check is hygiene only, URL-host match, per-tenant volume anomaly; only the third survives a motivated attacker) | wp.org plugin inert until connected (High) | every customer is in our infra (Medium: DPA mandatory) | scope creep into replay/heatmaps (Medium: section 1 table is the contract).
Decided: 1 Cloudflare Workers for the collector (2026-09-23) | 2 Cloud only, no local mode (2026-09-23).
Open: EU-strict at launch or Phase 7 (lean: design Phase 0, ship Phase 7) | free vs paid Cloudflare plan at launch (sizing question).
Unresearched (13): dashboard + query layer (timezone per site is the trap; do before Phase 1's dashboard screen) | funnels/retention feasibility on rollups (before Phase 5) | independent accuracy comparison is impossible (so the capture-rate metric exists).

---------------------------------------------------------------------------------------------------------

## 15. Places where the documents are silent or disagree - DECIDE ON PURPOSE before the stage that needs it

1. Control plane database: RESOLVED 2026-10-05 by the owner: MongoDB with ClickHouse. PLAN.md and BUILD-ORDER.md now reflect the decision. MongoDB host (Atlas or self-run replica set) remains an infrastructure choice; Stage 1 schema is frozen.
2. RESOLVED 2026-10-07 (STAGE-1 D1, option A). IP vs raw archive (needed Stage 2/3). Section 3.1 says the R2 archive stores the UNTRANSFORMED batch first, and also "no store holds an IP". Both cannot be true if the queue message carries the IP. Option A (used earlier, recommended): the collector computes the salted visitor hash (today's + yesterday's salt) and the IP never enters the queue, R2 or logs. Option B: put the IP in the queue and archive, which breaks invariant 12 and the privacy claim (the plan's own EU-strict profile would then also need truncation before the archive). Decide, then edit PLAN 3.1.
3. RESOLVED 2026-10-07 (STAGE-1 section 1, D10-D12). The wire field names (needed Stage 1). BUILD-ORDER says "wire contract v1 (PLAN 6.5)" but PLAN 6.5 holds the event RULES, not field names. The documents only show s, n, u, q, t in the curl example (site key, name, url, sequence, created time). Every other field name, and the GET /e.gif parameters, must be designed in Stage 1 and then frozen (append-only).
4. RESOLVED 2026-10-07 (STAGE-1 D4): Durable Objects with SQLite, free plan. Session store (needed Stage 3). Plan says Redis; Durable Objects are named as the CF-native alternative. Pick one and a host.
5. RESOLVED 2026-10-07 (STAGE-1 D5): consumer-side from Stage 3. insert_id de-dupe (Stage 7) must happen in the consumer or ClickHouse, not the collector (invariant 1: collector never touches a database), even though PLAN 8.2 lists it as a collector response.
6. Over-quota response (200 + quota_limited) needs the edge to read a per-tenant flag from KV, while MongoDB gets zero per-event writes: quota counters are rolled up periodically and a flag is pushed to KV. Design this in Phase 3.
7. Facts to settle in Phase 0 that no document fixes: target markets, browser support floor, retention per plan, region of the control plane for EU tenants' account data (emails), custom-domain names (cdn., in., app., api.).
8. Dashboard: PLAN 2.1 says reuse TailWatch's existing admin-app patterns; the earlier UI was a static mock with a fake login. Rebuild only at Stage 6.
11. OWNER DECISION 2026-10-07: development and testing use ClickHouse CLOUD (online) and the owner's LOCAL MongoDB (opened in Compass). Settings live in the git-ignored root .env (see .env.example); docs/TESTING.md is the step-by-step test guide; `pnpm verify:stages` runs every Stage 1-3 check against them.
9. OWNER RULE 2026-10-07: use Cloudflare FREE features only (no paid add-ons). Free-plan limits and their consequences: docs/contract/CLOUDFLARE-VERIFICATION.md and STAGE-1 D9. R2 is activated on the account.
10. Drop-reason header (STAGE-1 D2): production sends no x-tw-dropped header (existence oracle); EXPOSE_DROP_REASON="true" only in dev/staging.
12. DECIDED 2026-10-08 (Stage 4, owner: "follow PLAN and BUILD-ORDER, where they are silent do what is best"):
    a. No domain yet (tailwatch.com is not owned). tw.js is served by the collector itself through Workers static assets (free), so the script tag is `https://tailwatch-collector.<account>.workers.dev/tw.js?id=tw_pub_...` and the default endpoint is the script's own origin + `/e`. Moving to cdn./in. later is a DNS + one-line change; `data-api` already overrides the endpoint.
    b. Consent default = granted (PLAN 6.1: Tier A is "always on"). `data-consent="required"` (CDN) / `consent: 'unknown'` (npm) starts in unknown = buffer, send nothing, until `tw('consent','granted'|'denied')` (PLAN 10.5).
    c. Hash routers: opt-in `data-hash` / `hashRouting: true`, carried on the wire as FLAG_HASH_ROUTE (STAGE-1 A4).
    d. The client sends the URL already normalised by the contract's own normalizeUrl, so a non-allowlisted query parameter (often PII: ?email=) never leaves the browser. Referrer: query and fragment stripped on the client too.
    e. `engagement` is sent as its own hit on hide only when >= 1 s is unsent; less is carried on the next hit. Keeps queue ops down (Free plan: 10k/day).
    f. One event per request (the collector takes one payload per body). PLAN 8.1's "halve the batch" is therefore "sendBeacon refused -> fetch without keepalive".
    g. "Real page on a real domain": apps/demo, a static Worker on its own workers.dev host (free), registered as a customer site.
    h. npm package: `api` is required until a domain exists (no default endpoint baked into a package).
13. DECIDED 2026-10-08 (Stage 5, owner: "one backend, single source of truth, served everywhere; follow PLAN and BUILD-ORDER"):
    a. ONE backend: apps/api (Hono, REST, /api/v1) = PLAN 2.1 "one API serving wp-admin + cloud dashboard + mobile app". Every rule lives there: domain normalisation, allowed hosts, keys, KV sync, snippets, verifier; Stage 6 adds the Query API to it. The dashboard (apps/web), the WordPress plugin (Phase 6) and a mobile app are thin clients. Dashboard auth = HttpOnly session cookie; the same session works as `Authorization: Bearer` for non-browser clients.
    b. Runs on Node for now (it must reach the owner's local MongoDB, which a Cloudflare Worker cannot). Hono also runs on Workers, so moving it later is a deployment change, not a rewrite. Hosting decision (and MongoDB Atlas vs self-run) before public launch.
    c. Passwords: scrypt N=2^17 r=8 p=1 (OWASP minimum, Node standard library). Sessions: 30 days, only the SHA-256 of the token is stored. Login answers identically for unknown e-mail and wrong password; per-e-mail rate limit 10/15 min. CSRF: writes must be same-origin JSON.
    d. Not in Stage 5: Google login, password reset and e-mail verification (they need an OAuth app and an e-mail service). The owner's design had the buttons; they are hidden until those exist.
    e. KV sync: MongoDB is written first (source of truth), then KV. A KV failure is reported to the user ("Retry activation") and `pnpm --filter @tailwatch/api resync` rebuilds every KV entry from MongoDB. One KV entry per ACTIVE key; rotation = add key (both work) then revoke old (deleted from KV).
    f. Deleting a site revokes its keys and hides it; collected data stays. Re-adding the same domain restores the same site id (history comes back) with a fresh key and secret.
    g. Site ids from the API start at 101 (counter floor): ids 1 and 2 are the owner's hand-made test sites already in ClickHouse.
    h. Verifier: TailwatchVerifier/1.0 (already an edge drop: verification_agent), fetches only the site's own hosts, refuses private addresses (SSRF), follows up to 5 redirects, reads at most 2 MB. Checks = BUILD-ORDER ⑤ table + CSP. Passive check = events in the last 30 min from ClickHouse via read-only user tw_read; the first pageview sets sites.verifiedAt.
    i. retentionDays for a new site: 395 (13 months), until plans define it (PLAN 10, Phase 3).
    j. The dashboard is the owner's design (apps/web). Stage 5 screens are live; Live traffic / Events / Suspicious / Reports show labelled sample data until Stage 6.
14. DECIDED 2026-10-08 (Stage 6, owner: "everything live, real data, nothing mock"):
    a. The Query API is part of the one backend: /api/v1/sites/:id/stats/{overview,live,events,drops}, /export.csv, /allowed-hosts. Every number comes from a named query in apps/api/src/stats.ts; docs/QUERIES.md lists them verbatim (a test fails if they differ), so any number can be re-run in the SQL console.
    b. Days are the SITE's local calendar days: ranges are [local midnight, next local midnight) turned into UTC by ClickHouse (toDateTime64(..., tz)); charts bucket with toDate/toStartOfHour(..., tz). A DST day has 23 or 25 hours (proven on Europe/London, end of BST 2026).
    c. Ranges: Today (per local hour), Last 7 days, Last 30 days (per local day). KPIs show the change against the previous period of the same length.
    d. Visitors: uniqExact of daily hashes; over more than one day it is an upper bound, labelled "estimated" (STAGE-1 D6). Sessions and bounce from the sessions table with sum(sign) (VersionedCollapsingMergeTree, correct before and after merges). Bounce = 1 - engaged / sessions (PLAN 5).
    e. Capture rate: per visitor, a page load is a run of rising sequence numbers; received = distinct seqs, expected = highest seq; summed. An upper bound (a lost LAST beacon is invisible); fully blocked scripts are never visible (said on screen).
    f. Live: active visitors = distinct visitors with a hit in the last 5 minutes; chart = per minute, last 30 minutes; latest 20 hits of the last 24 h. Polled every 10 s (overview every 60 s), only while the tab is visible.
    g. Traffic channels from the referrer host: Direct / Search / Social / Referral (apps/api/src/stats.ts channelOf).
    h. "Allow" on a hostname drop adds that host to the site's accepted hosts (MongoDB, then KV): its new hits count from then on; past drops stay dropped.
    i. Nothing on the dashboard is sample data. Features not built yet (email digest, alerts, stats API key, public link, server-log comparison, HTML-attribute / dashboard-rule events) are listed as "Coming next" instead of controls that do nothing. The login page's capture-rate illustration is labelled "(example)".
15. DECIDED 2026-10-08 (Stage 7, owner: "follow PLAN and BUILD-ORDER, where they are silent do what is best"):
    a. Lists are DATA, vendored verbatim and pinned to a commit in infra/lists (sources.json, SOURCES.md with licences): Matomo device-detector bots.yml (843 entries, LGPL-3.0-or-later, used unmodified as a separate data file by our server-side consumer), Matomo referrer-spam-list (public domain, ~2,350 domains), brianhama/bad-asn-list (MIT). `pnpm lists:update` fetches upstream, PRINTS THE DIFF for review, regenerates; `pnpm lists:check` (CI) fails if the generated modules drift.
    b. Edge (collector) drops only the unambiguous: UA denylist, the reviewed datacentre ASN set (~730 ASNs, O(1)), and FLAG_AUTOMATION (the browser itself says webdriver). Everything debatable is the consumer's, itemised in dropped_hits: bots_yml:<name>, headless:<signals>, referrer_spam:<domain>.
    c. Never-drop ASNs (asn-overrides.json "never") win over every list: iCloud Private Relay (Akamai 36183/20940/16625, Cloudflare 13335, Fastly 54113), Cloudflare WARP (209242), corporate gateways (Zscaler 53813/62044, Netskope 55256), and three home/business ISPs the upstream list wrongly includes. Real people on those networks must be counted.
    d. Headless scoring (apps/consumer/src/precision/headless.ts). STRONG, one drops: a headless brand in Sec-CH-UA, or the tracker's FLAG_UA_MISMATCH (empty / headless userAgentData brands). UA-vs-hints contradictions (engine, version, platform, mobile) count together as ONE weak signal, because UA-switcher extensions and "view desktop site" modes produce them for real people. WEAK: no Accept-Language, a modern Chrome UA without client hints over HTTPS, bots.yml's catch-all on an otherwise normal browser UA. Two weak signals drop. An independent review (2026-10-08) removed: the 800 px signal (Samsung tablets in portrait), the "UA lacks Chrome" client check (TVs, WebView2/Electron), and quarantine for anything but referrer spam.
    e. Sessionisation hardening: a visitor dropped for REFERRER SPAM is quarantined for the session window (30 min sliding, on the session record), because only the first hit carries the referrer; its later hits are dropped with the same reason. Bot/headless verdicts are recomputed per hit and never quarantined: a visitor hash (IP + UA) can be shared by real people behind one carrier or office address. A tracker retry of a dropped hit is a duplicate (the 7-day insert_id de-dup covers drops too), so drops are not double-itemised.
    h. For the future first-party proxy (PLAN 2.1 Tier 2): it MUST forward Accept-Language and the Sec-CH-UA headers, or every Chrome hit gets two weak signals (no_lang + ch_missing) and is dropped. Add a test when the proxy is built.
    f. Unlike Plausible, the tracker does NOT go silent on automation: it sends the hit flagged, so the site owner sees "Browser driven by automation" in Suspicious activity. Precision without invisibility.
    g. Honest limit: a bot that sets matching UA metadata, hides webdriver and runs from a home IP looks exactly like a person to anyone measuring from outside. PLAN 1: coverage is unwinnable; we compete on precision and say what we cannot see.


16. DECIDED 2026-10-09 (owner: "ok kro" to Render free + MongoDB Atlas free): the dashboard goes online before Phase 3.
    a. One Node service on Render (free) = the same apps/api serving apps/web (render.yaml Blueprint). Not Cloudflare Workers: scrypt needs more CPU than the Free plan's 10 ms and the MongoDB driver does not run there.
    b. MongoDB Atlas M0 (free, 3-node replica set: transactions work). Accounts and sites are copied with their ids (pnpm db:mongo:copy), so site 101 keeps its ClickHouse data and KV entry.
    c. A public (https) server refuses to start without TW_SIGNUP_ALLOWLIST: until Phase 3 (teams, invites, quotas) only the owner can sign up. Login is rate limited per e-mail (10/15 min) and per client address (30/15 min, the proxy-appended last X-Forwarded-For entry). Cookies are Secure on https.
    d. Accepted limits of the free plan: sleeps after 15 minutes idle, ~1 minute cold start; Atlas Network Access 0.0.0.0/0 because Render free has no fixed outbound IP. Move to a paid plan at launch.
---------------------------------------------------------------------------------------------------------

## 16. Lessons from the first attempt (do not repeat)

- A client-controlled timestamp (t or x = 1e300) was accepted by the collector and then crashed the consumer's date conversion, failing a whole batch of up to 100 events. Rule: every client-controlled number gets a bound, and the consumer never throws on one bad message. Under invariant 7 (never tighten validation) the right fix is to ACCEPT, replace the value and add a warning, not to reject.
- Drop records bypassed the rate limiter. The site key is public, so anyone could flood the queue and ClickHouse with junk drops. Rate limit the drop path too.
- With no salt in KV (cron has not run yet) the code fell back to a hard-coded default, making today's visitor hashes brute-forceable. Fail closed: no hit is hashed without a real secret.
- A consumer retry loop with no delay, no max, no dead-letter queue deletes data after the last retry. Configure delay, max_retries and a DLQ from the start (Workstream A).
- A tracker bug threw away accumulated engagement time when the tab was hidden. Tracker logic needs tests against a fake browser, written with the code.
- ClickHouse DDL was written without research/ and never diffed against Plausible's events_v2/sessions_v2. Do the diff in Stage 1 before freezing.
- The default ClickHouse user was used from a Worker. Use a dedicated INSERT-only user.
- No TTL meant retentionDays was a promise nothing enforced. Retention is a Phase 3 deliverable; the schema must allow it from Stage 1.
- Chat turns URLs and file names into markdown links when copied. Type file names and JSON yourself or edit files in the editor.
- Passwords pasted into chat are compromised: reset them. Secrets only via `wrangler secret put`.
- (Stage 3) A de-duplicated ClickHouse insert still fires the materialized view unless the insert sets deduplicate_blocks_in_dependent_materialized_views=1 AND the MV target table has a de-dup window. A replay test on a real server is the only thing that catches this (STAGE-1 A1).
- (Stage 3) A materialized view runs its SELECT with the INSERTING user's rights: an INSERT-only user fails with error 497 until it gets column-level SELECT on the source columns (STAGE-1 A2).
- (Stage 2) Node's fetch sends "user-agent: undici" when none is given; tests of the "missing UA" case must send an empty header. Runtime default UAs are now edge bots (STAGE-1 A3).
- (Owner's Windows run, 2026-10-07) ClickHouse Cloud 26.x prints UInt64 in JSON WITHOUT quotes by default; JSON.parse then rounds a 19-digit visitor_hash (…900 read as …800). Every JSON read of ClickHouse data (tests now, the Stage 6 query API later) must set output_format_json_quote_64bit_integers=1.
- (Owner's Windows run) workerd (Miniflare e2e) crashed at start with an access violation / stack overflow: the known fix is the latest Microsoft Visual C++ Redistributable x64. The CI pipeline job runs the same e2e tests on Linux.
- (Owner's Windows run) the in-process latency unit test gated on p99 and failed at 21.5 ms with a 1.2 ms median while pnpm ran packages in parallel. Unit tests gate on the median; p99 belongs to the deployed Worker.
- (Owner's Windows run) workerd crashed until the Microsoft Visual C++ Redistributable x64 was installed (it was missing entirely) and the PC restarted. After that the collector e2e ran on Windows: fixtures, queue and never-5xx pass. Local latency on a laptop (median +21 ms over a no-op Worker right after reboot) is not a done-when; the deployed Worker's p99 and CPU time are.
- (First real deploy, 2026-10-08) The Workers Rate Limiting binding IS accepted on the Free plan (wrangler 4.148 deployed both [[ratelimits]]): STAGE-1 VERIFY item 2 resolved.
- (First real deploy) A password pasted by hand into `wrangler secret put` did not match tw_insert: every batch failed with clickhouse_http_403:code_516 (authentication) and was retried silently (Errors: 0 in the dashboard). Set secrets from .env with `wrangler secret bulk` instead of typing them.
- (First real deploy) Without Workers Logs enabled the consumer's failure reason is invisible. Both wrangler.toml files now set [observability] enabled = true (Free plan: 200K events/day). `wrangler tail` timed out from the owner's network (ETIMEDOUT to 188.114.96.x); the dashboard Observability tab works.
- (First real deploy) A site written to KV and hit within the same minute is dropped as not_found (STAGE-1 D8). Wait ~60 s after creating a site.
- (Stage 4) Headless Chromium's User-Agent contains "HeadlessChrome" and the edge drops it as a bot, proved in the browser e2e. Browser tests present a normal Chrome UA; a test asserts the headless one IS dropped.
- (Stage 4) Playwright request interception (page.route) sits in the path of sendBeacon during unload and made the engagement beacon flaky (2 of 3 runs lost). The e2e serves tw.js from a small front server instead; no interception anywhere.
- (Stage 4) A `</script>` inside a JavaScript comment inside an inline <script> ends the element early (demo page). Write `<\/script>`.
- (Stage 4 live) The first pageview carried engagement_ms = 1: the millisecond between script start and the first page() call. The first pageview now never carries engagement (tracker v2).
- (Stage 4.5) Next.js 16 dev only hydrates once its HMR websocket connects. Served as next.example.com in the sandbox the websocket got a 403 from outside Next, React never hydrated and nothing was tracked. Framework e2e apps run on *.localhost (Chromium resolves it to loopback itself; Next and Vite accept it by default) with allowLocal on.
- (Stage 4.5) Next.js 16 refuses a second `next dev` in the same folder ("Another next dev server is already running"). Kill the whole process group after a test (Windows: taskkill /T).
- (Stage 4.5) A Miniflare started from another package's folder needs modulesRoot, or workerd fails with "can't use '..' to break out of starting directory".
- (Stage 4.5) A hash router rewrites `/` to `/#/` right after load. Under A4 a missing or plain fragment is the root route `#/`, so that rewrite is not a second pageview.
- (Stage 5) @hono/node-server serveStatic `root` is resolved against the working directory: pass a cwd-relative path, not an absolute Windows path.
- (Stage 6) A query parameter typed DateTime64(3) is read in the SERVER's timezone (chDB in the sandbox ran in Asia/Karachi): "now" must be passed as DateTime64(3, 'UTC'). ClickHouse Cloud runs in UTC, so this would only have shown up elsewhere.
- (Stage 5, owner's run) The verifier counted a snippet quoted inside a JS comment of an inline <script> (the demo root page) as a real one: "different site key" + "script failed". Text inside <script>...</script> is now ignored.
- (Stage 5) Field labels and the password show/hide button both match getByLabel('Password'): tests use exact labels.
- (Stage 5, owner's run) In .env an unquoted # starts a comment: a password `abc#123` was read as `abc` and ClickHouse refused it. Quote such values.
- (Stage 7) Puppeteer's page.setUserAgent() overrides the UA but sends NO client hints at all and leaves navigator.userAgentData with an EMPTY brand list. Server-side, a spoofed "Safari" therefore looks clean; only the page can see it (FLAG_UA_MISMATCH). Playwright's userAgent option instead keeps "HeadlessChrome" in Sec-CH-UA.
- (Stage 7) The engagement beacon a closing page sends goes out after Puppeteer's per-page UA override is gone, with the browser's own "HeadlessChrome" UA: a few hits of every bot round are dropped by the UA denylist instead of the round's main rule. Both are bots; the test allows both.
- (Stage 7) V8 compiles a big regex twice: ~55 ms on the first test, ~26 ms on the second (tier-up to native), then ~0.05 ms. The combined bots.yml regex is run twice at module load so both costs land in Worker startup, not in a batch's CPU budget.
- (Stage 7) Chromium on Linux honours the HTTPS_PROXY environment variable: in the sandbox an https page on *.example.com went to the proxy and was reset. HTTPS browser tests use *.localhost (always direct).
- (Stage 7) Playwright/Puppeteer Chromium says navigator.webdriver = true, which the tracker now flags: suites that stand in for a PERSON launch with the automation markers off (harness HUMAN_BROWSER); the bot suite does the opposite.
- (Stage 1) Stage 2's commit had accidentally truncated docs/contract/STAGE-1.md from 118 to 14 lines. Check `git diff --stat` before committing docs.

---------------------------------------------------------------------------------------------------------

## 17. Status board (edit after every stage)

Accounts / infra (Stage 0):
- [x] Cloudflare account, Workers, Queues, KV usable (workers.dev address in use)
- [x] ClickHouse Cloud service (region il-central-1) - old tables from the first attempt still exist
- [x] R2 activated on the account (bucket tailwatch-raw is created at first deploy)
- [x] MongoDB: owner's local server (Compass), decision 2026-10-07. [x] single-node replica set rs0 (2026-10-08, verify:mongo: transactions available)
- [x] Session store: Durable Objects (SQLite), free plan (STAGE-1 D4)
- [ ] Domains: cdn. in. app. api. (+ in-staging.)
- [ ] GitHub repo with CI running
- [x] Monorepo skeleton: pnpm workspaces, contract package, collector hello world, CI file
- [x] pnpm install --frozen-lockfile, typecheck, test, build all pass locally; wrangler dev serves /health

Stage 0 done-when: pnpm build passes [x] | CI runs [ ] (needs the GitHub repo) | wrangler dev serves hello world [x].

Stage 1 contract: FROZEN 2026-10-07 (docs/contract/STAGE-1.md) [x] wire v1 | [x] ClickHouse DDL (applied to ClickHouse 24.8) | [x] MongoDB schema: verify:mongo 14/14 PASS on the owner's local MongoDB 8.2 (2026-10-07) | [x] URL normalisation | [x] metric definitions | [x] 50 fixtures with exact outcomes | [x] 8 CF unknowns + free-plan limits re-verified 2026-10-07 | [x] two-people sessions test.
Stage 2 collector: DONE 2026-10-07 [x] owner's Windows: e2e fixtures, queue, never-5xx pass on workerd (after VC++ redist) [x] every fixture returns its code (Node + workerd) | [x] never 5xx | [x] messages land in the queue (workerd local Queue) | [x] latency on workerd: collector adds ~3 ms at the median | [ ] real deploy + p99 measured on the deployed Worker
LIVE 2026-10-08: collector + consumer deployed on the owner's Cloudflare Free account (umarattique638.workers.dev), R2 tailwatch-raw, queues tailwatch-events(+dlq), KV SITE_CONFIG, ClickHouse Cloud user tw_insert. First internet hit -> ClickHouse Cloud row (live-test-5/6).
Stage 3 storage + consumer: DONE 2026-10-07 [x] owner's Windows + ClickHouse Cloud 26.6: live 6/6, pipeline e2e 5/5, first row in 2.40 s [x] schema applied to the owner's ClickHouse Cloud 26.6 | [x] live suite on Cloud: sessions/rollup/replay/UInt64 pass (row-equality failure was a test JSON-reading bug, fixed) | [x] fixtures in -> exact rows out (real ClickHouse) | [x] session metrics right inside ClickHouse | [x] rollup = raw GROUP BY | [x] replay -> no duplicates (tokens + Durable Object de-dup) | [x] R2 holds the raw file (workerd) | [x] milestone: HTTP pageview -> ClickHouse row in ~1.1 s | [ ] real deploy (R2 bucket, queues, DO migration, ClickHouse user)
Stage 4 tracker: 4.0 deploy [x] | 4.1-4.3 core + browser + CDN build [x] owner's Windows: all tests pass; LIVE 2026-10-08: tw.js served by the collector, demo site (site 2) -> 16 correct rows in ClickHouse Cloud, seq 1-16 with no gap, no duplicate pageview, engagement on tab switch, signup props | 4.4 adapters [x] @tailwatch/react, @tailwatch/next, @tailwatch/vue, @tailwatch/svelte (svelte: no example app yet) | 4.5 done-when [x] in the sandbox: Next.js 16 App Router (Navigation API and fallback), Vite 8 + React Router 7, Vue + hash router, all in dev/StrictMode: exactly one pageview per navigation incl. the first [ ] owner's Windows run of e2e:frameworks    Stage 5 control plane: DONE 2026-10-08 [x] sandbox: API 40 unit + verifier tests, onboarding e2e in Chromium [x] owner's Windows: typecheck/test/build, live:api 7/7 on local MongoDB rs0, e2e:api 2/2 [x] LIVE done-when: the owner signed up at http://localhost:8788, added tailwatch-demo.umarattique638.workers.dev (site 101), pasted the snippet, verifier 7/7 green, first pageview arrived on the verify screen, dashboard opened. Nobody touched a database.    Stage 6 dashboard: [x] in the sandbox: Query API proven on the ClickHouse engine (chDB 26.9) with known rows incl. DST (10/10), HTTP layer 5, dashboard e2e in Chromium (every page shows the API's numbers; no sample value survives) [ ] owner: live:api against ClickHouse Cloud, then the real dashboard    Stage 7 precision: [x] in the sandbox: labelled regression corpus 64 humans counted / 71 bots dropped, 0 false positives, 0 misses (after an independent false-positive review); ⭐ Plausible's Puppeteer test on workerd + real ClickHouse engine: 0 of 95 sessions counted, 192 of 192 hits itemised (+10 stealth sessions also 0) [x] owner's Windows + ClickHouse Cloud: e2e:precision 0 of 95 (202/202 hits itemised), e2e:collector 20/20, e2e:frameworks 3/3, e2e:api 3/3 [x] LIVE 2026-10-08: consumer + collector (tw.js v3) deployed; bots:live from the owner's PC against site 101: TailWatch counted 0 of 95 sessions, 192 hits dropped with a reason (automation 73, ua_denylist 63, headless:js_ua_mismatch 56). STAGE 7 DONE.
    Extra (owner request 2026-10-08): a second customer site, kept OUTSIDE this repo on the owner's Desktop (kiln-shop): React + react-router-dom shop (BrowserRouter, 4 pages + product detail, wishlist, cart, demo checkout) on Cloudflare static assets (kiln-shop.umarattique638.workers.dev), tracked with the script-tag snippet + tw('track') custom events add_to_cart / add_to_wishlist / checkout.

Leftovers from the first attempt that still exist online. OWNER ORDERED DELETION on 2026-10-05 (delete order: consumer Worker first, then collector, testsite, queues, KV, then the ClickHouse database). Tick when done:
- [ ] Workers: tailwatch-consumer (first: it is still consuming the queue), tailwatch-collector, tailwatch-testsite
- [ ] Queue tailwatch-events (+ tailwatch-events-dlq if it was created), [ ] KV namespace "KV" holding site:tw_pub_test
- [ ] Secret CLICKHOUSE_PASSWORD (goes away with the consumer Worker)
- [ ] ClickHouse database tailwatch (tables events, sessions, dropped_hits, old schema): DROP DATABASE; keep the ClickHouse Cloud service itself
