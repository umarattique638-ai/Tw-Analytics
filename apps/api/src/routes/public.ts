import { PASSWORD_MIN } from '../passwords';
import type { Api } from '../http/types';
import type { Services } from '../services';

/** No sign-in needed: health check, and what the dashboard needs before sign-in. */
export function publicRoutes(app: Api, { config }: Services) {
  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/meta', (c) => c.json({ collector: config.collectorUrl, region: config.region, passwordMin: PASSWORD_MIN }));
}
