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
  private async call(method: 'PUT' | 'DELETE', name: string, body?: string) {
    const res = await this.fetchImpl(this.url(name), {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'text/plain' }) },
      body,
      signal: AbortSignal.timeout(10_000),
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
}
