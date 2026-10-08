# TailWatch Stage 1: Contract Freeze

**Status: FROZEN 2026-10-07.** Wire v1, queue message v1, ClickHouse schema v1 and MongoDB control-plane v1.
From here on every change is **append-only** (PLAN §4 invariant 7): add optional fields, never rename,
re-type or tighten. A change that breaks this needs wire v2, not an edit.

Stage 1 contains no runtime services. The executable form of this document is `packages/contract`
(types, validator, fixtures) and `infra/` (DDL). If this file and the code disagree, the tests decide and
this file is fixed.

---

## 1. Wire v1 (browser / server SDK -> collector)

`POST /e`, `Content-Type: text/plain`, body = one JSON object. `GET /e.gif?…` carries the same fields
(except `p`) as query parameters. The site key travels in the body or query string, never in an
`Authorization` header (invariant 6). Body cap: 32 KiB, checked on the byte stream before parsing (413).

| Field | Type | Limit | Required | Meaning |
|---|---|---:|---|---|
| `s` | string | `tw_pub_` + 32 alphanumerics | yes | site public key (a routing id, never a credential) |
| `n` | string | 1–40, `[a-z0-9_]` | yes | event name |
| `u` | string | 1–2048, http(s) | yes | page URL |
| `q` | integer | 1–4294967295 | yes | per-page-load sequence number (capture rate) |
| `t` | number | finite, > 0 | yes | client **created** time, unix ms |
| `v` | integer | 0–65535 | yes | tracker version (invariant 9) |
| `r` | string | ≤ 2048 | no | referrer; query, fragment and credentials are stripped |
| `e` | integer | 0–86 400 000 | no | engaged (visible **and** focused) ms since the previous event |
| `rt` | string | ≤ 256 | no | route template, e.g. `/blog/[slug]` |
| `w` | integer | 0–100 000 | no | viewport width |
| `i` | string | ≤ 64 | no | insert id (client idempotency key). The tracker always sends it (D12) |
| `x` | number | finite, > 0 | no | client **sent** time, unix ms (clock-skew correction, D10) |
| `f` | integer | 0–255 | no | flags; bit 1 = `FLAG_FIRST_PAGEVIEW` (D7) |
| `p` | object | ≤ 25 keys | no | custom properties: key ≤ 40, value string ≤ 255 / number / boolean |

Unknown fields are accepted and kept (sanitised) in `extra`.

### Property rules (accept-and-warn, never reject the event)
- more than 25 keys: the first 25 are kept, warning `props_truncated:<n>`
- empty / too long / control-char / `__proto__`-like keys: ignored, `prop_key_invalid`
- value over 255 chars: ignored, `prop_value_too_long:<key>`
- nested objects, arrays, null, NaN: ignored, `prop_type_invalid:<key>`
- card-number (Luhn) or SSN-shaped strings: refused server-side, `sensitive_prop_refused:<key>`

