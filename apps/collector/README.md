# TailWatch Collector (Stage 2)

The edge Worker behind `in.tailwatch.com`. It receives bytes, answers fast, and hands the rest to the Queue.
It never touches MongoDB, ClickHouse, Redis or R2 (invariant 1).

## Request path (`POST /e`, `GET /e.gif`, `OPTIONS`)

1. per-client limiter (`RATE_LIMITER_IP`), before the body is read
2. body size cap counted on the stream (413), so a chunked request cannot dodge `Content-Length`
3. `parseWire`: JSON + shape check (400 / 413)
4. per-site limiter (`RATE_LIMITER`), before the KV lookup, so unknown-key floods cannot reach the Queue
5. KV site lookup (`site:<publicKey>`, 60 s edge cache), shape-checked; a key from another region is "unknown"
6. `checkWire`: host check, `Sec-GPC`, cheap bot reject (contract)
7. respond **204** (or a GIF for the pixel), then `ctx.waitUntil`: salted visitor hashes, then `Queue.send`

Accepted events become `{type:'event'}` messages. Drops that can be attributed to a site become
`{type:'drop'}` messages (reason, country, asn) so the warnings feed can show them. `not_found` is never
queued: there is nothing to attribute it to.

## Privacy

The raw IP exists only inside the hash computation. It is never queued, logged, or returned.
It is also passed as a key to Cloudflare's rate-limit binding, which holds it transiently outside our storage.
Without a per-site `identitySecret` and a client address the event is **not** queued (`identity_unavailable`).

## Responses

| Case | Response |
|---|---|
| accepted / duplicate / dropped | `204` (`x-tw-dropped: <reason>` on drops). Pixel: always a GIF |
| malformed / oversized | `400` / `413` (plain-text error code) |
| rate limited | `429` + `Retry-After` |
| anything unexpected inside the Worker | `204` + `x-tw-dropped: internal` (never a 5xx) |

## Bindings (`wrangler.toml`)

`SITE_CONFIG` (KV) · `EVENTS` (Queue producer) · `RATE_LIMITER`, `RATE_LIMITER_IP` (rate limit) · `REGION` (var).
Placeholders (KV ids, rate-limit namespaces) must be replaced before a real deploy.
`DEV_SITE_CONFIG` is a local/staging seed only: copy `.dev.vars.example` to `.dev.vars`.

## Try it

```bash
pnpm --filter @tailwatch/collector dev
curl -i -X POST localhost:8787/e -H 'Content-Type: text/plain' \
  -H 'User-Agent: Mozilla/5.0 Chrome/126.0' \
  -d '{"s":"tw_pub_TESTTESTTESTTESTTESTTESTTESTTEST","n":"pageview","u":"https://example.com/","q":1,"t":'$(date +%s%3N)',"v":1}'
# expect: HTTP 204, empty body.  (A bare curl User-Agent is a bot drop by design.)
```

## Not done here (belongs to later stages)

Duplicate `insert_id` detection and quota enforcement (consumer, Stage 3), real p99 on staging (needs the deployed Worker),
spill buffer when the Queue is down (currently: one retry, then a log line).
