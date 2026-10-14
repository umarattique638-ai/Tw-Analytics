/**
 * The API as ONE Vercel serverless function (free Hobby plan, no card). Vercel serves the built dashboard
 * (apps/web/dist) from its CDN and sends every /api/* request here; scripts/build-vercel.mjs bundles this
 * file into .vercel/output (Build Output API v3).
 *
 * Same createApp, same rules as the local server (runtime.ts). Differences that come with serverless:
 *   - settings and the MongoDB connection are made once per warm instance and reused;
 *   - the in-memory login rate limits are per instance (a cold start resets them). The per-e-mail
 *     limit still bounds guessing per instance; a shared limiter belongs to Phase 3.
 */
import { getRequestListener } from '@hono/node-server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './app';
import { SetupError, configFromEnv, publicUrlOf, servicesFromEnv, storeFromEnv } from './runtime';

type Listener = (req: IncomingMessage, res: ServerResponse) => unknown;

let ready: Promise<Listener> | null = null;

async function boot(): Promise<Listener> {
  const env = process.env;
  const config = configFromEnv(env, publicUrlOf(env, 0));
  const store = await storeFromEnv(env, !!env.VERCEL);
  const app = createApp({ store, ...servicesFromEnv(env, !!env.VERCEL), config });
  return getRequestListener(app.fetch);
}

function setupFailed(res: ServerResponse, error: unknown) {
  const lines = error instanceof SetupError ? error.lines : ['Server setup failed.'];
  console.error(JSON.stringify({ tw: 'setup_failed', message: lines.join(' ') }));
  res.statusCode = 503;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'setup_failed', message: lines.join(' ') }));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // The route sends /api/<rest> here as /api?__path=/api/<rest>: put the original path back.
  const url = new URL(req.url ?? '/', 'http://local');
  const path = url.searchParams.get('__path');
  if (path) {
    url.searchParams.delete('__path');
    req.url = path + (url.search ? url.search : '');
  }
  try {
    ready ??= boot();
    const listen = await ready;
    await listen(req, res);
  } catch (error) {
    ready = null; // next request tries again (e.g. Atlas was briefly unreachable)
    if (!res.headersSent) setupFailed(res, error);
  }
}
