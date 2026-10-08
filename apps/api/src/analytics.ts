/**
 * Read side of ClickHouse for the control plane (the passive verifier now, the Query API in Stage 6).
 * Uses the read-only user tw_read (infra/clickhouse/003_read_user.sql), never the admin.
 */
export interface RecentActivity {
  events: number;
  pageviews: number;
  last: { at: string; name: string; path: string } | null;
  drops: { reason: string; hits: number; detail: string }[];
}

export interface AnalyticsReader {
  recent(siteId: number, minutes: number): Promise<RecentActivity>;
}

export class ClickHouseReader implements AnalyticsReader {
  constructor(
    private readonly url: string,
    private readonly user: string,
    private readonly password: string,
    private readonly database = 'tailwatch',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async query<T>(sql: string, params: Record<string, string | number>): Promise<T[]> {
    const qs = new URLSearchParams({
      default_format: 'JSON',
      output_format_json_quote_64bit_integers: '1',
      select_sequential_consistency: '1',
    });
    for (const [k, v] of Object.entries(params)) qs.set(`param_${k}`, String(v));
    const res = await this.fetchImpl(`${this.url.replace(/\/+$/, '')}/?${qs}`, {
      method: 'POST',
      headers: { 'X-ClickHouse-User': this.user, 'X-ClickHouse-Key': this.password },
      body: sql,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 300)}`);
    return (JSON.parse(text) as { data: T[] }).data;
  }

  async recent(siteId: number, minutes: number): Promise<RecentActivity> {
    const db = this.database;
    const [summary] = await this.query<{ events: string; pageviews: string; last_at: string; last_name: string; last_path: string }>(
      `SELECT count() AS events, countIf(name = 'pageview') AS pageviews,
              max(received_at) AS last_at, argMax(name, received_at) AS last_name, argMax(pathname, received_at) AS last_path
         FROM ${db}.events
        WHERE site_id = {site:UInt64} AND received_at >= now64(3) - toIntervalMinute({minutes:UInt32})`,
      { site: siteId, minutes },
    );
    const drops = await this.query<{ reason: string; hits: string; detail: string }>(
      `SELECT reason, sum(hits) AS hits, any(detail) AS detail
         FROM ${db}.dropped_hits
        WHERE site_id = {site:UInt64} AND at >= now64(3) - toIntervalMinute({minutes:UInt32})
        GROUP BY reason ORDER BY hits DESC`,
      { site: siteId, minutes },
    );
    const events = Number(summary?.events ?? 0);
    return {
      events,
      pageviews: Number(summary?.pageviews ?? 0),
      last: events > 0 && summary ? { at: `${summary.last_at.replace(' ', 'T')}Z`, name: summary.last_name, path: summary.last_path } : null,
      drops: drops.map((d) => ({ reason: d.reason, hits: Number(d.hits), detail: d.detail })),
    };
  }
}

export class UnconfiguredReader implements AnalyticsReader {
  async recent(): Promise<RecentActivity> {
    throw new Error('ClickHouse is not configured for the API: set TW_CH_URL, TW_CH_READ_USER and TW_CH_READ_PASSWORD in .env');
  }
}
