/**
 * TailWatch API, v1. ONE backend for every client (PLAN 2.1: "one API serving wp-admin + cloud
 * dashboard + mobile app"): the dashboard uses the session cookie, the WordPress plugin and the mobile
 * app send the same session as `Authorization: Bearer <token>`. Every rule lives here; clients only
 * display what this returns (snippets included).
 *
 * MVC (owner, 2026-10-16). This file only builds the app; where things are:
 *   routes.ts      which URL goes to which controller
 *   controllers/   one per area of the API: read the request, check it, call services/models, answer
 *   services/      business logic: sessions, setup, site health, KV sync, mail, verifier, nightly jobs
 *   models/        data and data access: MongoDB documents and stores, ClickHouse readers, Cloudflare KV
 *   views/         what clients and people see: JSON views of documents, e-mails, install snippets
 *   http/          framework plumbing: errors, rate limiters, request helpers, middleware
 *   lib/           small stateless helpers: domains, secrets, passwords, network guard, constants
 */
import { Hono } from 'hono';
import { csrfGuard, notFound, onError, requireSession } from './http/middleware';
import type { Env } from './http/types';
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

  registerRoutes(app, services, requireSession(deps.store));

  return app;
}
