import type { AccountController } from '../controllers/account.controller';
import type { Api } from '../http/types';

/** Who am I, download everything, delete everything. Signed in. */
export function accountRoutes(app: Api, c: AccountController) {
  app.get('/me', c.me);
  app.get('/account/export', c.exportAll);
  app.post('/account/delete', c.remove);
}
