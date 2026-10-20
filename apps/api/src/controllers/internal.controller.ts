import type { Ctx } from '../http/types';
import type { Services } from '../services';
import { reconcileKv, runMaintenance } from '../services/maintenance.service';

/** Scheduled jobs (Vercel Cron, once a day). The cron middleware (routes/internal.routes.ts) guards them. */
export function createInternalController(s: Services) {
  return {
    maintenance: async (c: Ctx) => c.json(await runMaintenance(s)),
    reconcile: async (c: Ctx) => c.json(await reconcileKv(s)),
    /** Decision 28: is every site still sending data (services/health.service.ts). */
    health: async (c: Ctx) => c.json(await s.health.runAll()),
  };
}
export type InternalController = ReturnType<typeof createInternalController>;
