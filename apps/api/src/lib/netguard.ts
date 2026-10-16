import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';

/**
 * SSRF guard for the install verifier: the API fetches URLs a user typed (and URLs found in that page),
 * so it must never reach a private, loopback, link-local, metadata or otherwise special address.
 *
 * Two parts:
 *  - isPublicAddress(): one classification for IPv4 and IPv6, including every form that embeds an IPv4
 *    address (IPv4-mapped ::ffff:a.b.c.d in hex or dotted form, IPv4-compatible ::a.b.c.d, NAT64 64:ff9b::/96,
 *    6to4 2002::/16). Anything it cannot parse is treated as private (fail closed).
 *  - guardedFetch(): a fetch whose DNS answer is checked AT CONNECT TIME (the `lookup` hook of node:http),
 *    so a name that resolves to a public address for the check and to 127.0.0.1 for the connection
 *    (DNS rebinding) cannot get through.
 */

type Range = [base: number, bits: number];

const V4_BLOCKED: Range[] = [
  [v4('0.0.0.0'), 8], // "this network"
  [v4('10.0.0.0'), 8],
  [v4('100.64.0.0'), 10], // carrier-grade NAT
  [v4('127.0.0.0'), 8],
  [v4('169.254.0.0'), 16], // link-local, cloud metadata
  [v4('172.16.0.0'), 12],
  [v4('192.0.0.0'), 24], // IETF protocol assignments
  [v4('192.0.2.0'), 24], // documentation
  [v4('192.88.99.0'), 24], // 6to4 relay anycast
  [v4('192.168.0.0'), 16],
  [v4('198.18.0.0'), 15], // benchmarking
  [v4('198.51.100.0'), 24], // documentation
  [v4('203.0.113.0'), 24], // documentation
  [v4('224.0.0.0'), 4], // multicast
  [v4('240.0.0.0'), 4], // reserved + broadcast
];

function v4(text: string): number {
  const parts = text.split('.');
  if (parts.length !== 4) return NaN;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return NaN;
    const x = Number(p);
    if (x > 255) return NaN;
    n = n * 256 + x;
  }
  return n;
}

function inRange(n: number, [base, bits]: Range): boolean {
  const size = 2 ** (32 - bits);
  return n >= base && n < base + size;
}

function publicV4(n: number): boolean {
  return Number.isFinite(n) && !V4_BLOCKED.some((r) => inRange(n, r));
}

/** 16 bytes, or null if the text is not a valid IPv6 address. */
function v6Bytes(text: string): number[] | null {
  let s = text.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two hex groups.
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (dotted) {
    const n = v4(dotted[1]!);
    if (!Number.isFinite(n)) return null;
    s = `${s.slice(0, -dotted[1]!.length)}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const x = parseInt(g, 16);
    bytes.push(x >> 8, x & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

const v4From = (b: number[], at: number) => ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;
const zeros = (b: number[], from: number, to: number) => b.slice(from, to).every((x) => x === 0);

function publicV6(b: number[]): boolean {
  if (zeros(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) return publicV4(v4From(b, 12)); // ::ffff:a.b.c.d
  if (zeros(b, 0, 12)) return false; // ::, ::1, deprecated IPv4-compatible ::a.b.c.d: never fetch
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return zeros(b, 4, 12) && publicV4(v4From(b, 12)); // NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return publicV4(v4From(b, 2)); // 6to4 embeds an IPv4 address
  if (b[0] === 0x01 && b[1] === 0x00 && zeros(b, 2, 8)) return false; // 100::/64 discard
  if (b[0] === 0x20 && b[1] === 0x01 && (b[2]! & 0xfe) === 0x00) return false; // 2001::/23 IETF special (Teredo, ORCHID…)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return false; // documentation
  if ((b[0]! & 0xfe) === 0xfc) return false; // fc00::/7 unique local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return false; // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0xc0) return false; // fec0::/10 site-local (deprecated)
  if (b[0] === 0xff) return false; // multicast
  return (b[0]! & 0xe0) === 0x20; // only global unicast 2000::/3 is public
}

/** True only for an address the verifier may connect to. Unparseable input is false. */
export function isPublicAddress(address: string): boolean {
  const a = address.replace(/^\[|\]$/g, '');
  const family = isIP(a.split('%')[0]!);
  if (family === 4) return publicV4(v4(a));
  if (family === 6) {
    const b = v6Bytes(a);
    return !!b && publicV6(b);
  }
  return false;
}

/** Ports a customer's website can be on. Anything else is not a website check. */
export const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

export class BlockedAddressError extends Error {
  constructor() {
    super('private address');
    this.name = 'BlockedAddressError';
  }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup that refuses non-public answers: the check and the connection use the same answer. */
const guardedLookup = (allowed: (address: string) => boolean) => (hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as LookupAddress[];
    if (!list.length || !list.every((a) => allowed(a.address))) return callback(new BlockedAddressError(), '');
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
};

/**
 * fetch() for the verifier: no redirects followed (the caller checks each hop), plain http/https only,
 * the connection pinned to a checked public address. Literal IP hosts are checked before connecting.
 */
export function guardedFetch(
  input: URL | string,
  init: { headers?: Record<string, string>; signal?: AbortSignal } = {},
  /** Tests only: widen what counts as allowed (to reach a local test server). */
  testing: { allowed?: (address: string) => boolean; ports?: Set<string> } = {},
): Promise<Response> {
  const url = new URL(String(input));
  const allowed = testing.allowed ?? isPublicAddress;
  const ports = testing.ports ?? ALLOWED_PORTS;
  return new Promise<Response>((resolve, reject) => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return reject(new Error('bad protocol'));
    if (!ports.has(url.port)) return reject(new BlockedAddressError());
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !allowed(host)) return reject(new BlockedAddressError());
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      url,
      { method: 'GET', headers: init.headers, lookup: guardedLookup(allowed) as never, signal: init.signal },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        // A server can answer anything; only a normal HTTP status becomes a Response (the constructor
        // throws on others, and a throw here would crash the process, not reject this promise).
        if (status < 200 || status > 599) {
          res.destroy();
          return reject(new Error(`bad status ${status}`));
        }
        try {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) for (const x of v) headers.append(k, x);
            else if (v !== undefined) headers.set(k, String(v));
          }
          const noBody = status === 204 || status === 205 || status === 304;
          if (noBody) res.resume();
          resolve(new Response(noBody ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers }));
        } catch (error) {
          res.destroy();
          reject(error);
        }
      },
    );
    req.on('error', reject);
    req.end();
  });
}
