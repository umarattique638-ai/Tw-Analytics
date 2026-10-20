/**
 * Unusual traffic (decision 31): once a day, with the health check, each site's last 24 hours are compared
 * with its usual day. Far more page views than usual -> one e-mail to the owners and admins saying how
 * much, and where it came from (pages, countries, referrers, and how much we blocked as bots).
 *
 *   usual = the median of the 14 days before (24-hour windows, so no timezone is involved)
 *   spike = the last 24 hours have at least SPIKE_MIN_PAGEVIEWS page views AND at least SPIKE_FACTOR x usual
 *
 * The minimum keeps "3 visits instead of 1" quiet. A site needs SPIKE_MIN_AGE_DAYS of history first, and
 * gets at most one such e-mail every SPIKE_REPEAT_HOURS.
 */
export const SPIKE_BASELINE_DAYS = 14;
export const SPIKE_FACTOR = 5;
export const SPIKE_MIN_PAGEVIEWS = 100;
export const SPIKE_MIN_AGE_DAYS = 7;
export const SPIKE_REPEAT_HOURS = 20;

/** Middle value (the average of the two middle ones for an even count); 0 for none. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** `days[0]` = the last 24 hours, `days[1..]` = the windows before it. Null: nothing unusual. */
export function spikeOf(days: number[]): { pageviews: number; usual: number; times: number } | null {
  const last = days[0] ?? 0;
  const usual = median(days.slice(1, SPIKE_BASELINE_DAYS + 1));
  if (last < SPIKE_MIN_PAGEVIEWS || last < SPIKE_FACTOR * Math.max(usual, 1)) return null;
  return { pageviews: last, usual, times: usual > 0 ? last / usual : Infinity };
}
