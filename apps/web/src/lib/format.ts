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
};
export const dropLabel = (r: string) => DROP_LABEL[r] ?? r.replace(/_/g, ' ');
