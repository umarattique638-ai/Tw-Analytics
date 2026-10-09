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
import { ClickHouseClient, ClickHouseReader, UnconfiguredReader } from './analytics';
import { createApp } from './app';
import { defaultConfig, parseAllowlist } from './config';
import { CloudflareKv, UnconfiguredKv, syncSite } from './kv';
import { StatsReader } from './stats';
import { MongoStore } from './store/mongo';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const env = process.env;

function need(name: string): string {
  const v = env[name];
  if (!v) {
    console.error(`Missing ${name}. Put it in the .env file at the repository root (see .env.example, Stage 5).`);
    process.exit(2);
  }
  return v;
}

// Hosted (Render): the platform gives PORT and the public https address (RENDER_EXTERNAL_URL) itself.
const hosted = !!env.PORT;
const port = Number(env.TW_API_PORT || env.PORT || 8788);
const publicUrl = env.TW_PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
const signupAllowlist = parseAllowlist(env.TW_SIGNUP_ALLOWLIST);
if (publicUrl.startsWith('https://') && !signupAllowlist) {
  console.error('Refusing to start: this is a public (https) server and TW_SIGNUP_ALLOWLIST is empty, so anyone could sign up.');
  console.error('Set TW_SIGNUP_ALLOWLIST to your e-mail (comma-separated, "@domain.com" allows a whole domain).');
  process.exit(2);
}
const config = defaultConfig({
  collectorUrl: need('TW_COLLECTOR_URL'),
  region: env.TW_REGION === 'in-eu' ? 'in-eu' : 'in',
  secureCookies: publicUrl.startsWith('https://'),
  verifierAllowPrivate: env.TW_VERIFIER_ALLOW_PRIVATE === '1',
  signupAllowlist,
});

let store: MongoStore;
try {
  store = await MongoStore.connect(need('TW_MONGO_URL'), env.TW_MONGO_DB || 'tailwatch_control');
} catch (error) {
  console.error(`Cannot connect to MongoDB (${error instanceof Error ? error.message : error}).`);
  console.error(hosted
    ? 'Check TW_MONGO_URL in the hosting settings (MongoDB Atlas connection string) and that Atlas Network Access allows 0.0.0.0/0.'
    : 'Is it running, and is TW_MONGO_URL in .env right? From Stage 5 it is mongodb://127.0.0.1:27017/?replicaSet=rs0');
  process.exit(2);
}
const kv =
  env.CF_ACCOUNT_ID && env.CF_KV_NAMESPACE_ID && env.CF_API_TOKEN
    ? new CloudflareKv(env.CF_ACCOUNT_ID, env.CF_KV_NAMESPACE_ID, env.CF_API_TOKEN)
    : new UnconfiguredKv();
const clickhouse =
  env.TW_CH_URL && env.TW_CH_READ_PASSWORD
    ? new ClickHouseClient(env.TW_CH_URL, env.TW_CH_READ_USER || 'tw_read', env.TW_CH_READ_PASSWORD)
    : null;
const analytics = clickhouse ? new ClickHouseReader(clickhouse) : new UnconfiguredReader();

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
  await store.close();
  console.log(failed ? `${failed} site(s) failed.` : 'OK: Cloudflare KV matches MongoDB.');
  process.exitCode = failed ? 1 : 0;
} else {
  const server = new Hono();
  server.route('/', createApp({ store, kv, analytics, stats: clickhouse ? new StatsReader(clickhouse) : null, config }));

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
