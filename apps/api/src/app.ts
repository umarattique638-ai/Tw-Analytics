/**
 * TailWatch API, v1. ONE backend for every client (PLAN 2.1: "one API serving wp-admin + cloud
 * dashboard + mobile app"): the dashboard uses the session cookie, the WordPress plugin and the mobile
 * app send the same session as `Authorization: Bearer <token>`. Every rule lives here; clients only
 * display what this returns (snippets included).
 *
 * This file only wires the app together. Where things are:
 *   http/       errors, rate limiters, request helpers, middleware (CSRF, session, cron)
 *   services/   shared logic: sessions, KV sync, activity log, sites, reports, account export, nightly jobs
 *   routes/     one file per area of the API (auth, sites, keys, stats, reports, audit, account, internal)
 *   views.ts    what clients see of stored documents
 */
import { Hono } from 'hono';
import { csrfGuard, notFound, onError, requireSession } from './http/middleware';
import type { Env } from './http/types';
import { accountRoutes } from './routes/account';
import { auditRoutes } from './routes/audit';
import { authRoutes, logoutRoute } from './routes/auth';
import { internalRoutes } from './routes/internal';
import { keyRoutes } from './routes/keys';
import { publicRoutes } from './routes/public';
import { reportRoutes } from './routes/reports';
import { siteRoutes } from './routes/sites';
import { statsRoutes } from './routes/stats';
import { createServices } from './services';
import type { Deps } from './services';

export type { Deps } from './services';
export { AUDIT_KEEP_DAYS, DELETE_CONFIRMATION, EXPORT_KEEP_DAYS, EXPORT_MAX, PASSIVE_WINDOW_MINUTES, RESET_MINUTES, SESSION_COOKIE } from './constants';

/** Paths that need a signed-in user (the session middleware runs before their routes). */
const SIGNED_IN = ['/auth/logout', '/me', '/sites', '/sites/*', '/audit', '/account/*'];

export function createApp(deps: Deps) {
  const services = createServices(deps);
  const app = new Hono<Env>().basePath('/api/v1');

  app.onError(onError);
  app.notFound(notFound);
  app.use('*', csrfGuard);

  // Public
  publicRoutes(app, services);
  authRoutes(app, services);

  // Signed in
  const session = requireSession(deps.store);
  for (const path of SIGNED_IN) app.use(path, session);
  logoutRoute(app, services);
  accountRoutes(app, services);
  siteRoutes(app, services);
  keyRoutes(app, services);
  statsRoutes(app, services);
  reportRoutes(app, services);
  auditRoutes(app, services);

  // Scheduled (CRON_SECRET)
  internalRoutes(app, services);

  return app;
}
