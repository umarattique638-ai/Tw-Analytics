import type { ReportsController } from '../controllers/reports.controller';
import type { Api } from '../http/types';

/** Saved CSV reports of a site. Signed in. */
export function reportsRoutes(app: Api, c: ReportsController) {
  app.get('/sites/:id/exports', c.list);
  app.post('/sites/:id/exports', c.create);
  app.get('/sites/:id/exports/:exportId/download', c.download);
  app.delete('/sites/:id/exports/:exportId', c.remove);
}
