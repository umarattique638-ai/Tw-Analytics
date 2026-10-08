# TailWatch Analytics

Cloud-only web analytics: one hosted collector, four install surfaces. Read in this order:

1. `docs/PROJECT-NOTES.md` - the working notes: rules, checklists, decisions, status board. Start here.
2. `docs/PLAN.md` - what we are building and why.
3. `docs/BUILD-ORDER.md` - where to start, in what order, what the customer experiences.
4. `docs/contract/STAGE-1.md` - the frozen contract and the decisions D1-D13 / amendments A1-A4.
5. `docs/TESTING.md` - how to test Stages 1-4 against ClickHouse Cloud and your local MongoDB.

Status (2026-10-08): Stage 1 frozen, Stages 2-3 done and deployed (Cloudflare Free). Stage 4 tracker:
tw.js live and proven on a real page; React/Next/Vue/Svelte adapters; Next.js, Vite and hash-router
apps record exactly one pageview per navigation in dev/StrictMode. Stage 5: one API + the dashboard
(signup, add site, snippet, verify, first pageview): `pnpm app` -> http://localhost:8788.
Stage 6: the dashboard runs on real data only (Query API, every query in `docs/QUERIES.md`).
Stage 7: precision. Full Matomo bots.yml (843) + headless scoring + referrer spam in the consumer, a reviewed
datacentre ASN list at the edge, every drop itemised. Plausible's Puppeteer test: **0 of 95** (`pnpm e2e:precision`).

Install on a site (script tag):

```html
<script async src="https://tailwatch-collector.<account>.workers.dev/tw.js?id=tw_pub_..."></script>
```

Requires Node 22+ and pnpm 9 (`npm install -g pnpm@9.15.0`). On Windows also the Microsoft Visual C++
Redistributable x64 (https://aka.ms/vs/17/release/vc_redist.x64.exe), or the local Workers runtime crashes.

```
pnpm install
cp .env.example .env          # then fill in ClickHouse Cloud + local MongoDB (Windows: copy .env.example .env)
pnpm db:check                 # ClickHouse Cloud reachable? schema present?
pnpm db:clickhouse            # create schema v1 (or db:clickhouse:reset to replace the old first-attempt database)
pnpm db:mongo                 # create tailwatch_control in your local MongoDB (see it in Compass)
pnpm verify:stages            # every Stage 1-3 check, against the real databases (docs/TESTING.md)

pnpm --filter @tailwatch/collector dev   # wrangler dev, then open http://localhost:8787/health
```

| Path | What |
|---|---|
| `packages/contract` | wire v1, validator, identity, metrics, fixtures: the single definition everything imports |
| `apps/collector` | edge Worker `POST /e`, `GET /e.gif` (Stage 2) |
| `apps/consumer` | Queue consumer + `SessionStateObject` Durable Object (Stage 3) |
| `infra/` | ClickHouse DDL + insert user, MongoDB control-plane schema |
| `packages/core` | tracker engine: payload, de-dup guard, debounce, engagement, sequence, consent, retry (Stage 4) |
| `packages/browser` | browser platform: `tw.js` CDN build (<= 3 KB gzip, enforced) + npm `init()` (Stage 4) |
| `apps/api` | THE backend (REST /api/v1): auth, sites, keys, KV sync, snippets, verifier; Stage 6 queries |
| `apps/web` | dashboard (React): talks only to apps/api |
| `packages/react`, `next`, `vue`, `svelte` | framework adapters: start the tracker once (StrictMode-safe), `useTailwatch()` / `track()` |
| `apps/demo` | static demo site on its own workers.dev host: the "real page" of Stage 4 |
| `examples/` | Next.js App Router, Vite React SPA, Vue hash-router apps + `e2e` (Stage 4 done-when) |
