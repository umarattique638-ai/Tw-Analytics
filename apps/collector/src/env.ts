import type { QueueMessage } from '@tailwatch/contract';

/** Cloudflare bindings and settings of the collector (wrangler.toml). */

export interface SiteConfigKV {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
}

export interface QueueBinding {
  send(message: QueueMessage): Promise<void>;
}

export interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  SITE_CONFIG: SiteConfigKV;
  EVENTS: QueueBinding;
  /** Per-site limiter (keyed by public key). */
  RATE_LIMITER?: RateLimitBinding;
  /** Per-client limiter. The key is held only by Cloudflare's limiter, never by us. */
  RATE_LIMITER_IP?: RateLimitBinding;
  /** Region this deployment serves ('in' | 'in-eu'). A site key is valid only in its own region. */
  REGION?: string;
  /** Local/staging seed only. Production site configuration always comes from KV. */
  DEV_SITE_CONFIG?: string;
  /**
   * "true" adds the x-tw-dropped reason header to responses (local / staging only).
   * Unset in production: a reason header would tell anyone whether a site key exists (STAGE-1 D2).
   */
  EXPOSE_DROP_REASON?: string;
  /**
   * Milliseconds to collect identical drops (same site, reason, detail, country, ASN) into ONE queue
   * message per isolate (wrangler.toml: 5000). Unset or 0 = one message per drop. A bot flood then costs
   * a handful of queue operations instead of one per hit (Free plan: about 3,300 messages a day).
   */
  DROP_BATCH_MS?: string;
}

/** The part of Cloudflare's ExecutionContext we use: work that continues after the response. */
export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}
