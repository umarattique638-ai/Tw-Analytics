import { HttpError, analyticsUnavailable, errorText, logError } from '../http/errors';
import { resolveRange } from '../repositories/stats';
import type { FilterKey, Filters, Range, RangeKey, StatsReader } from '../repositories/stats';
import type { SiteDoc } from '../models/site.model';

/**
 * Reading analytics (ClickHouse) for the dashboard pages (Stage 6 Query API, docs/QUERIES.md), and the CSV
 * built from it. Ranges are local calendar days in the site's timezone.
 */
export function createStatsService(stats: StatsReader | null | undefined, now: () => Date) {
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

  /** A range key in the site's timezone, as of now. */
  const rangeOf = (site: SiteDoc, key: RangeKey): Range => resolveRange(key, site.timezone, now());

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

  return {
    configured: !!stats,
    reader,
    reading,
    rangeOf,
    buildCsv,

    /** The Overview page: KPIs, charts and lists, narrowed by the filters (decision 30). */
    overview: (site: SiteDoc, key: RangeKey, filters: Filters) => {
      const range = rangeOf(site, key);
      return reading(() => reader().overview(site._id, range, filters));
    },

    /** The Filter menu: the period's own values of one filter, most used first. */
    filterValues: async (site: SiteDoc, key: RangeKey, filter: FilterKey, q: string) => {
      const range = rangeOf(site, key);
      return { values: await reading(() => reader().filterValues(site._id, range, filter, q)) };
    },

    /** Active now, the live chart and the latest hits. */
    live: (site: SiteDoc) => reading(() => reader().live(site._id, now())),

    /** The Events page. */
    events: (site: SiteDoc, key: RangeKey) => {
      const range = rangeOf(site, key);
      return reading(() => reader().events(site._id, range, now()));
    },

    /** Suspicious activity: blocked hits by reason. */
    drops: (site: SiteDoc, key: RangeKey) => {
      const range = rangeOf(site, key);
      return reading(() => reader().drops(site._id, range));
    },

    /** Direct CSV download (not saved). */
    csv: (site: SiteDoc, key: RangeKey) => buildCsv(site, rangeOf(site, key)),
  };
}
export type StatsService = ReturnType<typeof createStatsService>;
