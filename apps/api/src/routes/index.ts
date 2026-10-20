/**
 * Routes: which URL goes to which controller, nothing else. Registered in this order (the order matters:
 * the session middleware is attached before the signed-in routes). Base path /api/v1 (app.ts).
 *
 *   public      GET  /health, /meta                         public.routes.ts
 *   auth        /auth/* (sign-up, login, reset, verify)      auth.routes.ts
 *   --- signed in from here (session cookie or Bearer) ---
 *   logout      POST /auth/logout                            auth.routes.ts
 *   account     /me, /account/export, /account/delete        account.routes.ts
 *   setup       /setup, /setup/*                             setup.routes.ts
 *   sites       /sites, /sites/:id (+ health, domain, sync)  sites.routes.ts
 *   keys        /sites/:id/keys/*                            keys.routes.ts
 *   stats       /sites/:id/stats/*, export.csv               stats.routes.ts
 *   reports     /sites/:id/exports/*                         reports.routes.ts
 *   audit       /audit                                       audit.routes.ts
 *   --- scheduled (CRON_SECRET) ---
 *   internal    /internal/maintenance, reconcile, health     internal.routes.ts
 */
import type { MiddlewareHandler } from 'hono';
import type { Controllers } from '../controllers';
import type { Api, Env } from '../http/types';
import { accountRoutes } from './account.routes';
import { auditRoutes } from './audit.routes';
import { authRoutes, logoutRoutes } from './auth.routes';
import { internalRoutes } from './internal.routes';
import { keysRoutes } from './keys.routes';
import { publicRoutes } from './public.routes';
import { reportsRoutes } from './reports.routes';
import { setupRoutes } from './setup.routes';
import { sitesRoutes } from './sites.routes';
import { statsRoutes } from './stats.routes';

/** Paths that need a signed-in user (the session middleware runs before their routes). */
export const SIGNED_IN = ['/auth/logout', '/me', '/setup', '/setup/*', '/sites', '/sites/*', '/audit', '/account/*'];

export function registerRoutes(app: Api, c: Controllers, mw: { session: MiddlewareHandler<Env>; cronSecret: string | null | undefined }) {
  // Public
  publicRoutes(app, c.public);
  authRoutes(app, c.auth);

  // Signed in
  for (const path of SIGNED_IN) app.use(path, mw.session);
  logoutRoutes(app, c.auth);
  accountRoutes(app, c.account);
  setupRoutes(app, c.setup);
  sitesRoutes(app, c.sites);
  keysRoutes(app, c.keys);
  statsRoutes(app, c.stats);
  reportsRoutes(app, c.reports);
  auditRoutes(app, c.audit);

  // Scheduled (CRON_SECRET)
  internalRoutes(app, c.internal, mw.cronSecret);
}
