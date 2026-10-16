/**
 * Which URL goes to which controller, in the order they are registered (the order matters: the session
 * middleware is attached before the signed-in controllers). Base path /api/v1 (app.ts).
 *
 *   public      GET  /health, /meta                         controllers/public.ts
 *   auth        /auth/* (sign-up, login, reset, verify)      controllers/auth.ts
 *   --- signed in from here (session cookie or Bearer) ---
 *   logout      POST /auth/logout                            controllers/auth.ts
 *   account     /me, /account/export, /account/delete        controllers/account.ts
 *   setup       /setup, /setup/*                             controllers/setup.ts
 *   sites       /sites, /sites/:id (+ health, domain, sync)  controllers/sites.ts
 *   keys        /sites/:id/keys/*                            controllers/keys.ts
 *   stats       /sites/:id/stats/*, export.csv               controllers/stats.ts
 *   reports     /sites/:id/exports/*                         controllers/reports.ts
 *   audit       /audit                                       controllers/audit.ts
 *   --- scheduled (CRON_SECRET) ---
 *   internal    /internal/maintenance, reconcile, health     controllers/internal.ts
 */
import type { MiddlewareHandler } from 'hono';
import { accountController } from './controllers/account';
import { auditController } from './controllers/audit';
import { authController, logoutController } from './controllers/auth';
import { internalController } from './controllers/internal';
import { keyController } from './controllers/keys';
import { publicController } from './controllers/public';
import { reportController } from './controllers/reports';
import { setupController } from './controllers/setup';
import { siteController } from './controllers/sites';
import { statsController } from './controllers/stats';
import type { Api, Env } from './http/types';
import type { Services } from './services';

/** Paths that need a signed-in user (the session middleware runs before their routes). */
export const SIGNED_IN = ['/auth/logout', '/me', '/setup', '/setup/*', '/sites', '/sites/*', '/audit', '/account/*'];

export function registerRoutes(app: Api, services: Services, session: MiddlewareHandler<Env>) {
  // Public
  publicController(app, services);
  authController(app, services);

  // Signed in
  for (const path of SIGNED_IN) app.use(path, session);
  logoutController(app, services);
  accountController(app, services);
  setupController(app, services);
  siteController(app, services);
  keyController(app, services);
  statsController(app, services);
  reportController(app, services);
  auditController(app, services);

  // Scheduled (CRON_SECRET)
  internalController(app, services);
}
