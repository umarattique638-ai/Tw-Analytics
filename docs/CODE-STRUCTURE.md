# Code structure

Where everything lives, one concern per file. Decision 22 in PROJECT-NOTES.md. Each folder below has its own
header comment in its `index.ts` (or `app.ts`) with the same map.

## How a hit travels

```
tw.js (packages/browser, packages/core)
  -> apps/collector   Cloudflare Worker: checks the hit, answers at once, queues it
  -> Cloudflare Queue
  -> apps/consumer    Cloudflare Worker: archive, de-dup, bot filter, sessions, ClickHouse rows
  -> ClickHouse       events, sessions, dropped_hits, rollups
  <- apps/api         Vercel: accounts, sites, keys (MongoDB + Cloudflare KV), reports from ClickHouse
  <- apps/web         React dashboard, talks only to apps/api
```

`packages/contract` is shared by all of them: the wire format, limits, validation, bot lists, visitor hashing.

## apps/api (Vercel serverless, Hono)

| Path | What it is |
|---|---|
| `app.ts` | Builds the app: middleware, then each route module. Nothing else. |
| `constants.ts` | Limits and lifetimes (session cookie, report and audit lifetimes, key and host limits). |
| `views.ts` | What clients see of stored documents (never identity secrets, hashes or CSV bodies). |
| `http/errors.ts` | `HttpError` (status + code + sentence), JSON log lines. |
| `http/limiter.ts` | In-memory rate limiters, all of them in one place. |
| `http/request.ts` | Reading the JSON body, client address, constant-time compare, downloads. |
| `http/middleware.ts` | Error and 404 answers, CSRF guard, `requireSession`, `requireCron`. |
| `services/index.ts` | `createServices(deps)`: everything routes share. |
| `services/session.ts` | Signing in (token, cookie). |
| `services/kv-sync.ts` | Cloudflare KV: grant first / revoke first, retries, reconciling issues. |
| `services/audit.ts` | The activity log. |
| `services/sites.ts` | Loading and saving one of the workspace's sites, roles. |
| `services/setup.ts` | A site being set up: KV-only entries that expire by themselves (decision 25). |
| `services/reports.ts` | Reading analytics, the report period, the CSV. |
| `services/account-export.ts` | "Download all data". |
| `services/maintenance.ts` | Nightly jobs: erasures, retention, KV reconcile. |
| `routes/*.ts` | `public`, `auth`, `account`, `setup`, `sites`, `keys`, `stats`, `reports`, `audit`, `internal`. |
| `stats/` | Query API: `range`, `queries` (the SQL of docs/QUERIES.md), `types`, `channels`, `reader`. |
| `verifier/` | Install check: `types`, `fetch` (SSRF-safe), `html`, `csp`, `check`, `probe` (does the domain answer). |
| `mail/` | `providers` (Brevo, Resend, console) and `templates`. |
| `store/` | MongoDB store, the in-memory store for tests, document types, validators. |
| `kv.ts`, `analytics.ts`, `eraser.ts`, `jobs.ts`, `netguard.ts`, `passwords.ts`, `secrets.ts`, `domain.ts`, `snippets.ts` | One concern each (see the header comment of each file). |
| `server.ts`, `vercel.ts`, `runtime.ts`, `config.ts` | Entry points and configuration from the environment. |

## apps/collector (Cloudflare Worker)

| Path | What it is |
|---|---|
| `index.ts` | Worker entry and safety net (never a 5xx to the browser). |
| `router.ts` | `/health`, CORS preflight, `POST /e`, `GET /e.gif`. |
| `collect.ts` | One hit, step by step: limits, size, parse, site, checks, privacy, queue. |
| `http/body.ts`, `http/responses.ts` | Reading the body with a byte cap; every response. |
| `site-config.ts` | The site of a public key, from Cloudflare KV. |
| `edge.ts` | Cloudflare request data, rate limiters. |
| `identity.ts` | Daily visitor hashes (the IP exists only here). |
| `queue.ts` | Sending events, batching identical drops. |
| `env.ts`, `log.ts` | Bindings; the only logging (no request data ever). |

## apps/consumer (Cloudflare Worker, Queue consumer)

| Path | What it is |
|---|---|
| `index.ts` | Worker entry: queue, dead-letter queue, hourly replay. |
| `process.ts` | `processBatch`: runs the pipeline steps in PLAN 3.1 order. |
| `pipeline/ports.ts` | The outside world as interfaces (ClickHouse, state, archive). |
| `pipeline/archive.ts` | (a) raw batch to R2, first. |
| `pipeline/classify.ts` | (b) events, drops, poison, ignored. |
| `pipeline/state.ts` | (c) one state load per batch. |
| `pipeline/groups.ts` | Insert groups and event order (idempotent retries). |
| `pipeline/work.ts` | What one batch builds up in memory. |
| `pipeline/sessionise.ts` | De-dup, precision pass, sessions. |
| `pipeline/drops.ts` | Dropped hits aggregated per minute. |
| `pipeline/write.ts` | (d)(e) inserts, (g) commit last. |
| `worker/` | Settings and ports from the environment, handlers, retry delays. |
| `adapters/`, `state/`, `core/`, `precision/`, `dlq.ts` | ClickHouse and R2, the Durable Object, row building, bot filtering, dead letters. |

## apps/web (React dashboard)

| Path | What it is |
|---|---|
| `pages/` | One file per screen; they only compose hooks and components. |
| `hooks/` | All logic: data loading and polling, forms, actions. |
| `components/ui/` | The shared kit: Button, Panel, Modal, Notice, Badge, Skeleton, ... |
| `components/<area>/` | Pieces of one screen (dashboard, events, reports, settings, ...). |
| `components/layout/` | App shell, sidebar, auth and setup layouts. |
| `context/session.tsx` | The signed-in user and sites. |
| `api/client.ts` | Every call to apps/api. |
| `lib/` | Formatting, timezones, toasts (`notify`). |
