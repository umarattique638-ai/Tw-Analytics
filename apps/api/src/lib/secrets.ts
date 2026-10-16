import { createHash, randomBytes } from 'node:crypto';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Unbiased random alphanumerics (rejection sampling: 248 = 4 * 62). */
export function randomAlnum(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) out += ALNUM[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

/** Contract site key: tw_pub_ + 32 alphanumerics (SITE_KEY_RE). Public by design: it sits in every page. */
export const newPublicKey = () => `tw_pub_${randomAlnum(32)}`;
export const newKeyId = () => `k_${randomAlnum(12)}`;
/** Server-only HMAC secret for the daily visitor salts (64 hex chars). Never leaves the server + KV. */
export const newIdentitySecret = () => randomBytes(32).toString('hex');
/** Session token for the cookie / bearer header. Only its SHA-256 is stored. */
export const newSessionToken = () => randomBytes(32).toString('base64url');
export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');
