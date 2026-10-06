const enc = new TextEncoder();

/**
 * One UTC day in milliseconds.
 */
const DAY_MS = 86_400_000;

/**
 * Previous-salt retention window.
 *
 * The previous UTC day's salt must remain available for 48 hours
 * so events/session continuity around midnight can be resolved.
 */
export const PREVIOUS_SALT_RETENTION_MS = 48 * 60 * 60 * 1000;

/**
 * Convert an ArrayBuffer to lowercase hexadecimal.
 */
const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');

/**
 * Convert a timestamp to its UTC calendar date.
 *
 * IMPORTANT:
 * Salt rotation is based on UTC, not the site's reporting timezone.
 */
export const utcDate = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 10);

/**
 * Get the previous UTC calendar date.
 */
export const previousUtcDate = (ms: number): string =>
  utcDate(ms - DAY_MS);

/**
 * Create the anonymous visitor hash.
 *
 * Identity input:
 *
 *   daily salt
 *   + site ID
 *   + IP
 *   + User-Agent
 *
 * The raw IP is used only transiently while deriving the hash.
 * It must never be persisted, queued or returned from this function.
 *
 * SHA-256 is calculated first and the first 64 bits are retained
 * as a decimal string.
 */
export async function visitorHash(
  salt: string,
  ip: string,
  userAgent: string,
  siteId: string,
): Promise<string> {
  const input = `${salt}\n${siteId}\n${ip}\n${userAgent}`;

  const digest = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(input),
  );

  return new DataView(digest).getBigUint64(0).toString();
}

/**
 * Derive a daily salt from a secret and UTC date.
 *
 * HMAC-SHA-256 means the daily salt cannot be derived by simply
 * hashing the public date.
 *
 * The secret must remain server-side.
 */
export async function deriveSalt(
  secret: string,
  date: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(date),
  );

  return toHex(digest);
}

/**
 * Return the two salts required for visitor identity calculation.
 *
 * Current salt:
 *   current UTC day
 *
 * Previous salt:
 *   previous UTC day
 *
 * The caller/consumer is responsible for ensuring that the
 * previous salt remains available for the required 48-hour window.
 */
export async function deriveVisitorSalts(
  secret: string,
  nowMs: number,
): Promise<{
  currentDate: string;
  previousDate: string;
  currentSalt: string;
  previousSalt: string;
}> {
  const currentDate = utcDate(nowMs);
  const previousDate = previousUtcDate(nowMs);

  const [currentSalt, previousSalt] = await Promise.all([
    deriveSalt(secret, currentDate),
    deriveSalt(secret, previousDate),
  ]);

  return {
    currentDate,
    previousDate,
    currentSalt,
    previousSalt,
  };
}

/**
 * Calculate both possible visitor hashes for an event.
 *
 * The consumer can use these hashes to maintain visitor continuity
 * when an event crosses UTC midnight.
 */
export async function deriveVisitorHashes(
  secret: string,
  nowMs: number,
  ip: string,
  userAgent: string,
  siteId: string,
): Promise<{
  hash: string;
  prevHash: string;
}> {
  const { currentSalt, previousSalt } = await deriveVisitorSalts(
    secret,
    nowMs,
  );

  const [hash, prevHash] = await Promise.all([
    visitorHash(currentSalt, ip, userAgent, siteId),
    visitorHash(previousSalt, ip, userAgent, siteId),
  ]);

  return {
    hash,
    prevHash,
  };
}