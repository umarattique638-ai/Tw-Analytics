import type { SetupController } from '../controllers/setup.controller';
import type { Api } from '../http/types';

/** Adding a site (decision 25). Signed in. */
export function setupRoutes(app: Api, c: SetupController) {
  app.get('/setup', c.current);
  app.post('/setup', c.start);
  app.delete('/setup', c.cancel);
  app.post('/setup/verify', c.verify);
}
