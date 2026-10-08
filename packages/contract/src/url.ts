
export interface NormalizedUrl {
  href: string;
  host: string; 
  path: string; 
}


export const DEFAULT_QUERY_ALLOWLIST = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source',
] as const;


/**
 * A hash route is a fragment that starts with `#/` or `#!/` (hash routers: Vue `createWebHashHistory`,
 * React Router `HashRouter`, Angular `useHash`). Only kept when the hit carries FLAG_HASH_ROUTE
 * (STAGE-1 A4). Its own `?query` is dropped and its trailing slash removed, like the path's.
 */
function hashRoute(hash: string): string {
  const m = /^#!?(\/[^?]*)/.exec(hash);
  if (!m) return '';
  const route = m[1]!.length > 1 ? m[1]!.replace(/\/+$/, '') || '/' : '/';
  return `#${hash[1] === '!' ? '!' : ''}${route}`;
}

export function normalizeUrl(
  input: string,
  allow: readonly string[] = DEFAULT_QUERY_ALLOWLIST,
  keepHashRoute = false,
): NormalizedUrl | null {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;

  let path = u.pathname || '/';
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/';

  const kept = [...u.searchParams.entries()]
    .filter(([key]) => allow.includes(key))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(kept).toString();

  const authority = u.port ? `${host}:${u.port}` : host;
  const hash = keepHashRoute ? hashRoute(u.hash) : '';
  return {
    href: `${u.protocol}//${authority}${path}${query ? `?${query}` : ''}${hash}`,
    host,
    path: path + hash,
  };
}

export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return allowed.some((raw) => {
    const a = raw.trim().toLowerCase().replace(/\.$/, '');
    if (!a) return false;
    if (a.startsWith('*.')) {
      const base = a.slice(2);
      return base !== '' && h.length > base.length + 1 && h.endsWith('.' + base);
    }
    return h === a;
  });
}