/**
 * TailWatch API, v1. ONE backend for every client (PLAN 2.1: "one API serving wp-admin + cloud
 * dashboard + mobile app"): the dashboard uses the session cookie, the WordPress plugin and the mobile
 * app send the same session as `Authorization: Bearer <token>`. Every rule lives here; clients only
 * display what this returns (snippets included).
 *
 * MVC (owner, 2026-10-16 and 2026-10-20). This file only builds the app. A request goes:
 *
 *   middlewares/   CSRF guard, session, cron secret, error answers
 *   routes/        which URL goes to which controller (nothing else)
 *   controllers/   HTTP only: read the request, call a service, answer with a view
 *   validators/    checks of what the client sent (domain, timezone, e-mail, password, range, ids)
 *   services/      business logic, free of HTTP: auth, account, setup, sites, keys, stats, reports,
 *                  activity log, site health, KV sync, mail, verifier, nightly jobs
 *   repositories/  reading and writing the data: MongoDB, ClickHouse, Cloudflare KV, eraser
 *   models/        what the data looks like (one file per model)
 *   views/         what clients and people see: JSON, site health, e-mails, install snippets
 *   http/          request helpers, cookies, errors, rate limiters, types
 *   lib/           small stateless helpers: domains, secrets, passwords, network guard, wording, constants
 */
import { Hono } from 'hono';
import { createControllers } from './controllers';
import type { Env } from './http/types';
import { csrfGuard, notFound, onError, requireSession } from './middlewares';
import { registerRoutes } from './routes';
import { createServices } from './services';
import type { Deps } from './services';

export type { Deps } from './services';
export { AUDIT_KEEP_DAYS, DELETE_CONFIRMATION, EXPORT_KEEP_DAYS, EXPORT_MAX, PASSIVE_WINDOW_MINUTES, RESET_MINUTES, SESSION_COOKIE } from './lib/constants';

export function createApp(deps: Deps) {
  const services = createServices(deps);
  const app = new Hono<Env>().basePath('/api/v1');

  app.onError(onError);
  app.notFound(notFound);
  app.use('*', csrfGuard);

  registerRoutes(app, createControllers(services), { session: requireSession(deps.store), cronSecret: deps.config.cronSecret });

  return app;
}
