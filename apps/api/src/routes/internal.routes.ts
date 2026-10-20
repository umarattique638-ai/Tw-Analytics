import type { InternalController } from '../controllers/internal.controller';
import type { Api } from '../http/types';
import { requireCron } from '../middlewares';

/** Scheduled jobs (Vercel Cron, once a day). Without CRON_SECRET they do not exist (404). */
export function internalRoutes(app: Api, c: InternalController, cronSecret: string | null | undefined) {
  app.use('/internal/*', requireCron(cronSecret));
  app.get('/internal/maintenance', c.maintenance);
  app.get('/internal/reconcile', c.reconcile);
  app.get('/internal/health', c.health);
}
