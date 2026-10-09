import type { SiteConfig } from '@tailwatch/contract';
import type { SiteDoc } from './store/types';

/**
 * "KV sync on write" (BUILD-ORDER Stage 5). The collector never touches a database (invariant 1): it
 * reads one KV entry per site key. MongoDB is the source of truth, KV is a projection of it written by
 * this API after every change, and `pnpm --filter @tailwatch/api resync` rebuilds it from MongoDB.
 */
export interface SiteConfigSink {
  put(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  /** Current value, or null when absent. Optional: used by the reconciler to write only what differs. */
  get?(name: string): Promise<string | null>;
}

export const kvName = (publicKey: string) => `site:${publicKey}`;

/** The exact entry the collector reads (contract SiteConfig), one per ACTIVE key. */
export function siteConfig(site: SiteDoc, publicKey: string): SiteConfig {
  return {
    id: site._id,
    publicKey,
    allowedHosts: site.allowedHosts,
    live: site.status === 'active',
    region: site.region,
    identitySecret: site.identitySecret,
  };
}

/** Writes active keys, deletes revoked ones (and every key of a deleted site). */
export async function syncSite(sink: SiteConfigSink, site: SiteDoc): Promise<void> {
  const writes = site.keys.map((k) =>
    k.status === 'active' && site.status !== 'deleted'
      ? sink.put(kvName(k.publicKey), JSON.stringify(siteConfig(site, k.publicKey)))
      : sink.delete(kvName(k.publicKey)),
  );
  const results = await Promise.allSettled(writes);
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw new KvSyncError((failed as PromiseRejectedResult).reason);
}

/** Writes only these keys (a new key being activated). */
export async function putKeys(sink: SiteConfigSink, site: SiteDoc, publicKeys: string[]): Promise<void> {
  const results = await Promise.allSettled(publicKeys.map((k) => sink.put(kvName(k), JSON.stringify(siteConfig(site, k)))));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw new KvSyncError((failed as PromiseRejectedResult).reason);
}

/** Best-effort removal (undoing a half-finished activation). Never throws. */
export async function deleteKeys(sink: SiteConfigSink, publicKeys: string[]): Promise<boolean> {
  const results = await Promise.allSettled(publicKeys.map((k) => sink.delete(kvName(k))));
  return results.every((r) => r.status === 'fulfilled');
}

/**
 * What KV must hold for this site: name -> value for every live key, null for every key that must be gone.
 * The reconciler compares this with what is there and writes only the difference.
 */
export function expectedEntries(site: SiteDoc): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const k of site.keys) {
    out.set(kvName(k.publicKey), k.status === 'active' && site.status !== 'deleted' ? JSON.stringify(siteConfig(site, k.publicKey)) : null);
  }
  return out;
}

/**
 * A KV failure in words the site owner can act on. Never the raw Cloudflare body (it can carry internals).
 */
export function kvProblem(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/not configured/i.test(raw)) return 'Cloudflare KV is not configured on the server (CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID, CF_API_TOKEN).';
  const status = /Cloudflare KV \w+ (\d{3})/.exec(raw)?.[1];
  if (status === '401' || status === '403' || /authentication error/i.test(raw)) {
    return `Cloudflare refused the server's API token (HTTP ${status ?? '401'}). Create a new token with the permission "Account > Workers KV Storage > Edit", put it in CF_API_TOKEN in the server settings and redeploy.`;
  }
  if (status === '429') return 'Cloudflare is rate limiting the server (HTTP 429). Try again in a minute.';
  if (status) return `Cloudflare KV answered HTTP ${status}. Try again in a minute.`;
  if (/timeout|abort|fetch failed|network|ENOTFOUND|ECONN/i.test(raw)) return 'Cloudflare could not be reached (network or timeout). Try again in a minute.';
  return 'Writing to Cloudflare KV failed. Try again in a minute.';
}

export class KvSyncError extends Error {
  constructor(readonly causeError: unknown) {
    super(`KV sync failed: ${causeError instanceof Error ? causeError.message : String(causeError)}`);
  }
}

/** Cloudflare Workers KV through the REST API (free plan; token scope "Workers KV Storage: Edit"). */
export class CloudflareKv implements SiteConfigSink {
  constructor(
    private readonly accountId: string,
    private readonly namespaceId: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  private url(name: string) {
    return `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/storage/kv/namespaces/${this.namespaceId}/values/${encodeURIComponent(name)}`;
  }
  async get(name: string): Promise<string | null> {
    const res = await this.fetchImpl(this.url(name), { headers: { authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(5_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Cloudflare KV GET ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.text();
  }
  private async call(method: 'PUT' | 'DELETE', name: string, body?: string) {
    const res = await this.fetchImpl(this.url(name), {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'text/plain' }) },
      body,
      signal: AbortSignal.timeout(5_000),
    });
    // Deleting a key that is not there is fine.
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
      const text = (await res.text()).slice(0, 300);
      throw new Error(`Cloudflare KV ${method} ${res.status}: ${text}`);
    }
  }
  put(name: string, value: string) {
    return this.call('PUT', name, value);
  }
  delete(name: string) {
    return this.call('DELETE', name);
  }
}

/** Used when Cloudflare credentials are missing: every write fails with a message that says what to set. */
export class UnconfiguredKv implements SiteConfigSink {
  async put(): Promise<void> {
    throw new Error('Cloudflare KV is not configured: set CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID and CF_API_TOKEN in .env');
  }
  async delete(): Promise<void> {
    return this.put();
  }
}

export class MemoryKv implements SiteConfigSink {
  readonly entries = new Map<string, string>();
  async put(name: string, value: string) {
    this.entries.set(name, value);
  }
  async delete(name: string) {
    this.entries.delete(name);
  }
  async get(name: string) {
    return this.entries.get(name) ?? null;
  }
}
