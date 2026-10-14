import type { SiteConfig } from '@tailwatch/contract';
import type { Env } from './env';
import { log } from './log';

/** KV's minimum cacheTtl is 60 s: site config may lag about a minute (PLAN 2.4). */
const SITE_CONFIG_CACHE_TTL = 60;

function isSiteConfig(value: unknown): value is SiteConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'number' &&
    Number.isSafeInteger(v.id) &&
    typeof v.publicKey === 'string' &&
    Array.isArray(v.allowedHosts) &&
    v.allowedHosts.every((h) => typeof h === 'string') &&
    typeof v.live === 'boolean' &&
    (v.region === 'in' || v.region === 'in-eu') &&
    (v.identitySecret === undefined || typeof v.identitySecret === 'string') &&
    (v.setup === undefined || typeof v.setup === 'boolean')
  );
}

function parseSite(raw: string | null | undefined, publicKey: string): SiteConfig | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSiteConfig(parsed) && parsed.publicKey === publicKey ? parsed : null;
  } catch {
    return null;
  }
}

/** The site of a public key (KV `site:<key>`, written by the API), or null for an unknown key. */
export async function readSiteConfig(env: Env, publicKey: string): Promise<SiteConfig | null> {
  let raw: string | null = null;
  try {
    raw = await env.SITE_CONFIG.get(`site:${publicKey}`, { cacheTtl: SITE_CONFIG_CACHE_TTL });
  } catch (error) {
    // KV outage: behave like "unknown site" for the browser, but leave a trace for operators.
    log('kv_read_failed', error);
    return null;
  }
  // The hardcoded seed is a local/staging fallback only. Production has no seed.
  const site = parseSite(raw, publicKey) ?? parseSite(env.DEV_SITE_CONFIG, publicKey);
  // A key is valid only in its own region (PLAN 2.4). Wrong region == unknown site.
  if (site && env.REGION && site.region !== env.REGION) return null;
  return site;
}
