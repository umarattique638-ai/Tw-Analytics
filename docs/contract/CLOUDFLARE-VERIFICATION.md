# Cloudflare Stage 1 Verification Ledger

Verified against official Cloudflare documentation on **2026-10-06**.

| # | Unknown | Frozen answer / status | Source |
|---|---|---|---|
| 1 | `request.cf` fields / country | `request.cf` exists in Workers. Cloudflare documents `cf` metadata and exposes Bot Management fields through it. Country is documented as request metadata in the Workers type surface; **country accuracy is not guaranteed/frozen as a percentage**. | [Workers Request docs](https://developers.cloudflare.com/workers/runtime-apis/request/) |
| 2 | CPU limits / regex compilation | Workers Paid: **5 min CPU**; Free: **10 ms**. Per-isolate regex compilation cost is **not a documented Cloudflare limit** and must be measured in our own benchmark. | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| 3 | Queues limits | **128 KB** message size; consumer batch **100**; `sendBatch` **100 messages or 256 KB**; **5,000 msg/s per queue**; retention configurable up to **14 days**; up to **250** concurrent push consumers. | [Queues Limits](https://developers.cloudflare.com/queues/platform/limits/) |
| 4 | Worker bundle size | **64 MiB uncompressed** on Free and Paid. Compressed size is not the enforced limit. | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| 5 | Bot Management worth cost | Bot Management for Enterprise is a paid Enterprise add-on and exposes bot score/advanced signals. We **do not make it a TailWatch dependency** in Stage 1; consumer-side scoring remains the product baseline. Cost/ROI is not a universal number in the docs. | [Bot Management](https://developers.cloudflare.com/bots/get-started/bot-management/) |
| 6 | Subrequests | **50/request Free; 10,000/request Paid by default**, with higher paid limits possible. | [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| 7 | ClickHouse from Worker | ClickHouse provides an **HTTP interface** suitable for JavaScript `fetch`; this is the Stage 1 transport assumption. Production connectivity/latency is still a Stage 3 benchmark. | [ClickHouse HTTP interface](https://clickhouse.com/blog/announcing-the-new-clickhouse-sql-playground) |
| 8 | Cloudflare for SaaS custom hostnames | Free/Pro/Business: **100 included**, **50,000 max**, **$0.10/additional hostname**. Enterprise: custom/unlimited subject to account terms. | [Cloudflare for SaaS Plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/) |

## Explicit non-claims

- Cloudflare documentation does not give a guaranteed percentage accuracy for `request.cf.country`.
- Cloudflare documentation does not publish a universal regex compilation cost per isolate.
- Bot Management is not required for TailWatch's Stage 1 or baseline consumer bot filtering.
- ClickHouse connectivity is an HTTP design choice; the production latency/SLO is measured later.
