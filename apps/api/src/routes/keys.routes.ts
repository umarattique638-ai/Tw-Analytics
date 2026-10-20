import type { KeysController } from '../controllers/keys.controller';
import type { Api } from '../http/types';

/** A site's public keys. Signed in. */
export function keysRoutes(app: Api, c: KeysController) {
  app.post('/sites/:id/keys', c.create);
  app.post('/sites/:id/keys/:keyId/revoke', c.revoke);
}
