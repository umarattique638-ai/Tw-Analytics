import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { hostAllowed } from '@tailwatch/contract/url';
import { ALLOWED_PORTS, guardedFetch, isPublicAddress } from './netguard';

/**
 * Active install check (BUILD-ORDER Part 1 ⑤). Fetches the customer's page as TailwatchVerifier/1.0
 * (on the edge bot denylist, so a check never counts as a visit) and reports exactly which step failed.
 */
export const VERIFIER_USER_AGENT = 'TailwatchVerifier/1.0 (+install check; never counted)';
const MAX_HTML_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

export type CheckId = 'reach' | 'present' | 'noscript' | 'once' | 'id' | 'script' | 'csp';
export interface CheckResult {
  id: CheckId;
  label: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
}
export interface ActiveResult {
  url: string;
  ok: boolean;
  checks: CheckResult[];
}

export interface FoundTag {
  src: string;
  key: string | null;
  api: string | null;
  hidden: 'comment' | 'noscript' | null;
}

const LABELS: Record<CheckId, string> = {
  reach: 'Site reachable',
  present: 'Snippet in page source',
  noscript: 'Not in noscript or a comment',
  once: 'Only one snippet',
  id: 'Site key matches',
  script: 'Script loads',
  csp: 'Content-Security-Policy allows it',
};

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

/** Every <script src=".../tw.js"> in the HTML, with whether it sits in a comment or <noscript>. */
export function findSnippets(html: string, pageUrl: string): FoundTag[] {
  const hiddenRanges: { from: number; to: number; kind: 'comment' | 'noscript' }[] = [];
  for (const m of html.matchAll(/<!--[\s\S]*?(?:-->|$)/g)) hiddenRanges.push({ from: m.index!, to: m.index! + m[0].length, kind: 'comment' });
  for (const m of html.matchAll(/<noscript\b[\s\S]*?(?:<\/noscript\s*>|$)/gi)) hiddenRanges.push({ from: m.index!, to: m.index! + m[0].length, kind: 'noscript' });
  // Text INSIDE a <script> element (a JS comment or string that mentions a snippet) is code, not a tag.
  const scriptBodies: { from: number; to: number }[] = [];
  for (const m of html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script\s*>/gi)) {
    const from = m.index! + m[1]!.length;
    scriptBodies.push({ from, to: from + m[2]!.length });
  }
  const out: FoundTag[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    if (scriptBodies.some((b) => m.index! >= b.from && m.index! < b.to)) continue;
    const tag = m[0];
    const src = attr(tag, 'src');
    if (!src) continue;
    let url: URL;
    try {
      url = new URL(src, pageUrl);
    } catch {
      continue;
    }
    if (!/\/tw\.js$/.test(url.pathname)) continue;
    const hidden = hiddenRanges.find((r) => m.index! >= r.from && m.index! < r.to)?.kind ?? null;
    out.push({ src: url.href, key: url.searchParams.get('id') || attr(tag, 'data-id'), api: attr(tag, 'data-api'), hidden });
  }
  return out;
}

/** CSP source-list check for one directive (falls back to default-src). Null = no policy, allowed. */
export function cspAllows(policies: string[], directive: 'script-src' | 'connect-src', target: string, pageOrigin: string): boolean {
  const t = new URL(target);
  for (const policy of policies) {
    const directives = new Map<string, string[]>();
    for (const part of policy.split(';')) {
      const [name, ...values] = part.trim().split(/\s+/);
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), values);
    }
    const list = directives.get(directive) ?? directives.get('default-src');
    if (!list) continue;
    const ok = list.some((raw) => {
      const s = raw.replace(/^['"]|['"]$/g, '').toLowerCase();
      if (s === '*') return t.protocol === 'https:' || t.protocol === 'http:';
      if (s === 'self') return t.origin === pageOrigin;
      if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return t.protocol === s;
      const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/.exec(s);
      if (!m) return false;
      const [, scheme, wild, host, port] = m;
      if (scheme && `${scheme}:` !== t.protocol) return false;
      if (!scheme && t.protocol !== 'https:' && !(t.protocol === 'http:' && new URL(pageOrigin).protocol === 'http:')) return false;
      const hostOk = wild ? t.hostname.endsWith(`.${host}`) : t.hostname === host;
      const portOk = !port || port === '*' || port === (t.port || (t.protocol === 'https:' ? '443' : '80'));
      return hostOk && portOk;
    });
    if (!ok) return false; // every policy must allow it
  }
  return true;
}

export interface VerifierOptions {
  fetchImpl?: typeof fetch;
  /** Tests and local development only: allow pages on private addresses. */
  allowPrivate?: boolean;
  resolve?: (host: string) => Promise<string[]>;
}

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

