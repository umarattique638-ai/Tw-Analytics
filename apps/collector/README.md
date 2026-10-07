# TailWatch Collector (Stage 2, DONE 2026-10-07)

The edge Worker behind `in.tailwatch.com`. It receives bytes, answers fast, and hands the rest to the Queue.
It never touches MongoDB, ClickHouse, Durable Objects or R2 (invariant 1). Free Cloudflare features only.

## Request path (`POST /e`, `GET /e.gif`, `OPTIONS`)

1. per-client limiter (`RATE_LIMITER_IP`), before the body is read
2. body size cap counted on the stream (413), so a chunked request cannot dodge `Content-Length`
3. `parseWire`: JSON + shape check (400 / 413)
4. per-site limiter (`RATE_LIMITER`), before the KV lookup, so unknown-key floods cannot reach the Queue
5. KV site lookup (`site:<publicKey>`, 60 s edge cache), shape-checked; a key from another region is "unknown"
6. `checkWire` (contract): URL, host check, `Sec-GPC`, cheap bot reject (UA denylist, datacentre ASN)
7. respond **204** (or a GIF for the pixel), then `ctx.waitUntil`: salted visitor hashes, then `Queue.send`

Accepted events become `{type:'event'}` messages. Drops that can be attributed to a site become
`{type:'drop'}` messages (reason, country, asn) so the customer's warnings feed can show them. `not_found`
is never queued: there is nothing to attribute it to.

## Privacy

The raw IP exists only inside the hash computation (STAGE-1 D1). It is never queued, logged, or returned.
It is also passed as a key to Cloudflare's rate-limit binding, which holds it transiently outside our storage.
Without a per-site `identitySecret` and a client address the event is **not** queued (`identity_unavailable`).

## Responses

| Case | Response |
|---|---|
| accepted / dropped (any reason) | `204`, empty body, **identical headers** (pixel: always the same GIF) |
| malformed / oversized | `400` / `413` (plain-text error code, e.g. `bad_event_name`) |
| rate limited | `429` + `Retry-After` |
| anything unexpected inside the Worker | `204` (never a 5xx) |

`x-tw-dropped: <reason>` is added **only** when the var `EXPOSE_DROP_REASON = "true"` (local / staging).
Production leaves it unset, because a reason header would tell anyone whether a site key exists (STAGE-1 D2).

## Bindings (`wrangler.toml`)

`SITE_CONFIG` (KV) · `EVENTS` (Queue producer) · `RATE_LIMITER`, `RATE_LIMITER_IP` (rate limit, VERIFY on
Free) · `REGION` (var). `DEV_SITE_CONFIG` and `EXPOSE_DROP_REASON` are local only: copy `.dev.vars.example`
to `.dev.vars`.

## Tests

```bash
pnpm --filter @tailwatch/collector test   # unit + fixture replay in Node (fast)
pnpm --filter @tailwatch/collector e2e    # builds the bundle, runs it on workerd (Miniflare) with real KV + Queue
```

Stage 2 done-when, and where it is proven:

| Done-when | Proof |
|---|---|
| every fixture returns its specified code | `test/collector.stage2.test.ts` (Node) and `test/e2e` (workerd): all 50 fixtures, exact status, body, reason |
| malformed input never 500s | same two files: nasty bodies, throwing KV, throwing limiter, unexpected exceptions |
| messages land in the queue | Node: queued events equal the frozen queue fixtures byte-for-byte. workerd: a real local Queue delivers them to a consumer |
| p99 < 20 ms | workerd via Miniflare: end-to-end p99 13–15 ms, the collector adds ~3 ms at the median over a no-op Worker. **The staging number after deploy is the final check.** |

## Try it locally

```bash
cp .dev.vars.example .dev.vars
pnpm --filter @tailwatch/collector dev
curl -i -X POST localhost:8787/e -H 'Content-Type: text/plain' \
  -H 'User-Agent: Mozilla/5.0 Chrome/126.0' \
  -d '{"s":"tw_pub_TESTTESTTESTTESTTESTTESTTESTTEST","n":"pageview","u":"https://example.com/","q":1,"t":'$(date +%s%3N)',"v":1}'
# expect: HTTP 204, empty body. (A bare curl User-Agent is a bot drop by design: STAGE-1 D13.)
```

## Not done here (later stages)

Duplicate `insert_id` detection (consumer, Stage 3) · quota enforcement (Phase 3) · spill buffer when the
Queue is down (currently: one retry, then a log line) · real p99 on the deployed Worker.
