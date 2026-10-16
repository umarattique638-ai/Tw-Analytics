import { HttpError, analyticsUnavailable, errorText, logError } from '../http/errors';
import type { Ctx } from '../http/types';
import { RANGE_KEYS, resolveRange } from '../models/stats';
import type { RangeKey, Range, StatsReader } from '../models/stats';
import type { SiteDoc } from '../models/types';

/** A `range` value from the client, checked. */
export function parseRangeKey(raw: string | undefined, fallback?: RangeKey): RangeKey {
  const key = (raw ?? fallback ?? '') as RangeKey;
  if (!RANGE_KEYS.includes(key)) throw new HttpError(400, 'invalid_range', `range is one of ${RANGE_KEYS.join(', ')}.`);
  return key;
}

/** Reading analytics (ClickHouse) for the report pages, and the CSV built from it. */
export function createReportsService(stats: StatsReader | null | undefined, now: () => Date) {
  /** The Query API reader, or 503 when ClickHouse is not configured. */
  const reader = (): StatsReader => {
    if (!stats) throw new HttpError(503, 'analytics_unavailable', 'Reports are not configured: set TW_CH_URL and TW_CH_READ_PASSWORD for the API.');
    return stats;
  };

  /** Any ClickHouse failure becomes one clear 503 (the details go to the log). */
  const reading = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      logError('stats_failed', { message: errorText(error) });
      throw analyticsUnavailable();
    }
  };

  /** `?range=` of the request (7d by default), in the site's timezone. */
  const rangeOf = (c: Ctx, site: SiteDoc): Range => resolveRange(parseRangeKey(c.req.query('range'), '7d'), site.timezone, now());

  /** The CSV of the Visitors over time chart for a range: one row per local day, or per hour for Today. */
  const buildCsv = async (site: SiteDoc, range: Range) => {
    const o = await reading(() => reader().overview(site._id, range));
    const lines = [range.hourly ? 'hour_start_utc,local_hour,visitors,sessions,pageviews' : 'date,visitors,sessions,pageviews'];
    for (const r of o.series) {
      lines.push(
        range.hourly
          ? `${new Date(Number(r.bucket) * 1000).toISOString()},${r.label},${r.visitors},${r.sessions},${r.pageviews}`
          : `${r.bucket},${r.visitors},${r.sessions},${r.pageviews}`,
      );
    }
    const safe = (v: string) => v.replace(/[^A-Za-z0-9._-]+/g, '-');
    return { csv: lines.join('\n') + '\n', rows: o.series.length, filename: `${safe(site.domain)}-${safe(range.from)}-${safe(range.to)}.csv` };
  };

  return { configured: !!stats, reader, reading, rangeOf, buildCsv };
}
export type ReportsService = ReturnType<typeof createReportsService>;
