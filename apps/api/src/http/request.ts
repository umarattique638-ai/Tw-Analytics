import { timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import type { Actor } from '../services/types';
import type { Ctx } from './types';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The JSON body as an object; anything else (no body, invalid JSON, an array) is `{}`. */
export async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const value = await c.req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A body field as a string ('' when it is not one). */
export const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Constant-time string comparison (the cron secret). */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The client's address for rate limiting only (never stored). Behind a hosting proxy (Vercel, or Render /
 * a VPS) the real address is the LAST X-Forwarded-For entry: the proxy appends it (Vercel sends only
 * that one), and anything before it the client could have written itself.
 */
export function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (!xff) return 'local';
  const parts = xff
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts[parts.length - 1] ?? 'local';
}

/** A file download answer. */
export function attachment(c: Context, contentType: string, filename: string) {
  c.header('content-type', contentType);
  c.header('content-disposition', `attachment; filename="${filename}"`);
}

/** Who is asking: the signed-in user and workspace (set by the session middleware). */
export const actorOf = (c: Ctx): Actor => ({ user: c.get('user'), tenant: c.get('tenant') });
