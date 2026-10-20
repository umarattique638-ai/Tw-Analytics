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

Owner, 2026-10-16 and 2026-10-20: the API follows MVC with routes, validators, a service layer and
repositories. A request goes middlewares -> route -> controller (validator, service, view) -> answer.
Only code moved between layers; no rule, query, message or order of checks changed (both times checked
by comparing every string and every route before and after, and by the full test suite).

| Path | What it is |
|---|---|
| `app.ts` | Builds the app: error handling, CSRF guard, services, controllers, `registerRoutes`. Nothing else. |
| **`middlewares/`** | `error.middleware` (error answers, 404), `csrf.middleware`, `session.middleware` (`requireSession`), `super-admin.middleware` (`requireSuperAdmin`), `cron.middleware` (`requireCron`). |
| **`routes/`** | Which URL goes to which controller handler, nothing else: `public`, `auth` (+ logout), `account`, `setup`, `sites`, `keys`, `stats`, `reports`, `audit`, `admin`, `internal` (`*.routes.ts`). `routes/index.ts` registers them in order, with the signed-in paths. |
| **`controllers/`** | HTTP only, one per area (`*.controller.ts`): read the request with a validator, call a service, answer with a view; cookies and file downloads. `controllers/index.ts` builds them all. |
| **`validators/`** | Checks of what the client sent, each throwing the error the client sees: `auth` (name, e-mail, password, reset), `site` (site id, domain, timezone, site changes, host), `stats` (range, filters, report id), `account` (delete confirmation, activity-log query), `admin` (account id, confirmation, search). |
| **`services/`** | Business logic, free of HTTP (they get an `Actor`: the signed-in user and workspace). |
| `services/index.ts`, `types.ts` | `createServices(deps)`: every service, built in order; `Deps`, `Actor`, `Services`. |
| `services/auth.service.ts` | Sign-up, login, e-mail verification, forgot / reset password, logout. |
| `services/account.service.ts`, `account-export.service.ts` | Who am I, "Download all data", deleting the account. |
| `services/setup.service.ts` | Adding a site: start, verify (the site is saved only when every check passed), cancel (decision 25). |
| `services/sites.service.ts` | Loading and saving a site, roles, site changes, delete / erase, site health for the dashboard, domain change (decision 29), hosts. |
| `services/keys.service.ts` | Adding and revoking keys. |
| `services/stats.service.ts` | Reading analytics for the dashboard pages, the period, the CSV. |
| `services/reports.service.ts` | Saved CSV reports. |
| `services/audit.service.ts` | Writing and reading the activity log. |
| `services/admin.service.ts` | Super admin (decision 32): every account, delete accounts and sites, download any site's report. |
| `services/session.service.ts` | Login sessions (the token; the cookie is `http/cookies.ts`). |
| `services/kv-sync.service.ts` | Cloudflare KV: grant first / revoke first, retries, reconciling issues. |
| `services/health.service.ts`, `spikes.service.ts` | Is each site still sending data (decisions 28, 29); unusual traffic (decision 31). |
| `services/maintenance.service.ts`, `jobs.service.ts` | Nightly jobs: erasures, retention, KV reconcile; erasure steps and retention pruning. |
| `services/mail/` | Sending e-mail (Brevo, Resend, console). What is sent is `views/emails.ts`. |
| `services/verifier/` | Install check: `types`, `fetch` (SSRF-safe), `html`, `csp`, `check`, `probe` (does the domain answer). |
| **`repositories/`** | Reading and writing the data. |
| `repositories/control-store.ts` | The `ControlStore` interface (every MongoDB operation) and `DuplicateError`. |
| `repositories/mongo-store.ts`, `memory-store.ts` | The MongoDB store; the in-memory one for tests. |
| `repositories/validate.ts` | Checks documents against infra/mongodb/control-plane.schema.json (in-memory store). |
| `repositories/clickhouse.ts` | ClickHouse HTTP client and readers (recent activity, site health, spikes). |
| `repositories/stats/` | Query API: `range`, `queries` (the SQL of docs/QUERIES.md), `channels`, `reader`. |
| `repositories/eraser.ts` | Deleting ClickHouse rows (retention, erasure). |
| `repositories/kv.ts` | Cloudflare KV: the collector's copy of each site. |
| `repositories/setup-store.ts` | Cloudflare KV entries of a site being set up; they expire by themselves. |
| **`models/`** | What the data looks like, nothing else: one file per model (`*.model.ts`), `index.ts` lists them. |
| **`views/`** | What clients and people see: `json` (documents, setup, KV issues; never secrets, hashes or CSV bodies), `admin` (the super admin pages), `site-health` (the banner), `emails`, `snippets`. |
| `http/` | `request` helpers (`body`, `clientIp`, `actorOf`, downloads), `cookies` (session cookie), `errors` (`HttpError`, logging), `limiter` (rate limits), `types`. |
| `lib/` | `constants`, `domain`, `secrets`, `passwords`, `netguard`, `text` (wording for the activity log): small helpers without state. |
| `server.ts`, `vercel.ts`, `runtime.ts`, `config.ts` | Entry points and configuration from the environment. |
| `queries-doc.ts` | Writes docs/QUERIES.md from `repositories/stats/queries.ts`. |

A new endpoint, step by step: a validator for its input (if any), a service method for what it does, a
controller handler that connects the two and picks the view, and one line in its `*.routes.ts`.

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
