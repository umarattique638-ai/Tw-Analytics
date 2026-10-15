import { requireCron } from '../http/middleware';
import type { Api } from '../http/types';
import type { Services } from '../services';
import { reconcileKv, runMaintenance } from '../services/maintenance';

/** Scheduled jobs (Vercel Cron, once a day). Without CRON_SECRET they do not exist (404). */
export function internalRoutes(app: Api, s: Services) {
  app.use('/internal/*', requireCron(s.config.cronSecret));
  app.get('/internal/maintenance', async (c) => c.json(await runMaintenance(s)));
  app.get('/internal/reconcile', async (c) => c.json(await reconcileKv(s)));
  /** Decision 28: is every site still sending data (services/health.ts). */
  app.get('/internal/health', async (c) => c.json(await s.health.runAll()));
}
