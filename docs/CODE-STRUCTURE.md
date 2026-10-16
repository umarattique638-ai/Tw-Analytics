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

## apps/api (Vercel serverless, Hono), MVC

Owner, 2026-10-16: the API follows MVC (models, views, controllers) with a service layer. Only files moved
and route functions were renamed (`siteRoutes` -> `siteController`); no logic changed.

| Path | What it is |
|---|---|
| `app.ts` | Builds the app: error handling, CSRF guard, then `registerRoutes`. Nothing else. |
| `routes.ts` | Which URL goes to which controller, in order; the signed-in paths. |
| **`controllers/`** | One per area: `public`, `auth`, `account`, `setup`, `sites`, `keys`, `stats`, `reports`, `audit`, `internal`. Read the request, check it, call services and models, answer with a view. |
| **`models/`** | Data and data access. |
| `models/types.ts` | MongoDB document types (users, sites, keys, site_health, ...) and the `ControlStore` interface. |
| `models/mongo-store.ts`, `models/memory-store.ts` | The MongoDB store; the in-memory one for tests. |
| `models/validate.ts` | Checks documents against infra/mongodb/control-plane.schema.json (in-memory store). |
| `models/clickhouse.ts` | ClickHouse HTTP client and readers (recent activity, site health, spikes). |
| `models/stats/` | Query API: `range`, `queries` (the SQL of docs/QUERIES.md), `types`, `channels`, `reader`. |
| `models/eraser.ts` | Deleting ClickHouse rows (retention, erasure). |
| `models/kv.ts` | Cloudflare KV: the collector's copy of each site. |
| **`views/`** | What clients and people see. |
| `views/json.ts` | JSON views of stored documents (never identity secrets, hashes or CSV bodies). |
| `views/emails.ts` | Every e-mail (verification, reset, account deleted, site health, unusual traffic). |
| `views/snippets.ts` | The install snippet and the custom-event code. |
| **`services/`** | Business logic. |
| `services/index.ts` | `createServices(deps)`: everything controllers share. |
| `services/session.ts` | Signing in (token, cookie). |
| `services/kv-sync.ts` | Cloudflare KV: grant first / revoke first, retries, reconciling issues. |
| `services/audit.ts` | The activity log. |
| `services/sites.ts` | Loading and saving one of the workspace's sites, roles. |
| `services/setup.ts` | A site being set up: KV-only entries that expire by themselves (decision 25). |
| `services/reports.ts` | Reading analytics, the report period, the CSV. |
| `services/account-export.ts` | "Download all data". |
| `services/maintenance.ts` | Nightly jobs: erasures, retention, KV reconcile. |
| `services/health.ts`, `services/spikes.ts` | Is each site still sending data (decision 28, 29); unusual traffic (decision 31). |
| `services/jobs.ts` | Erasure steps and retention pruning. |
| `services/mail/` | Sending e-mail (Brevo, Resend, console); `index.ts` also re-exports `views/emails`. |
| `services/verifier/` | Install check: `types`, `fetch` (SSRF-safe), `html`, `csp`, `check`, `probe` (does the domain answer). |
| `http/` | `errors`, `limiter` (rate limits), `request` helpers, `middleware` (errors, CSRF, `requireSession`, `requireCron`), `types`. |
| `lib/` | `constants`, `domain`, `secrets`, `passwords`, `netguard`: small helpers without state. |
| `server.ts`, `vercel.ts`, `runtime.ts`, `config.ts` | Entry points and configuration from the environment. |
| `queries-doc.ts` | Writes docs/QUERIES.md from `models/stats/queries.ts`. |

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
