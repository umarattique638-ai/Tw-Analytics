import type { SitesController } from '../controllers/sites.controller';
import type { Api } from '../http/types';

/** The workspace's sites. Signed in. The fixed paths (sync-all, preview) come before /sites/:id. */
export function sitesRoutes(app: Api, c: SitesController) {
  app.get('/sites', c.list);
  app.get('/sites/:id/health', c.health);
  app.post('/sites/:id/health/check', c.checkHealth);
  app.post('/sites/sync-all', c.syncAll);
  app.get('/sites/preview', c.preview);
  app.get('/sites/:id', c.get);
  app.patch('/sites/:id', c.update);
  app.delete('/sites/:id', c.remove);
  app.post('/sites/:id/sync', c.sync);
  app.post('/sites/:id/domain', c.changeDomain);
  app.post('/sites/:id/allowed-hosts', c.allowHost);
}
