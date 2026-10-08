/** Display helpers only: every number shown comes from the API unchanged. */
export const num = (n: number) => n.toLocaleString('en-US');

export const percent = (ratio: number | null, digits = 1) => (ratio === null ? '—' : `${(ratio * 100).toFixed(digits)}%`);

/** Change vs the previous period, for KpiCard. Null when there is nothing to compare with. */
export function change(cur: number, prev: number): { delta: string; up: boolean } | null {
  if (prev === 0) return null;
  const d = (cur - prev) / prev;
  return { delta: `${Math.abs(d * 100).toFixed(0)}%`, up: d >= 0 };
}

/** Rows with their share of the total, for the bar lists. */
export function share(rows: { label: string; value: number }[]) {
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return rows.map((r) => ({ ...r, pct: Math.round((r.value / total) * 100) }));
}

const regions = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();
export const countryName = (code: string) => (!code ? 'Unknown' : (regions?.of(code.toUpperCase()) ?? code));

export const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : 'Unknown');

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Human words for the collector's drop reasons (packages/contract DropReason). */
export const DROP_LABEL: Record<string, string> = {
  bot: 'Bot',
  hostname: 'Wrong hostname',
  verification_agent: 'Install check',
  gpc: 'Privacy signal (GPC)',
  identity_unavailable: 'Not attributable',
  not_found: 'Unknown site',
  referrer_spam: 'Referrer spam',
  consumer_invalid: 'Unreadable hit',
};
export const dropLabel = (r: string) => DROP_LABEL[r] ?? r.replace(/_/g, ' ');

/** Words for the headless-scoring signals (apps/consumer/src/precision/headless.ts). */
const SIGNAL: Record<string, string> = {
  ch_headless: 'browser reports a headless brand',
  ch_engine: 'UA claims Safari/Firefox but the engine is Chromium',
  ch_version: 'UA version does not match the browser engine',
  ch_platform: 'UA operating system does not match the browser',
  ch_mobile: 'UA says desktop, browser says mobile',
  js_ua_mismatch: 'spoofed user agent (seen by the tracker)',
  no_lang: 'no Accept-Language',
  ch_missing: 'Chrome UA without client hints',
  generic_bot_token: 'bot-like word in the user agent',
};

/**
 * One readable line for a drop's detail (Stage 7). The raw detail is shown next to it, so every
 * drop stays attributable to the exact rule that made it.
 */
export function dropDetail(reason: string, detail: string): string {
  if (!detail) return '';
  if (reason === 'referrer_spam') return `Spam referrer ${detail}`;
  if (reason === 'hostname') return `Host ${detail}`;
  if (detail.startsWith('bots_yml:')) return `${detail.slice(9)} (known bot list)`;
  if (detail.startsWith('headless:')) return `Headless browser: ${detail.slice(9).split('+').map((s) => SIGNAL[s] ?? s).join(', ')}`;
  if (detail.startsWith('datacentre_asn:')) return `Datacentre / hosting network AS${detail.slice(15)}`;
  if (detail === 'automation') return 'Browser driven by automation software (webdriver)';
  if (detail === 'ua_denylist') return 'Script, HTTP library or headless browser user agent';
  if (detail === 'missing_user_agent') return 'No user agent at all';
  if (detail === 'install_check') return 'TailWatch install verifier';
  if (detail === 'sec_gpc') return 'Global Privacy Control is on';
  return detail;
}
