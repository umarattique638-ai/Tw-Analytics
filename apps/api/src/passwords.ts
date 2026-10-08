import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing: scrypt (memory-hard, in Node's standard library: no native add-on to build on
 * Windows). OWASP's scrypt minimum: N = 2^17, r = 8, p = 1. Stored self-describing, so the cost can be
 * raised later and old hashes still verify:  scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>
 */
export interface ScryptCost {
  N: number;
  r: number;
  p: number;
}
export const PRODUCTION_COST: ScryptCost = { N: 2 ** 17, r: 8, p: 1 };
const KEY_LENGTH = 32;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 256;

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...cost, maxmem: 256 * cost.N * cost.r + 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string, cost: ScryptCost = PRODUCTION_COST): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost);
  return ['scrypt', cost.N, cost.r, cost.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  const key = await derive(password, salt, { N, r, p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A real-cost hash of a random password: login for an unknown e-mail takes as long as a wrong password. */
let decoy: Promise<string> | undefined;
export function decoyHash(cost: ScryptCost): Promise<string> {
  decoy ??= hashPassword(randomBytes(16).toString('hex'), cost);
  return decoy;
}