Warnings travel with the event to the consumer so the customer can see them (PLAN 6.5: "rejection
never silent").

### Time rules
- `occurredAt = receivedAt − (x − t)` when `x` is present, otherwise `t` (PLAN 8.2).
- More than 5 minutes in the future: set to `receivedAt`, warning `timestamp_repaired_future`.
- Older than 72 h: accepted unchanged and flagged `backfill` (never silently clamped).
- Not storable in ClickHouse (before 1900 / after 2299): repaired to `receivedAt` with a warning.

## 2. Collector outcomes (frozen semantics; HTTP mapping is Stage 2)

| Outcome | Status | When |
|---|---|---|
| accept | 204 | valid; enqueued after the response (`ctx.waitUntil`) |
| drop `not_found` | 204 | unknown, wrong-region or not-live site key (never queued: nothing to attribute it to) |
| drop `hostname` | 204 | URL host not in `allowedHosts` (label-aware wildcard: `*.example.com` ≠ `evil-example.com`) |
| drop `gpc` | 204 | `Sec-GPC: 1` (PLAN 10.5 hard drop) |
| drop `bot` | 204 | missing UA, UA denylist, headless, datacentre ASN |
| drop `verification_agent` | 204 | our own install verifier (`TailwatchVerifier/`) |
| drop `identity_unavailable` | 204 | no per-site identity secret or no client address: never hashed with a default |
| reject | 400 | malformed (error code in the body, e.g. `bad_event_name`) |
| reject | 413 | body over 32 KiB |
| rate_limit | 429 + `Retry-After` | limiter says no |
| quota_limited | 200 + `{"quota_limited":[…]}` | Phase 3 |

No 400 depends on whether the site exists (tested). The collector itself never answers 5xx.

## 3. Queue message v1 (collector -> consumer)

```ts
{ v: 1, type: 'event', event: ValidatedEvent, visitor: { hash, prevHash } }
{ v: 1, type: 'drop',  at, siteId, reason, detail?, country?, asn? }
```
`visitor.hash` / `prevHash` are the decimal UInt64 visitor hashes with today's and yesterday's salt.
**There is no IP in any queue message** (D1). The consumer ignores unknown `v`/`type` values and records
unreadable messages as `consumer_invalid` drops.

## 4. Identity and metrics (PLAN §5)

- Visitor = first 64 bits of `SHA-256(salt ⏎ site_id ⏎ ip ⏎ user_agent)`, as a decimal UInt64 string.
- Daily salt = `HMAC-SHA256(site.identitySecret, UTC date)`. Previous day's salt is also used (48 h
  continuity), so a visit crossing UTC midnight stays one visitor and one session.
- Session: 30 min inactivity (`> 30 min` starts a new one; exactly 30 min does not). No midnight split,
  no campaign split. `session_id` = unix seconds of the session start.
- Engaged: `engagement > 10 s` (exactly 10 s is not engaged) OR ≥ 1 custom event OR ≥ 2 pageviews.
  Automatic events (`scroll`, `engagement`, …) are not custom events.
- Bounce rate = `1 − engaged_sessions / sessions`, derived only.
- Unique visitors: see D6.
- Capture rate: received sequence numbers ÷ expected sequence range (Stage 6 readout).

**Done-when check:** `packages/contract/test/sessions-independent.test.ts` is the "two people" test: a
second implementation written differently (global time order instead of per-visitor sort) must agree with
`sessionise()` on the hand-worked fixture (11 sessions, 5 engaged, 15 pageviews, 9 visitors) and on 300
random streams placed on the 30-minute boundary. The consumer's incremental `advanceSession()` is tested
against the same definition.

## 5. URL normalisation (`normalizeUrl`)
http(s) only · host lower-cased, trailing dot removed · default port dropped, explicit port kept ·
fragment removed · trailing slash removed except for `/` · query reduced to the allow-list
(`utm_source, utm_medium, utm_campaign, utm_term, utm_content, ref, source`) and sorted · path case kept ·
route template stored separately from the actual path.

## 6. Storage contracts
- **ClickHouse** `infra/clickhouse/001_contract.sql`: `events`, `sessions` (VersionedCollapsingMergeTree),
  `dropped_hits` (warnings feed), `rollup_15m_pages` + MV. Applied to a real ClickHouse 24.8 by the
  Stage 3 live tests.
- **MongoDB** `infra/mongodb/001_control_plane.js` (+ `control-plane.schema.json`, kept identical by a
  test): `counters`, `tenants`, `users`, `memberships`, `sites` (numeric `_id` = ClickHouse `site_id`,
  embedded keys for atomic rotation, server-only `identitySecret`). Never written per event.

## 7. Fixture corpus
`packages/contract/fixtures/payloads.ts`: **50 fixtures** — 22 accepted (with exact warnings and fields),
9 dropped (every edge drop reason), 19 rejected (every 400 class + 413). Each states its exact outcome
and is asserted through `validate()` here, over HTTP in Stage 2, and into ClickHouse in Stage 3.
`fixtures/queue.ts` derives the matching queue messages with the real contract functions.

---

## 8. Decisions taken at the freeze

