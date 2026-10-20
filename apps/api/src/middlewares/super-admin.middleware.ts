import type { MiddlewareHandler } from 'hono';
import { HttpError } from '../http/errors';
import type { Env } from '../http/types';
import type { AdminService } from '../services/admin.service';

/**
 * /admin: only for super admins (TW_ADMIN_EMAILS, confirmed address). Runs after the session middleware.
 * Anyone else gets the same 404 as for a path that does not exist: /admin is not even shown to be there.
 */
export function requireSuperAdmin(admin: AdminService): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!admin.isSuperAdmin(c.get('user'))) throw new HttpError(404, 'not_found', 'No such endpoint.');
    await next();
  };
}
