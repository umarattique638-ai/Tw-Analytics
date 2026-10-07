# Cloudflare Stage 1 Verification Ledger

First verified against official Cloudflare documentation on **2026-10-06**; re-checked and extended with
the **Free plan** limits on **2026-10-07** (owner rule: Cloudflare free features only, STAGE-1 D9).
Limits change: re-check before sizing and record the date here.

## The eight unknowns (PLAN 2.4)

| # | Unknown | Frozen answer / status | Source |
|---|---|---|---|
| 1 | `request.cf` fields / country | `request.cf` exists in Workers and carries `country`, `asn`, `asOrganization`. **Country accuracy is not published as a percentage.** | [Workers Request](https://developers.cloudflare.com/workers/runtime-apis/request/) |
| 2 | CPU limits / regex compilation | **Free: 10 ms per invocation.** Paid: 30 s default, 5 min max. Per-isolate regex compilation cost is **not documented**: measure. | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) (2026-10-07) |
| 3 | Queues limits | 128 KB message; consumer batch ≤ 100; `sendBatch` 100 msgs / 256 KB; 5 000 msg/s per queue. **Free: 10 000 operations/day, retention 24 h (not configurable).** Paid: up to 14 days. | [Queues Limits](https://developers.cloudflare.com/queues/platform/limits/), [Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/) (2026-10-07) |
| 4 | Worker bundle size | **64 MiB uncompressed**, Free and Paid; no compressed limit enforced. | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) (2026-10-07) |
| 5 | Bot Management worth its cost | Enterprise add-on. **Not used** (paid). Consumer-side scoring is the baseline. | [Bot Management](https://developers.cloudflare.com/bots/get-started/bot-management/) |
| 6 | Subrequests | **Free: 50 per invocation.** Paid: 10 000 default. KV, Queue, R2 and Durable Object calls count. | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) (2026-10-07) |
| 7 | ClickHouse from a Worker | HTTP interface with plain `fetch`. Insert path tested against ClickHouse 24.8 in Stage 3. | [ClickHouse HTTP interface](https://clickhouse.com/docs/interfaces/http) |
| 8 | Cloudflare for SaaS custom hostnames | 100 included on Free/Pro/Business, then $0.10 each, max 50 000. Not needed before Phase 9. | [Cloudflare for SaaS plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/) |

## Free plan budget (2026-10-07)

| Product | Free allowance | What it means for TailWatch |
|---|---|---|
| Workers | 100 000 requests/day, 10 ms CPU per invocation, 128 MB memory | collector ≈ 100 000 hits/day max; keep edge work to hashing + parsing |
| Queues | 10 000 operations/day, 24 h retention | ≈ 3 300 events/day (write + read + ack per message): **the real ceiling** |
| Workers KV | 100 000 reads/day, 1 000 writes/day, min `cacheTtl` 30 s | site config reads are cached 60 s per colo; writes only on site/key changes |
| R2 | 10 GB-month, 1 M Class A, 10 M Class B per month | 1 PUT per consumer batch for the raw archive |
| Durable Objects | SQLite backend only; 100 000 requests/day, 100 000 rows written/day, 5 M rows read/day, 5 GB | session + de-dup store (STAGE-1 D4): about 2 rows written per event |
| Rate Limiting binding | **VERIFY**: availability on Free is not stated in the docs | the collector treats a missing binding as "allowed" |

Sources: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[KV limits](https://developers.cloudflare.com/kv/platform/limits/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Rate limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## EU-only processing
Regional Services for Workers applies only to a Workers Custom Domain with a region and regionalises
execution only. Until confirmed, claim EU **storage** only.

## Explicit non-claims
- No guaranteed percentage accuracy for `request.cf.country`.
- No published per-isolate regex compilation cost.
- Bot Management is not required and not used.
- ClickHouse latency from a Worker is measured after deploy, not assumed.
