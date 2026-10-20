import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HttpError, logError } from '../http/errors';
import type { Env } from '../http/types';

/** HttpError -> its JSON; anything else is logged and answered with a generic 500. */
export const onError: ErrorHandler<Env> = (err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status);
  logError('api_error', { name: err.name, message: err.message });
  return c.json({ error: 'internal', message: 'Something went wrong on our side. Try again.' }, 500);
};

export const notFound: NotFoundHandler<Env> = (c) => c.json({ error: 'not_found', message: 'No such endpoint.' }, 404);
