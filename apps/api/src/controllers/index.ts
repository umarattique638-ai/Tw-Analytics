import type { Services } from '../services';
import { createAccountController } from './account.controller';
import { createAuditController } from './audit.controller';
import { createAuthController } from './auth.controller';
import { createInternalController } from './internal.controller';
import { createKeysController } from './keys.controller';
import { createPublicController } from './public.controller';
import { createReportsController } from './reports.controller';
import { createSetupController } from './setup.controller';
import { createSitesController } from './sites.controller';
import { createStatsController } from './stats.controller';

/**
 * Controllers: one per area of the API. Each handler only does HTTP: read the request (validators/), call
 * a service, and answer with a view (views/). No URLs here (routes/) and no business rules (services/).
 */
export function createControllers(services: Services) {
  return {
    public: createPublicController(services),
    auth: createAuthController(services),
    account: createAccountController(services),
    setup: createSetupController(services),
    sites: createSitesController(services),
    keys: createKeysController(services),
    stats: createStatsController(services),
    reports: createReportsController(services),
    audit: createAuditController(services),
    internal: createInternalController(services),
  };
}
export type Controllers = ReturnType<typeof createControllers>;
