/**
 * Runs the TailWatch API (and the dashboard's built files) as one Node process:
 *
 *   pnpm app           build everything, then http://localhost:8788
 *   pnpm --filter @tailwatch/api resync      rewrite every site's Cloudflare KV entry from MongoDB
 *
 * Settings come from the repository-root .env (see .env.example, "Stage 5").
 */
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { UnconfiguredReader } from './analytics';
import { createApp } from './app';
import { UnconfiguredKv, syncSite } from './kv';
import { SetupError, configFromEnv, publicUrlOf, servicesFromEnv, storeFromEnv } from './runtime';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const env = process.env;

// Hosted (Render, a VPS): the platform gives PORT. Settings rules live in runtime.ts (shared with Vercel).
const hosted = !!env.PORT;
const port = Number(env.TW_API_PORT || env.PORT || 8788);
const publicUrl = publicUrlOf(env, port);

let setup;
try {
  const config = configFromEnv(env, publicUrl);
  const store = await storeFromEnv(env, hosted);
  setup = { config, store, ...servicesFromEnv(env) };
} catch (error) {
  if (error instanceof SetupError) {
    for (const line of error.lines) console.error(line);
    process.exit(2);
  }
  throw error;
}
const { config, store, kv, analytics, stats } = setup;
const signupAllowlist = config.signupAllowlist;

if (process.argv.includes('--resync')) {
  let failed = 0;
  for (const site of await store.allSites()) {
    try {
      await syncSite(kv, site);
      console.log(`  ok    site ${site._id} ${site.domain} (${site.status})`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  site ${site._id} ${site.domain}: ${error instanceof Error ? error.message : error}`);
    }
  }
  await store.close?.();
  console.log(failed ? `${failed} site(s) failed.` : 'OK: Cloudflare KV matches MongoDB.');
  process.exitCode = failed ? 1 : 0;
} else {
  const server = new Hono();
  server.route('/', createApp({ store, kv, analytics, stats, config }));

  // The dashboard (apps/web, built). Any other path gets index.html: the dashboard routes in the browser.
  const webRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));
  if (existsSync(`${webRoot}index.html`)) {
    const index = readFileSync(`${webRoot}index.html`, 'utf8');
    // serveStatic resolves `root` against the working directory (documented); relative works on Windows too.
    const root = relative(process.cwd(), webRoot) || '.';
    server.use('/*', serveStatic({ root }));
    server.get('*', (c) => c.html(index));
  }

  // Locally only this computer can reach it; a host must listen on every interface.
  const hostname = env.TW_API_HOST || (hosted ? '0.0.0.0' : '127.0.0.1');
  const listening = serve({ fetch: server.fetch, port, hostname }, () => {
    console.log(`TailWatch API + dashboard: ${publicUrl}`);
    console.log(signupAllowlist ? `  sign-up limited to: ${signupAllowlist.join(', ')}` : '  sign-up: open (local development)');
    if (kv instanceof UnconfiguredKv) console.log('  WARNING: Cloudflare KV not configured (CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN): new sites will not activate.');
    if (analytics instanceof UnconfiguredReader) console.log('  WARNING: ClickHouse read user not configured (TW_CH_READ_PASSWORD): the first-pageview check cannot run.');
  });
  listening.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(portInUseMessage(port));
      process.exit(1);
    }
    throw error;
  });
}

/** What to do when the port is taken: almost always an older `pnpm app` still running. */
export function portInUseMessage(port: number): string {
  return [
    ``,
    `Port ${port} is already in use: TailWatch (or something else) is already running there.`,
    `  - If it is an older TailWatch window, go to it and press Ctrl+C, then run pnpm app again.`,
    `  - Or stop whatever holds the port (Windows PowerShell):`,
    `      Get-NetTCPConnection -LocalPort ${port} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`,
    `  - Or use another port: set TW_API_PORT=8789 in the root .env (and TW_PUBLIC_URL to match).`,
    ``,
  ].join('\n');
}
