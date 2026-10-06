# TailWatch Analytics

Cloud-only web analytics: one hosted collector, four install surfaces. Read in this order:

1. `docs/PROJECT-NOTES.md` - the working notes: rules, checklists, decisions, status. Start here.
2. `docs/PLAN.md` - what we are building and why.
3. `docs/BUILD-ORDER.md` - where to start, in what order, what the customer experiences.

Requires Node 22+ and pnpm 9 (`corepack enable`).

```
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @tailwatch/collector dev     # wrangler dev, then open http://localhost:8787/health
```
