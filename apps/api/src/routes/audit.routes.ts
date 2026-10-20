import type { AuditController } from '../controllers/audit.controller';
import type { Api } from '../http/types';

/** The activity log. Signed in. */
export function auditRoutes(app: Api, c: AuditController) {
  app.get('/audit', c.list);
}
