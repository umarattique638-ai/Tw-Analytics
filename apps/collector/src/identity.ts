import { deriveSalt, previousUtcDate, utcDate, visitorHash } from '@tailwatch/contract';
import type { VisitorHashes } from '@tailwatch/contract';

/**
 * Daily salts are derived with HMAC; cache them per isolate so a hit costs two SHA-256
 * digests instead of two HMAC key imports plus two digests. Keyed by secret+date so a
 * rotated secret can never reuse a stale salt.
 */
const saltCache = new Map<string, string>();
const SALT_CACHE_MAX = 2000;

async function saltFor(secret: string, date: string): Promise<string> {
  const key = `${secret}|${date}`;
  const hit = saltCache.get(key);
  if (hit) return hit;
  const salt = await deriveSalt(secret, date);
  if (saltCache.size >= SALT_CACHE_MAX) saltCache.clear();
  saltCache.set(key, salt);
  return salt;
}

/**
 * The visitor's hash under today's and yesterday's salt (yesterday's lets a visit that crosses UTC
 * midnight stay one session). The IP and user agent exist only inside this computation.
 */
export async function visitorHashes(secret: string, receivedAt: number, ip: string, userAgent: string, siteId: string): Promise<VisitorHashes> {
  const [today, yesterday] = await Promise.all([saltFor(secret, utcDate(receivedAt)), saltFor(secret, previousUtcDate(receivedAt))]);
  const [hash, prevHash] = await Promise.all([visitorHash(today, ip, userAgent, siteId), visitorHash(yesterday, ip, userAgent, siteId)]);
  return { hash, prevHash };
}