The documents were silent or contradicted each other on these (PROJECT-NOTES §15). Each is decided here.

| # | Decision | Why |
|---|---|---|
| **D1** | The **collector** computes the visitor hashes; the raw IP never enters the queue, R2, ClickHouse or a log. PLAN 3.1's "IP exists only in the consumer's memory" is superseded. | PLAN 3.1 archives the *untransformed* batch first and also says no store holds an IP: only hashing at the edge satisfies both. |
| **D2** | Production responses carry **no `x-tw-dropped` header**. It is only sent when the Worker var `EXPOSE_DROP_REASON = "true"` (local / staging). Drops are visible to the customer in `dropped_hits`. | `not_found` vs `hostname` in a header tells anyone whether a site key exists: exactly the oracle invariant 8 forbids. |
| **D3** | Rollups use **15-minute** UTC buckets. | Every UTC offset is a multiple of 15 min (+5:30, +5:45). Hourly buckets cannot give an exact local day for those sites. |
| **D4** | Session hot store = **Cloudflare Durable Objects (SQLite backend)**, one object per site, holding session state and de-dup markers committed in one transaction. Not Redis. | Owner rule 2026-10-07: Cloudflare free features only. Redis is not part of Cloudflare; SQLite-backed Durable Objects are on the Free plan. PLAN 2.1 names Durable Objects as the alternative. |
| **D5** | De-duplication in the **consumer**, 7 days, key `dedupeKey(siteId, insertId, messageId)`. Plus `insert_deduplication_token` = hash of the batch's message ids on every ClickHouse insert. | The collector never touches storage (invariant 1). Residual risk, documented: a crash after the ClickHouse insert but before the state commit, followed by a redelivery inside a *differently composed* batch, can duplicate those rows. |
| **D6** | Exact unique visitors for a single day come from raw events (`uniqExact`). Rollups use `uniq` and multi-day uniques are labelled **"Estimated"** and are an upper bound. | The daily salt makes the same person a new visitor each day by design. |
| **D7** | `is_first_visit` is written as 0. `FLAG_FIRST_PAGEVIEW` means "first pageview of this page load", not "first visit ever". | New-vs-returning needs client storage, which reopens the ePrivacy question (PLAN 10.2). Decide in Phase 2. |
| **D8** | A new site's first hits can be `not_found` for up to ~60 s (KV propagation and the collector's 60 s `cacheTtl`). Stage 5 onboarding must say "first data can take up to a minute". | KV is eventually consistent; a miss is cached at the edge too. |
| **D9** | **Free plan only.** See the free-plan rows in `CLOUDFLARE-VERIFICATION.md`. Binding consequences: Queues 10 000 operations/day ≈ **3 300 events/day ceiling**; queue retention 24 h (the DLQ must be looked at within a day); 10 ms CPU per invocation, so the consumer batch is 25 messages until measured. | Owner rule 2026-10-07. |
| **D10** | `x` = client sent time (was documented as "reserved numeric extension"; the validator already treated it as sent time). | One meaning only, matching PLAN 8.2's clock-skew formula. |
| **D11** | `v` is required. Missing → 400 `bad_version`. | Invariant 9. Nothing is deployed yet, so this is not a tightening. |
| **D12** | `i` stays optional on the wire (server senders, old clients); the Stage 4 tracker always sends it. | Without it de-dup falls back to the queue message id, which still covers redeliveries. |
| **D13** | The BUILD-ORDER `curl` example (no browser User-Agent) is dropped as `bot` **by design**. Manual tests send a browser `User-Agent`. | Edge bot rule: `curl/` is on the denylist. |

## 9. Amendments after the freeze (append-only)

