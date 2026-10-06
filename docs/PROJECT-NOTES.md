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
| Session hot store | **Redis**, TTL 30 min (Durable Objects = the CF-native alternative) |
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
   - (c) Redis GET/SET sess:{site}:{visitor_hash}, TTL 1800 s: new session or continue? engaged yet? pageview count? Plausible serialises per visitor with a 1 s lock timeout, then drops rather than blocking.
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
2. IP vs raw archive (needed Stage 2/3). Section 3.1 says the R2 archive stores the UNTRANSFORMED batch first, and also "no store holds an IP". Both cannot be true if the queue message carries the IP. Option A (used earlier, recommended): the collector computes the salted visitor hash (today's + yesterday's salt) and the IP never enters the queue, R2 or logs. Option B: put the IP in the queue and archive, which breaks invariant 12 and the privacy claim (the plan's own EU-strict profile would then also need truncation before the archive). Decide, then edit PLAN 3.1.
3. The wire field names (needed Stage 1). BUILD-ORDER says "wire contract v1 (PLAN 6.5)" but PLAN 6.5 holds the event RULES, not field names. The documents only show s, n, u, q, t in the curl example (site key, name, url, sequence, created time). Every other field name, and the GET /e.gif parameters, must be designed in Stage 1 and then frozen (append-only).
4. Session store (needed Stage 3). Plan says Redis; Durable Objects are named as the CF-native alternative. Pick one and a host.
5. insert_id de-dupe (Stage 7) must happen in the consumer or ClickHouse, not the collector (invariant 1: collector never touches a database), even though PLAN 8.2 lists it as a collector response.
6. Over-quota response (200 + quota_limited) needs the edge to read a per-tenant flag from KV, while MongoDB gets zero per-event writes: quota counters are rolled up periodically and a flag is pushed to KV. Design this in Phase 3.
7. Facts to settle in Phase 0 that no document fixes: target markets, browser support floor, retention per plan, region of the control plane for EU tenants' account data (emails), custom-domain names (cdn., in., app., api.).
8. Dashboard: PLAN 2.1 says reuse TailWatch's existing admin-app patterns; the earlier UI was a static mock with a fake login. Rebuild only at Stage 6.


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

---------------------------------------------------------------------------------------------------------

## 17. Status board (edit after every stage)

Accounts / infra (Stage 0):
- [x] Cloudflare account, Workers, Queues, KV usable (workers.dev address in use)
- [x] ClickHouse Cloud service (region il-central-1) - old tables from the first attempt still exist
- [ ] R2 bucket (needed for the Stage 3 archive)
- [ ] MongoDB host with replica set (Atlas or local Docker replica set); decision made 2026-10-05
- [ ] Redis or Durable Objects (section 15 item 5)
- [ ] Domains: cdn. in. app. api. (+ in-staging.)
- [ ] GitHub repo with CI running
- [x] Monorepo skeleton: pnpm workspaces, contract package, collector hello world, CI file
- [x] pnpm install --frozen-lockfile, typecheck, test, build all pass locally; wrangler dev serves /health

Stage 0 done-when: pnpm build passes [x] | CI runs [ ] (needs the GitHub repo) | wrangler dev serves hello world [x].

Stage 1 contract: [ ] wire v1 | [ ] ClickHouse DDL | [ ] MongoDB schema | [ ] URL normalisation | [ ] metric definitions | [ ] ~50 fixtures | [ ] 8 CF unknowns re-verified with source + date | [ ] two-people sessions test.
Stage 2 collector: [x] code + tests (43 collector tests, 50-fixture exact replay, curl on local wrangler dev 2026-10-06) | [ ] real queue/KV deploy | [ ] p99 on staging      Stage 3 storage + consumer: [ ]    Stage 4 tracker: [ ]    Stage 5 control plane: [ ]    Stage 6 dashboard: [ ]    Stage 7 precision: [ ]

Leftovers from the first attempt that still exist online. OWNER ORDERED DELETION on 2026-10-05 (delete order: consumer Worker first, then collector, testsite, queues, KV, then the ClickHouse database). Tick when done:
- [ ] Workers: tailwatch-consumer (first: it is still consuming the queue), tailwatch-collector, tailwatch-testsite
- [ ] Queue tailwatch-events (+ tailwatch-events-dlq if it was created), [ ] KV namespace "KV" holding site:tw_pub_test
- [ ] Secret CLICKHOUSE_PASSWORD (goes away with the consumer Worker)
- [ ] ClickHouse database tailwatch (tables events, sessions, dropped_hits, old schema): DROP DATABASE; keep the ClickHouse Cloud service itself
