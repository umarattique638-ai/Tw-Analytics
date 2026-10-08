/**
 * Site input rules (BUILD-ORDER Part 1 ②): the domain a customer types, the hosts we accept for it,
 * and the timezone that must exist before the first event is stored.
 */

/** "https://www.Example.com/path" -> "example.com". Null when it is not a public host name. */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 300) return null;
  let host: string;
  try {
    host = new URL(raw.includes('://') ? raw : `http://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (host.length > 253 || host.startsWith('[')) return null; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // IPv4 literal: not a site domain
  const labels = host.split('.');
  if (labels.length < 2) return null; // "localhost", "intranet"
  const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  if (!labels.every((l) => label.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return null;
  return host;
}

/**
 * "Derive allowed_hosts generously" (BUILD-ORDER ②): the domain and every subdomain, www included.
 * Otherwise the first thing every customer hits is "why is nothing tracked on www?".
 */
export function allowedHostsFor(domain: string): string[] {
  return [domain, `*.${domain}`];
}

/** Canonical IANA spelling ("asia/karachi" -> "Asia/Karachi"), or null when the runtime does not know it. */
export function canonicalTimezone(tz: string): string | null {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}
