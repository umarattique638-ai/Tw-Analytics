/**
 * Report periods. A site's day is its LOCAL calendar day (sites.timezone, IANA). Ranges are [local
 * midnight, next local midnight) converted to UTC instants by ClickHouse itself (toDateTime64(..., tz)),
 * so a DST day has 23 or 25 hours and nothing is shifted (PLAN 5, STAGE-1 D3).
 */
export type RangeKey = 'today' | '7d' | '30d';
export const RANGE_KEYS: RangeKey[] = ['today', '7d', '30d'];

export interface Range {
  key: RangeKey;
  tz: string;
  /** Local dates, inclusive. */
  from: string;
  to: string;
  days: number;
  prev: { from: string; to: string };
  /** Today is shown per local hour, longer ranges per local day. */
  hourly: boolean;
}

/** YYYY-MM-DD of an instant in a timezone. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function resolveRange(key: RangeKey, tz: string, now: Date): Range {
  const days = key === 'today' ? 1 : key === '7d' ? 7 : 30;
  const to = localDate(now, tz);
  const from = addDays(to, -(days - 1));
  return { key, tz, from, to, days, prev: { from: addDays(from, -days), to: addDays(from, -1) }, hourly: key === 'today' };
}

/** Query parameters for [from 00:00, to+1 00:00) local. */
export const bounds = (site: number, tz: string, from: string, to: string) => ({
  site,
  tz,
  from: `${from} 00:00:00`,
  until: `${addDays(to, 1)} 00:00:00`,
});

/** Every bucket of a range, also the empty ones (the chart must not skip a quiet day or hour). */
export function chartBuckets(range: Range): { bucket: string; label: string }[] {
  const buckets: { bucket: string; label: string }[] = [];
  if (range.hourly) {
    const start = Date.parse(`${range.from}T00:00:00Z`) - 14 * 3_600_000;
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: range.tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const seen = new Set<number>();
    // Walk UTC quarter-hours across the local day and keep each local hour start once (+5:30, +5:45 safe).
    for (let t = start; t < start + 52 * 3_600_000; t += 15 * 60_000) {
      const at = new Date(t);
      if (localDate(at, range.tz) !== range.from) continue;
      const [hh, mm] = fmt.format(at).split(':');
      if (mm !== '00') continue;
      const sec = t / 1000;
      if (seen.has(sec)) continue;
      seen.add(sec);
      buckets.push({ bucket: String(sec), label: `${hh}:00` });
    }
  } else {
    const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
    for (let i = 0; i < range.days; i++) {
      const d = addDays(range.from, i);
      buckets.push({ bucket: d, label: dayLabel.format(new Date(`${d}T12:00:00Z`)) });
    }
  }
  return buckets;
}