| # | Date | Change | Found by |
|---|---|---|---|
| **A1** | 2026-10-07 | `rollup_15m_pages` gets `SETTINGS non_replicated_deduplication_window = 1000`, and every consumer insert sets `deduplicate_blocks_in_dependent_materialized_views = 1`. No column changed. | Stage 3 replay test on ClickHouse 24.8: the events table dropped the replayed block but the materialized view re-counted it into the rollup. |
| **A2** | 2026-10-07 | `infra/clickhouse/002_insert_user.sql`: the consumer user needs column-level `SELECT(site_id, timestamp, pathname, visitor_hash, engagement_ms, name)` on `events`, because a materialized view runs with the inserting user's rights. | Stage 3 workerd pipeline test (ClickHouse error 497 with INSERT-only grants). |
| **A3** | 2026-10-07 | Edge UA denylist also catches runtime default User-Agents (`undici`, `node`, `Deno/`, `Bun/`, `okhttp/`, `Java/`, `Apache-HttpClient/`). Bot lists are data, not wire contract. | Stage 2 workerd test. |
| **A4** | 2026-10-08 | New flag bit `FLAG_HASH_ROUTE = 2` in `f`. When set, `normalizeUrl` keeps a `#/route` or `#!/route` fragment (its own `?query` dropped, trailing slash removed) and the stored `path` becomes e.g. `/#/settings`; with the bit, no fragment or a plain `#anchor` is the root route `#/` (a hash router rewrites `/` to `/#/` on load, which must not be a second page). Without the bit nothing changes. Append-only: `f` already accepted 0-255. | Stage 4: hash-router apps (PLAN 8.1 "Hash-only route change") would otherwise all be stored as `/`. |
| **A5** | 2026-10-08 | Control plane (MongoDB), additive only: new collection `sessions` (`_id` = SHA-256 hex of the login token, `userId`, `createdAt`, `expiresAt`; TTL index on `expiresAt`, index on `userId`) and optional `users.name` (1-120 chars). Site ids from the API start above 100 (1-100 reserved for hand-made sites). No wire, queue or ClickHouse change. | Stage 5: dashboard login and the "Good evening, <name>" greeting. |
| **A6** | 2026-10-08 | Stage 7, append-only. Wire: two new flag bits in `f`: `FLAG_AUTOMATION = 4` (the page is driven by automation software: `navigator.webdriver`, PhantomJS, Nightmare, Cypress) and `FLAG_UA_MISMATCH = 8` (a Chromium engine whose `navigator.userAgentData` has no brands or a headless brand, i.e. the UA was overridden without metadata). The tracker (v3) still SENDS such hits. The edge drops `FLAG_AUTOMATION` as `bot` / `automation`; `FLAG_UA_MISMATCH` goes to the consumer. Queue: `ValidatedEvent.hints` (optional) carries `Sec-CH-UA`, `Sec-CH-UA-Platform`, `Sec-CH-UA-Mobile`, whether `Accept-Language` was present, and whether the hit came over HTTPS; used for the verdict only, never a column. `EdgeMeta.https` added. New consumer drop reason `referrer_spam`; consumer `bot` details `bots_yml:<name>` and `headless:<signals>`. Datacentre ASNs at the edge: the reviewed list in `infra/lists`. No ClickHouse or MongoDB change. | Stage 7: reproducing Plausible's Puppeteer test showed Puppeteer's `setUserAgent()` sends NO client hints, so a spoofed "Safari" is invisible to the server; only the page can see it. |

## 10. What is still VERIFY (not assumed true)
1. Prove the MongoDB rules on a real server: `pnpm verify:mongo` against the owner's local MongoDB
   (owner decision 2026-10-07: local MongoDB for development, ClickHouse Cloud for analytics). It creates a
   scratch database, applies the schema, checks all 14 rules and drops it. In the build environment the
   script was only run against a recording fake (MongoDB binaries could not be downloaded there).
   Transactions (Stage 5) additionally need the local server to run as a single-node replica set.
2. ~~Whether the Workers Rate Limiting binding is available on the Free plan.~~ RESOLVED 2026-10-08: yes,
   the first real deploy accepted both `[[ratelimits]]` bindings on the Free plan.
3. Consumer CPU per batch on the Free plan (10 ms) — measure after the first deploy; batch size follows.
4. `request.cf.country` accuracy and per-isolate regex cost: measured later, never quoted as vendor facts.
