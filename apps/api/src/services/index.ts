import { createLimiters } from '../http/limiter';
import { createSetupStore } from '../repositories/setup-store';
import { UnconfiguredMailer } from './mail';
import { createAccountService } from './account.service';
import { createAuditService } from './audit.service';
import { createAuthService } from './auth.service';
import { createHealthService } from './health.service';
import { createKeysService } from './keys.service';
import { createKvSync } from './kv-sync.service';
import { createReportsService } from './reports.service';
import { createSessionService } from './session.service';
import { createSetupService } from './setup.service';
import { createSitesService } from './sites.service';
import { createStatsService } from './stats.service';
import type { Deps, Services } from './types';

export type { Actor, Deps, Services } from './types';

/**
 * Builds the services one API instance shares (limiters live here too). Each service may use the ones
 * built before it, so the order matters: the basic ones first, then health, then the feature services.
 */
export function createServices(deps: Deps): Services {
  const { store, kv, config } = deps;
  const now = deps.now ?? (() => new Date());
  const s = {
    deps,
    store,
    kv,
    config,
    now,
    mailer: deps.mailer ?? new UnconfiguredMailer(),
    eraser: deps.eraser ?? null,
    limits: createLimiters(),
    setupStore: createSetupStore(kv, config),
    session: createSessionService(store, config, now),
    kvSync: createKvSync(store, kv, now),
    audit: createAuditService(store, now),
    stats: createStatsService(deps.stats, now),
  } as Services;
  s.health = createHealthService(s);
  s.sites = createSitesService(s);
  s.keys = createKeysService(s);
  s.reports = createReportsService(s);
  s.setup = createSetupService(s);
  s.auth = createAuthService(s);
  s.account = createAccountService(s);
  return s;
}
