import { AUTOMATIC_EVENTS } from '@tailwatch/contract';
import type { ClickHouseClient } from '../clickhouse';
import { channelOf } from './channels';
import { QUERIES, activeFilters, filtered } from './queries';
import type { FilterKey, Filters, QueryName } from './queries';
import { bounds, chartBuckets } from './range';
import type { Range } from './range';
import type { DropsReport, EventsReport, Live, Overview, SiteExport } from '../../models/stats.model';

/** ClickHouse answers numbers as strings (UInt64); missing or odd values count as 0. */
const n = (v: unknown) => Number(v ?? 0) || 0;

/** Runs the named queries (queries.ts) as tw_read and shapes the answers for the dashboard. */
export class StatsReader {
  constructor(private readonly ch: ClickHouseClient) {}

  private run<T>(name: QueryName, params: Record<string, string | number>, filters?: Filters): Promise<T[]> {
    if (!filters) return this.ch.query<T>(QUERIES[name].replaceAll('{db}', this.ch.database), params);
    const q = filtered(name, filters);
    return this.ch.query<T>(q.sql.replaceAll('{db}', this.ch.database), { ...params, ...q.params });
  }

  private async totals(site: number, tz: string, from: string, to: string, filters?: Filters) {
    const p = bounds(site, tz, from, to);
    const [[ev], [se]] = await Promise.all([
      this.run<{ visitors: string; pageviews: string }>('visitors_pageviews', p, filters),
      this.run<{ sessions: string; engaged_sessions: string; engagement_ms: string }>('sessions_bounce', p, filters),
    ]);
    const sessions = n(se?.sessions);
    return {
      visitors: n(ev?.visitors),
      pageviews: n(ev?.pageviews),
      sessions,
      bounceRate: sessions > 0 ? 1 - n(se?.engaged_sessions) / sessions : null,
      /** Average time a visit was in the foreground (tw.js engagement), in ms. */
      avgVisitMs: sessions > 0 ? Math.round(n(se?.engagement_ms) / sessions) : null,
    };
  }

  /** The Filter menu (decision 30): values of one filter in the period, most used first. */
  async filterValues(site: number, range: Range, key: FilterKey, q: string): Promise<{ value: string; count: number }[]> {
    const p = bounds(site, range.tz, range.from, range.to);
    const rows = await this.run<{ value: string; n: string }>(`filter_values_${key}`, { ...p, q });
    return rows.map((r) => ({ value: r.value, count: n(r.n) }));
  }

  /** `filters` (decision 30): narrow everything except the capture rate and the warnings to a page, country, ... */
  async overview(site: number, range: Range, filters?: Filters): Promise<Overview> {
    const p = bounds(site, range.tz, range.from, range.to);
    const f = filters && activeFilters(filters).length ? filters : undefined;
    const [cur, prev, s1, s2, pages, sources, countries, devices, browsers, capture, drops] = await Promise.all([
      this.totals(site, range.tz, range.from, range.to, f),
      this.totals(site, range.tz, range.prev.from, range.prev.to, f),
      this.run<{ bucket: string; visitors: string; pageviews: string }>(range.hourly ? 'series_hourly' : 'series_daily', p, f),
      this.run<{ bucket: string; sessions: string }>(range.hourly ? 'series_hourly_sessions' : 'series_daily_sessions', p, f),
      this.run<{ pathname: string; pageviews: string }>(f ? 'top_pages_filtered' : 'top_pages', p, f),
      this.run<{ source: string; sessions: string }>('sources', p, f),
      this.run<{ label: string; visitors: string }>('countries', p, f),
      this.run<{ label: string; visitors: string }>('devices', p, f),
      this.run<{ label: string; visitors: string }>('browsers', p, f),
      this.run<{ received: string; expected: string }>('capture_rate', p),
      this.run<{ reason: string; hits: string; detail: string; last: string }>('drops_by_reason', p),
    ]);

    const byBucket = new Map(s1.map((r) => [r.bucket, r]));
    const sessionsBy = new Map(s2.map((r) => [r.bucket, n(r.sessions)]));
    const series = chartBuckets(range).map(({ bucket, label }) => ({
      bucket,
      label,
      visitors: n(byBucket.get(bucket)?.visitors),
      pageviews: n(byBucket.get(bucket)?.pageviews),
      sessions: sessionsBy.get(bucket) ?? 0,
    }));

    const channels = new Map<string, number>();
    for (const s of sources) channels.set(channelOf(s.source), (channels.get(channelOf(s.source)) ?? 0) + n(s.sessions));
    const received = n(capture[0]?.received);
    const expected = n(capture[0]?.expected);
    const bars = (rows: { label: string; visitors: string }[]) => rows.map((r) => ({ label: r.label, value: n(r.visitors) }));

    return {
      range,
      kpis: { ...cur, visitorsEstimated: range.days > 1, previous: prev },
      series,
      sources: (['Direct', 'Search', 'Social', 'Referral'] as const).map((name) => ({ name, sessions: channels.get(name) ?? 0 })).filter((s) => s.sessions > 0),
      referrers: sources.filter((s) => s.source).slice(0, 8).map((s) => ({ label: s.source, value: n(s.sessions) })),
      pages: pages.map((r) => ({ label: r.pathname, value: n(r.pageviews) })),
      countries: bars(countries),
      devices: bars(devices),
      browsers: bars(browsers),
      capture: { received, expected, rate: expected > 0 ? received / expected : null },
      drops: drops.map((d) => ({ reason: d.reason, hits: n(d.hits), detail: d.detail, last: n(d.last) })),
    };
  }

