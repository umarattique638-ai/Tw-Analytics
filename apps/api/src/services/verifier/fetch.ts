import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ALLOWED_PORTS, guardedFetch, isPublicAddress } from '../../lib/netguard';
import { VERIFIER_USER_AGENT } from './types';
import type { VerifierOptions } from './types';

const MAX_HTML_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

/** SSRF guard: the API fetches a URL a user typed, so it must never reach our own network. */
async function assertPublic(url: URL, o: VerifierOptions): Promise<void> {
  if (o.allowPrivate) return;
  if (!ALLOWED_PORTS.has(url.port)) throw new Error('blocked port');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await (o.resolve ?? (async (h) => (await lookup(h, { all: true })).map((a) => a.address)))(host);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new Error('private address');
}

/**
 * The real network path checks the address again at connect time (netguard.guardedFetch), so DNS
 * rebinding between the check above and the connection cannot reach a private address. Tests and local
 * development (allowPrivate) inject their own fetch.
 */
const defaultFetch = (o: VerifierOptions): typeof fetch => o.fetchImpl ?? (o.allowPrivate ? fetch : (guardedFetch as unknown as typeof fetch));

/** GET with at most 5 redirects (each one checked again), a 10 s timeout and a 2 MB body limit. */
export async function fetchLimited(url: string, o: VerifierOptions, accept: string): Promise<{ res: Response; body: string; finalUrl: string }> {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current, o);
    const res = await defaultFetch(o)(current, {
      redirect: 'manual',
      headers: { 'user-agent': VERIFIER_USER_AGENT, accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel().catch(() => undefined); // do not keep the socket open
      current = new URL(res.headers.get('location')!, current);
      if (current.protocol !== 'https:' && current.protocol !== 'http:') throw new Error('bad redirect');
      continue;
    }
    const reader = res.body?.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_HTML_BYTES) {
          await reader.cancel();
          break;
        }
        chunks.push(value);
      }
    }
    return { res, body: Buffer.concat(chunks).toString('utf8'), finalUrl: current.href };
  }
  throw new Error('too many redirects');
}
