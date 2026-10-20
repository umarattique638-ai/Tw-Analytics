import type { MiddlewareHandler } from 'hono';
import type { AdminController } from '../controllers/admin.controller';
import type { Api, Env } from '../http/types';

/** Super admin. Signed in AND a super admin (`superAdmin` middleware); for anyone else these do not exist. */
export function adminRoutes(app: Api, c: AdminController, superAdmin: MiddlewareHandler<Env>) {
  app.use('/admin/*', superAdmin);
  app.get('/admin/overview', c.overview);
  app.get('/admin/accounts', c.accounts);
  app.get('/admin/accounts/:tenantId', c.account);
  app.post('/admin/accounts/:tenantId/delete', c.deleteAccount);
  app.delete('/admin/sites/:siteId', c.deleteSite);
  app.get('/admin/sites/:siteId/report.csv', c.report);
}
