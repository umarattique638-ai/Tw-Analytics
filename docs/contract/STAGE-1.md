# TailWatch Stage 1 Contract Freeze

Stage 1 is the frozen contract boundary between the tracker/collector and later runtime stages.
No collector, consumer, API, dashboard, or MongoDB application logic belongs here.

## 1. Wire v1

Required fields:

| Wire field | Type | Limit | Required |
|---|---|---:|---|
| `s` | string | `tw_pub_` + 32 alphanumeric | yes |
| `n` | string | 1–40, `[a-z0-9_]` | yes |
| `u` | string | 1–2048 | yes |
| `q` | integer | 1–4294967295 | yes |
| `t` | finite number | > 0 | yes |
| `v` | integer | 0–65535 | yes |
| `r` | string | <= 2048 | no |
| `e` | integer | 0–86400000 | no |
| `rt` | string | <= 256 | no |
| `w` | integer | 0–100000 | no |
| `i` | string | <= 64 | no |
| `x` | finite number | > 0 | no |
| `f` | integer | 0–255 | no |
| `p` | object | <=25 properties | no |

Unknown fields are accepted and retained in `extra`. Existing fields are never renamed, retyped, or made
stricter in a backward-incompatible wire release.

`Content-Type` is `text/plain`; the tenant/site key is in the body or query string, never an
`Authorization` header.

## 2. Timestamp rule

`72h` is the backfill threshold. An event older than 72 hours is accepted and flagged as backfill.
It is not silently rewritten to `receivedAt`. Future timestamps beyond the allowed clock-skew window are
repaired to `receivedAt` and warned.

## 3. URL normalisation

The canonical URL rules are implemented by `normalizeUrl()` and covered by tests:

- only HTTP(S) URLs are accepted;
- hostname is lower-cased;
- a trailing hostname dot is removed;
- default ports are removed;
- fragment is removed;
- only approved query parameters are retained and sorted;
- malformed URLs and lookalike/unsafe host forms are rejected;
- route template and actual URL remain separate fields.

## 4. Metrics

- Visitor: daily salted SHA-256-derived 64-bit hash of `salt + site_id + IP + user-agent`; previous salt retained 48h.
- The stored ClickHouse `visitor_hash` is `UInt64`; the raw IP is never persisted.
- Session: 30-minute inactivity window; no midnight or campaign split.
- Session ID: Unix timestamp at session start.
- Engaged: visible/focused time `>10s`, OR >=1 custom event, OR >=2 pageviews.
- Bounce: `1 - engaged_sessions / sessions`.
- Pageview: one committed, normalised, de-duplicated navigation.
- Unique visitors: exact within a day; multi-day estimates must be labelled estimated.
- Capture rate: received sequence numbers divided by the expected sequence range for the reporting scope.

## 5. MongoDB control plane

MongoDB replaces the originally documented Postgres control plane by owner decision on 2026-10-05.
The Stage 1 storage contract is in `infra/mongodb/001_control_plane.js` and
`infra/mongodb/control-plane.schema.json`.

Collections:

- `tenants`
- `users`
- `memberships`
- `sites` — numeric `siteId` is shared with ClickHouse; public keys are embedded for atomic rotation/revocation
- `counters` — allocates numeric site IDs

`tenantId` remains a MongoDB `ObjectId`. The numeric MongoDB `sites._id` is the analytics `site_id` written to ClickHouse.
MongoDB is never written per analytics event. Signup/provisioning transactions require a replica set.

### Site rules

- `timezone` is an IANA timezone name and is used at query/reporting time.
- `allowedHosts` contains the exact host patterns accepted by the URL/hostname policy.
- Wildcard matching, where supported, must be label-aware; `*.example.com` must never match `evil-example.com`.
- `retentionDays` is stored per site, but no universal numeric default is frozen by this contract.
- Multiple active keys may exist during zero-downtime rotation; revocation is represented by `status=revoked` and `revokedAt`.

## 6. ClickHouse

The Stage 1 DDL is `infra/clickhouse/001_contract.sql`.
It defines:

- `events`
- `sessions`
- `dropped_hits` as the later precision/debugging surface
- `rollup_hourly_pages`
- `rollup_hourly_pages_mv`

The raw event table is append-only and batch-inserted. `visitor_hash` is stored as the 64-bit `UInt64` output of the identity contract. It contains the 64-bit anonymous visitor hash,
never the raw IP. Session mutations use `VersionedCollapsingMergeTree`. Rollups use `AggregatingMergeTree`
states so multi-period unique counts remain mergeable.

The hourly rollup is intentionally hourly rather than daily so the query layer can apply each site's IANA
timezone and DST rules without rebuilding the stored aggregate.

Bot-filtered events must not contribute to customer-facing precision rollups; the consumer therefore writes
`is_bot=0` analytics rows to the reporting path.

No event/session timestamp column uses `DEFAULT now()`. The consumer supplies all timestamps explicitly so
ClickHouse block-level deduplication is not defeated by implicit defaults.

## 7. Cloudflare verification ledger

The current verification record is in `docs/contract/CLOUDFLARE-VERIFICATION.md`.
Every number is recorded with a source and verification date. Undocumented implementation costs, such as
per-isolate regex compilation time and country accuracy, remain explicit measurement tasks rather than
being presented as vendor guarantees.
