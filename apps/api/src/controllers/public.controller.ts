import type { Ctx } from '../http/types';
import { PASSWORD_MIN } from '../lib/passwords';
import type { Services } from '../services';

/** No sign-in needed: health check, and what the dashboard needs before sign-in. */
export function createPublicController({ config }: Services) {
  return {
    health: (c: Ctx) => c.json({ ok: true }),
    meta: (c: Ctx) => c.json({ collector: config.collectorUrl, region: config.region, passwordMin: PASSWORD_MIN }),
  };
}
export type PublicController = ReturnType<typeof createPublicController>;