  async live(site: number, now: Date): Promise<Live> {
    const p = { site, now: now.toISOString().replace('T', ' ').replace('Z', '') };
    const [[active], minutes, events] = await Promise.all([
      this.run<{ visitors: string }>('live_active', p),
      this.run<{ minute: string; visitors: string }>('live_minutes', p),
      this.run<{ name: string; pathname: string; country_code: string; at: string }>('live_events', p),
    ]);
    const byMinute = new Map(minutes.map((m) => [Number(m.minute), n(m.visitors)]));
    const last = Math.floor(now.getTime() / 60_000) * 60;
    return {
      now: now.getTime(),
      active: n(active?.visitors),
      minutes: Array.from({ length: 30 }, (_, i) => last - (29 - i) * 60).map((minute) => ({ minute: minute * 1000, visitors: byMinute.get(minute) ?? 0 })),
      events: events.map((e) => ({ name: e.name, path: e.pathname, country: e.country_code, at: n(e.at) })),
    };
  }

  async events(site: number, range: Range, now: Date): Promise<EventsReport> {
    const p = bounds(site, range.tz, range.from, range.to);
    const [rows, first, high] = await Promise.all([
      this.run<{ name: string; events: string; last: string }>('events_by_name', p),
      this.run<{ name: string; first: string }>('events_first_seen', { site }),
      this.run<{ name: string; key: string; distinct_values: string }>('high_cardinality_props', p),
    ]);
    const firstSeen = new Map(first.map((f) => [f.name, n(f.first)]));
    const week = now.getTime() - 7 * 86_400_000;
    return {
      range,
      events: rows.map((r) => {
        const f = firstSeen.get(r.name) ?? 0;
        const kind = AUTOMATIC_EVENTS.has(r.name) ? ('automatic' as const) : ('custom' as const);
        return { name: r.name, kind, events: n(r.events), last: n(r.last), firstSeen: f, isNew: kind === 'custom' && f >= week };
      }),
      highCardinality: high.map((h) => ({ name: h.name, key: h.key, distinctValues: n(h.distinct_values) })),
    };
  }

  /** Account export: every stored day of one site, local dates from `from` to `to` (inclusive). */
  async exportSite(site: number, tz: string, from: string, to: string): Promise<SiteExport> {
    const p = bounds(site, tz, from, to);
    const [days, sessions, pages, events, drops] = await Promise.all([
      this.run<{ bucket: string; visitors: string; pageviews: string }>('series_daily', p),
      this.run<{ bucket: string; sessions: string }>('series_daily_sessions', p),
      this.run<{ pathname: string; pageviews: string; visitors: string }>('pages_all', p),
      this.run<{ name: string; events: string; last: string }>('events_by_name', p),
      this.run<{ reason: string; detail: string; country_code: string; asn: string; hits: string; last: string }>('drops_list', p),
    ]);
    const sessionsBy = new Map(sessions.map((r) => [r.bucket, n(r.sessions)]));
    const iso = (ms: unknown) => (n(ms) > 0 ? new Date(n(ms)).toISOString() : null);
    const dates = [...new Set([...days.map((d) => d.bucket), ...sessionsBy.keys()])].sort();
    const byDay = new Map(days.map((d) => [d.bucket, d]));
    return {
      from,
      to,
      timezone: tz,
      days: dates.map((date) => ({ date, visitors: n(byDay.get(date)?.visitors), sessions: sessionsBy.get(date) ?? 0, pageviews: n(byDay.get(date)?.pageviews) })),
      pages: pages.map((r) => ({ path: r.pathname, pageviews: n(r.pageviews), visitorsEstimated: n(r.visitors) })),
      events: events.map((r) => ({ name: r.name, count: n(r.events), lastAt: iso(r.last) })),
      blocked: drops.map((r) => ({ reason: r.reason, detail: r.detail, country: r.country_code, asn: n(r.asn), hits: n(r.hits), lastAt: iso(r.last) })),
    };
  }

  async drops(site: number, range: Range): Promise<DropsReport> {
    const rows = await this.run<{ reason: string; detail: string; country_code: string; asn: string; hits: string; last: string }>(
      'drops_list',
      bounds(site, range.tz, range.from, range.to),
    );
    return { range, rows: rows.map((r) => ({ reason: r.reason, detail: r.detail, country: r.country_code, asn: n(r.asn), hits: n(r.hits), last: n(r.last) })) };
  }
}