async function fetchLimited(url: string, o: VerifierOptions, accept: string): Promise<{ res: Response; body: string; finalUrl: string }> {
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

const result = (id: CheckId, status: CheckResult['status'], message: string): CheckResult => ({ id, label: LABELS[id], status, message });

export async function runActiveCheck(
  site: { domain: string; allowedHosts: string[]; keys: { publicKey: string; status: string }[] },
  rawUrl: string | undefined,
  o: VerifierOptions = {},
): Promise<ActiveResult> {
  const url = rawUrl?.trim() || `https://${site.domain}/`;
  let page: URL;
  try {
    page = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    throw new VerifyInputError('That is not a valid URL.');
  }
  if (page.protocol !== 'https:' && page.protocol !== 'http:') throw new VerifyInputError('Only http and https pages can be checked.');
  if (!hostAllowed(page.hostname, site.allowedHosts)) {
    throw new VerifyInputError(`${page.hostname} is not one of this site's hosts (${site.allowedHosts.join(', ')}).`);
  }

  const checks: CheckResult[] = [];
  const skipRest = (from: CheckId[]) => from.forEach((id) => checks.push(result(id, 'skip', 'Not checked: an earlier step failed.')));
  const ALL: CheckId[] = ['reach', 'present', 'noscript', 'once', 'id', 'script', 'csp'];

  let html = '';
  let headers: Headers;
  let finalUrl = page.href;
  try {
    const got = await fetchLimited(page.href, o, 'text/html,*/*;q=0.5');
    headers = got.res.headers;
    finalUrl = got.finalUrl;
    if (!got.res.ok) {
      checks.push(result('reach', 'fail', `We reached ${page.hostname}, but it answered HTTP ${got.res.status}.`));
      skipRest(ALL.slice(1));
      return { url: page.href, ok: false, checks };
    }
    html = got.body;
    checks.push(result('reach', 'pass', `${new URL(finalUrl).hostname} answered HTTP ${got.res.status}.`));
  } catch (error) {
    const why = error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : error instanceof Error && error.message === 'private address' ? 'it resolves to a private network address' : error instanceof Error && error.message === 'blocked port' ? 'only ports 80, 443, 8080 and 8443 can be checked' : 'connection failed';
    checks.push(result('reach', 'fail', `We couldn't reach ${page.hostname} (${why}).`));
    skipRest(ALL.slice(1));
    return { url: page.href, ok: false, checks };
  }

  const tags = findSnippets(html, finalUrl);
  const visible = tags.filter((t) => !t.hidden);
  const hidden = tags.filter((t) => t.hidden);
  if (tags.length === 0) {
    checks.push(result('present', 'fail', "The snippet isn't in the page source. If you use a cache or CDN, purge it. (npm and framework installs have no script tag: use the first-pageview check instead.)"));
    skipRest(ALL.slice(2));
    return { url: page.href, ok: false, checks };
  }
  checks.push(result('present', 'pass', `Found ${tags.length === 1 ? 'the snippet' : `${tags.length} snippets`} in the page source.`));
  if (visible.length === 0) {
    checks.push(result('noscript', 'fail', `The snippet is inside ${hidden[0]!.hidden === 'comment' ? 'an HTML comment' : 'a <noscript> block'}, so it never runs. Move it into <head>.`));
    skipRest(ALL.slice(3));
    return { url: page.href, ok: false, checks };
  }
  checks.push(result('noscript', 'pass', 'The snippet is live (not commented out, not in <noscript>).'));
  checks.push(
    visible.length === 1
      ? result('once', 'pass', 'Exactly one snippet.')
      : result('once', 'fail', `We found the snippet ${visible.length} times; remove all but one. (The second copy does nothing, but it is a sign of a duplicated template.)`),
  );

  const tag = visible[0]!;
  const active = new Set(site.keys.filter((k) => k.status === 'active').map((k) => k.publicKey));
  const known = new Set(site.keys.map((k) => k.publicKey));
  checks.push(
    tag.key && active.has(tag.key)
      ? result('id', 'pass', 'The snippet uses this site\'s key.')
      : tag.key && known.has(tag.key)
        ? result('id', 'fail', 'The snippet uses a key you revoked. Copy the current snippet again.')
        : result('id', 'fail', tag.key ? `The snippet on your site uses a different site key (${tag.key}).` : 'The snippet has no site key (?id=tw_pub_...).'),
  );

  try {
    const s = await fetchLimited(tag.src, o, 'application/javascript,*/*;q=0.5');
    const type = s.res.headers.get('content-type') ?? '';
    checks.push(
      s.res.ok && /javascript|ecmascript/i.test(type)
        ? result('script', 'pass', 'tw.js loads.')
        : result('script', 'fail', `The script URL answered HTTP ${s.res.status}${type ? ` (${type.split(';')[0]})` : ''}. Check the src in the snippet.`),
    );
  } catch {
    checks.push(result('script', 'fail', `We couldn't load ${tag.src}.`));
  }

  const policies = [
    ...(headers.get('content-security-policy') ? [headers.get('content-security-policy')!] : []),
    ...[...html.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi)].map((m) => attr(m[0], 'content') ?? ''),
  ].filter(Boolean);
  const pageOrigin = new URL(finalUrl).origin;
  const apiUrl = tag.api ? new URL(tag.api, finalUrl).href : `${new URL(tag.src).origin}/e`;
  if (!cspAllows(policies, 'script-src', tag.src, pageOrigin)) {
    checks.push(result('csp', 'fail', `The script is blocked: add ${new URL(tag.src).origin} to your Content-Security-Policy script-src.`));
  } else if (!cspAllows(policies, 'connect-src', apiUrl, pageOrigin)) {
    checks.push(result('csp', 'fail', `Hits are blocked: add ${new URL(apiUrl).origin} to your Content-Security-Policy connect-src.`));
  } else {
    checks.push(result('csp', 'pass', policies.length ? 'Your Content-Security-Policy allows the script and its hits.' : 'No Content-Security-Policy restricts it.'));
  }
  return { url: page.href, ok: checks.every((c) => c.status === 'pass'), checks };
}

export class VerifyInputError extends Error {}
