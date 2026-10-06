
export interface NormalizedUrl {
  href: string;
  host: string; 
  path: string; 
}


export const DEFAULT_QUERY_ALLOWLIST = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source',
] as const;


export function normalizeUrl(input: string, allow: readonly string[] = DEFAULT_QUERY_ALLOWLIST): NormalizedUrl | null {
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
  return { href: `${u.protocol}//${authority}${path}${query ? `?${query}` : ''}`, host, path };
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