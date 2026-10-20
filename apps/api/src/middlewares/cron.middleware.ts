import type { MiddlewareHandler } from 'hono';
import { HttpError } from '../http/errors';
import { sameSecret } from '../http/request';
import type { Env } from '../http/types';

/** Scheduled jobs: only with `Authorization: Bearer <CRON_SECRET>`; otherwise the route does not exist. */
export function requireCron(cronSecret: string | null | undefined): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!cronSecret || !sameSecret(c.req.header('authorization') ?? '', `Bearer ${cronSecret}`)) {
      throw new HttpError(404, 'not_found', 'No such endpoint.');
    }
    await next();
  };
}
