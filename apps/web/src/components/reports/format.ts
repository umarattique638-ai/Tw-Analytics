import type { Report } from '../../api/client';

const DAY = 86_400_000;
export const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** "2026-10-02" (a local calendar date, no time zone) -> "2 Oct 2026". */
const localDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return y && m && day ? dateFmt.format(new Date(Date.UTC(y, m - 1, day, 12))) : d;
};
export const period = (r: Report) => (r.from === r.to ? localDate(r.from) : `${localDate(r.from)} – ${localDate(r.to)}`);
export const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
export const daysLeft = (r: Report, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(r.expiresAt) - now) / DAY));
export const leftLabel = (left: number) => (left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`);
