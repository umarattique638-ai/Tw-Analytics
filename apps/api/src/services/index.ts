import { createLimiters } from '../http/limiter';
import { UnconfiguredMailer } from '../mail';
import { createAuditLog } from './audit';
import { createHealthService } from './health';
import { createKvSync } from './kv-sync';
import { createReportsService } from './reports';
import { createSessionService } from './session';
import { createSetupService } from './setup';
import { createSiteService } from './sites';
import type { Deps, Services } from './types';

export type { Deps, Services } from './types';

/** Builds the services one API instance shares across its routes (limiters live here too). */
export function createServices(deps: Deps): Services {
  const { store, kv, config } = deps;
  const now = deps.now ?? (() => new Date());
  const services: Omit<Services, 'health'> & { health?: Services['health'] } = {
    deps,
    store,
    kv,
    config,
    now,
    mailer: deps.mailer ?? new UnconfiguredMailer(),
    eraser: deps.eraser ?? null,
    limits: createLimiters(),
    session: createSessionService(store, config, now),
    sites: createSiteService(store, now),
    kvSync: createKvSync(store, kv, now),
    setup: createSetupService(kv, config),
    audit: createAuditLog(store, now),
    reports: createReportsService(deps.stats, now),
  };
  services.health = createHealthService(services as Services);
  return services as Services;
}
