/**
 * Baseline enrichment (PLAN 3.1 b). Deliberately small. The Stage 7 bot verdicts (bots.yml, headless
 * scoring, referrer spam) live in src/precision and run BEFORE this, on every event.
 * Everything here is a pure function of its inputs.
 */

export interface UserAgentInfo {
  device: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
}

const major = (v: string | undefined): string => (v ? v.split(/[._]/)[0] ?? '' : '');
const dotted = (v: string | undefined): string => (v ? v.replace(/_/g, '.') : '');

export function parseUserAgent(ua: string | undefined): UserAgentInfo {
  const s = ua ?? '';
  const out: UserAgentInfo = { device: 'desktop', browser: '', browserVersion: '', os: '', osVersion: '' };
  if (!s) return out;

  // Order matters: Edge, Opera and Samsung Browser all also say "Chrome".
  let m: RegExpMatchArray | null;
  if ((m = s.match(/Edg(?:e|A|iOS)?\/([\d.]+)/))) Object.assign(out, { browser: 'Edge', browserVersion: major(m[1]) });
  else if ((m = s.match(/(?:OPR|Opera)\/([\d.]+)/))) Object.assign(out, { browser: 'Opera', browserVersion: major(m[1]) });
  else if ((m = s.match(/SamsungBrowser\/([\d.]+)/))) Object.assign(out, { browser: 'Samsung Browser', browserVersion: major(m[1]) });
  else if ((m = s.match(/(?:Firefox|FxiOS)\/([\d.]+)/))) Object.assign(out, { browser: 'Firefox', browserVersion: major(m[1]) });
  else if ((m = s.match(/(?:Chrome|CriOS)\/([\d.]+)/))) Object.assign(out, { browser: 'Chrome', browserVersion: major(m[1]) });
  else if ((m = s.match(/Version\/([\d.]+).*Safari\//))) Object.assign(out, { browser: 'Safari', browserVersion: major(m[1]) });

  if ((m = s.match(/Windows NT ([\d.]+)/))) Object.assign(out, { os: 'Windows', osVersion: m[1] ?? '' });
  else if ((m = s.match(/(?:iPhone|CPU) OS ([\d_]+)/)) && /iPhone|iPad|iPod/.test(s)) Object.assign(out, { os: 'iOS', osVersion: dotted(m[1]) });
  else if ((m = s.match(/Android ([\d.]+)/))) Object.assign(out, { os: 'Android', osVersion: m[1] ?? '' });
  else if ((m = s.match(/Mac OS X ([\d_.]+)/))) Object.assign(out, { os: 'macOS', osVersion: dotted(m[1]) });
  else if (/CrOS/.test(s)) out.os = 'ChromeOS';
  else if (/Linux/.test(s)) out.os = 'Linux';

  if (/iPad|Tablet/i.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) out.device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android/.test(s)) out.device = 'mobile';
  return out;
}

/**
 * Referrer source = the referring host without "www.". Empty for direct traffic
 * and for self-referrals (same host or a subdomain of the site's own host).
 */
export function referrerSource(referrer: string | undefined, siteHost: string): string {
  if (!referrer) return '';
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  } catch {
    return '';
  }
  if (!host) return '';
  const own = siteHost.toLowerCase().replace(/^www\./, '');
  if (host === own || host.endsWith(`.${own}`)) return '';
  return host;
}

export interface Utm {
  source: string;
  medium: string;
  campaign: string;
  term: string;
  content: string;
}

/** UTM values come from the normalised URL, whose query is already allow-listed. */
export function utmFromUrl(url: string): Utm {
  const empty: Utm = { source: '', medium: '', campaign: '', term: '', content: '' };
  try {
    const q = new URL(url).searchParams;
    return {
      source: q.get('utm_source') ?? '',
      medium: q.get('utm_medium') ?? '',
      campaign: q.get('utm_campaign') ?? '',
      term: q.get('utm_term') ?? '',
      content: q.get('utm_content') ?? '',
    };
  } catch {
    return empty;
  }
}