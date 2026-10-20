import type { PublicController } from '../controllers/public.controller';
import type { Api } from '../http/types';

/** No sign-in needed. */
export function publicRoutes(app: Api, c: PublicController) {
  app.get('/health', c.health);
  app.get('/meta', c.meta);
}
