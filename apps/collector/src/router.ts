import { CONTRACT_VERSION } from '@tailwatch/contract';
import { collect } from './collect';
import type { Env, ExecutionContextLike } from './env';
import { TEXT_CONTENT_TYPE, noContent, response } from './http/responses';

/** GET /health, CORS preflight, POST /e (the script), GET /e.gif (the pixel); anything else 404. */
export async function route(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === '/health' && request.method === 'GET') {
    return response(200, 'ok', {
      'content-type': TEXT_CONTENT_TYPE,
      'x-tw-contract': String(CONTRACT_VERSION),
    });
  }
  if (request.method === 'OPTIONS') return noContent();
  if (pathname === '/e.gif' && request.method === 'GET') return collect(request, env, ctx, true);
  if (pathname === '/e' && request.method === 'POST') return collect(request, env, ctx, false);
  return response(404);
}
