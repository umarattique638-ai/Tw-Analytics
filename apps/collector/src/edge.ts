import type { EdgeMeta, SiteConfig } from '@tailwatch/contract';
import type { RateLimitBinding } from './env';
import { log } from './log';

/** What Cloudflare knows about the request (country, network), plus whether it came over https. */
export function edgeMeta(request: Request, site: SiteConfig | null, receivedAt: number): EdgeMeta {
  const cf = (request as Request & { cf?: { country?: string; asn?: number; asOrganization?: string } }).cf;
  // https: browsers send client hints (Sec-CH-UA) only over TLS; the consumer's headless scoring needs to know.
  const https = request.url.startsWith('https:');
  return { receivedAt, site, country: cf?.country, asn: cf?.asn, asOrganization: cf?.asOrganization, https };
}

/** Asks a Cloudflare rate limiter; no limiter (local) or a broken one means "allowed". */
export async function allowed(limiter: RateLimitBinding | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch (error) {
    // A broken limiter must not take collection down.
    log('rate_limiter_failed', error);
    return true;
  }
}
