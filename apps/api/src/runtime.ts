/**
 * Everything the API needs from the environment, in ONE place, shared by every way it runs:
 *   - server.ts   local `pnpm app` and any Node host (Render, a VPS)
 *   - vercel.ts   the Vercel serverless function (free, no card)
 * So the rules (allow-list on a public server, secure cookies on https, ...) cannot drift apart.
 */
import { ClickHouseClient, ClickHouseReader, UnconfiguredReader } from './analytics';
import type { AnalyticsReader } from './analytics';
import type { Deps } from './app';
import { defaultConfig, parseAllowlist } from './config';
import type { ApiConfig } from './config';
import { CloudflareKv, UnconfiguredKv } from './kv';
import type { SiteConfigSink } from './kv';
import { mailerFromEnv } from './mail';
import type { Mailer } from './mail';
import { StatsReader } from './stats';
import { MongoStore } from './store/mongo';
import type { ControlStore } from './store/types';

type Env = Record<string, string | undefined>;

export class SetupError extends Error {
  constructor(readonly lines: string[]) {
    super(lines[0]);
    this.name = 'SetupError';
  }
}

/** The public address of this deployment: explicit, or what the host says (Vercel, Render), or localhost. */
export function publicUrlOf(env: Env, port: number): string {
  if (env.TW_PUBLIC_URL) return env.TW_PUBLIC_URL;
  if (env.RENDER_EXTERNAL_URL) return env.RENDER_EXTERNAL_URL;
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return `http://localhost:${port}`;
}

export function configFromEnv(env: Env, publicUrl: string): ApiConfig {
  const missing = (name: string) => new SetupError([`Missing ${name}. Put it in the root .env, or in the host's environment settings.`]);
  if (!env.TW_COLLECTOR_URL) throw missing('TW_COLLECTOR_URL');
  const signupAllowlist = parseAllowlist(env.TW_SIGNUP_ALLOWLIST);
  if (publicUrl.startsWith('https://') && !signupAllowlist) {
    throw new SetupError([
      'Refusing to start: this is a public (https) server and TW_SIGNUP_ALLOWLIST is empty, so anyone could sign up.',
      'Set TW_SIGNUP_ALLOWLIST to your e-mail (comma-separated, "@domain.com" allows a whole domain).',
    ]);
  }
  return defaultConfig({
    collectorUrl: env.TW_COLLECTOR_URL,
    region: env.TW_REGION === 'in-eu' ? 'in-eu' : 'in',
    secureCookies: publicUrl.startsWith('https://'),
    verifierAllowPrivate: env.TW_VERIFIER_ALLOW_PRIVATE === '1',
    signupAllowlist,
    publicUrl: publicUrl.replace(/\/+$/, ''),
    cronSecret: env.CRON_SECRET && env.CRON_SECRET.length >= 16 ? env.CRON_SECRET : null,
  });
}

export async function storeFromEnv(env: Env, hosted: boolean): Promise<ControlStore & { close?(): Promise<void> }> {
  // Local smoke tests of a built bundle only. Never on a host: data would vanish on every restart.
  // Loaded only when asked for: it reads infra/mongodb at load time, which a host does not have.
  if (env.TW_STORE === 'memory' && !hosted) return new (await import('./store/memory')).MemoryStore();
  const url = env.TW_MONGO_URL;
  if (!url) throw new SetupError(['Missing TW_MONGO_URL (MongoDB connection string).']);
  try {
    return await MongoStore.connect(url, env.TW_MONGO_DB || 'tailwatch_control');
  } catch (error) {
    throw new SetupError([
      `Cannot connect to MongoDB (${error instanceof Error ? error.message : error}).`,
      hosted
        ? 'Check TW_MONGO_URL in the hosting settings (MongoDB Atlas connection string) and that Atlas Network Access allows 0.0.0.0/0.'
        : 'Is it running, and is TW_MONGO_URL in .env right? From Stage 5 it is mongodb://127.0.0.1:27017/?replicaSet=rs0',
    ]);
  }
}

export function servicesFromEnv(
  env: Env,
  hosted = false,
): { kv: SiteConfigSink; analytics: AnalyticsReader; stats: StatsReader | null; mailer: Mailer } {
  const kv =
    env.CF_ACCOUNT_ID && env.CF_KV_NAMESPACE_ID && env.CF_API_TOKEN
      ? new CloudflareKv(env.CF_ACCOUNT_ID, env.CF_KV_NAMESPACE_ID, env.CF_API_TOKEN)
      : new UnconfiguredKv();
  const clickhouse =
    env.TW_CH_URL && env.TW_CH_READ_PASSWORD
      ? new ClickHouseClient(env.TW_CH_URL, env.TW_CH_READ_USER || 'tw_read', env.TW_CH_READ_PASSWORD)
      : null;
  return {
    kv,
    analytics: clickhouse ? new ClickHouseReader(clickhouse) : new UnconfiguredReader(),
    stats: clickhouse ? new StatsReader(clickhouse) : null,
    mailer: mailerFromEnv(env, hosted),
  };
}

export type RuntimeDeps = Deps & { store: ControlStore & { close?(): Promise<void> } };
