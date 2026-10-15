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

/** A site's rhythm over the last days: when data last arrived, and the longest pause between two arrivals. */
export interface SiteActivity {
  lastAt: Date;
  /** Longest gap between two minutes that had events, in minutes (0 with a single active minute). */
  maxGapMinutes: number;
}

/** Hits of a site dropped because they came from another website (dropped_hits, reason "hostname"). */
export interface WrongHost {
  host: string;
  hits: number;
  lastAt: Date;
}

export interface AnalyticsReader {
  recent(siteId: number, minutes: number): Promise<RecentActivity>;
  /**
   * The health check (decision 28): per site, the last event and the longest gap over the last `days`.
   * A site with no event in that window is missing from the map. Optional: test fakes may leave it out.
   */
  siteActivity?(siteIds: number[], days: number): Promise<Map<number, SiteActivity>>;
  /** Decision 29: per site, the other hosts its key was used on over the last `days`, most hits first. */
  wrongHosts?(siteIds: number[], days: number): Promise<Map<number, WrongHost[]>>;
}

/** Minimal ClickHouse HTTP client: parameterised queries ({name:Type}), JSON rows, UInt64 as strings. */
export interface ClickHouseClientOptions {
  /**
   * Read-your-writes on ClickHouse Cloud's replicas (select_sequential_consistency). Only the live tests
   * need it (they insert, then read at once). The dashboard does not: it waits for replica sync on every
   * query and made the hosted overview time out (Vercel log, 2026-10-09).
   */
  sequentialConsistency?: boolean;
  /** Per query. A hosted function has 30 s in total; ClickHouse Cloud waking from idle can take ~15 s. */
  timeoutMs?: number;
}

export class ClickHouseClient {
  constructor(
    private readonly url: string,
    private readonly user: string,
    private readonly password: string,
    readonly database = 'tailwatch',
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly options: ClickHouseClientOptions = {},
  ) {}

  async query<T>(sql: string, params: Record<string, string | number>): Promise<T[]> {
    const text = await this.send(sql, params);
    return (JSON.parse(text) as { data: T[] }).data;
  }

  /** A statement without a result (ALTER ... DELETE). */
  async exec(sql: string, params: Record<string, string | number>): Promise<void> {
    await this.send(sql, params);
  }

  private async send(sql: string, params: Record<string, string | number>): Promise<string> {
    const qs = new URLSearchParams({ default_format: 'JSON', output_format_json_quote_64bit_integers: '1' });
    if (this.options.sequentialConsistency) qs.set('select_sequential_consistency', '1');
    for (const [k, v] of Object.entries(params)) qs.set(`param_${k}`, String(v));
    const send = () =>
      this.fetchImpl(`${this.url.replace(/\/+$/, '')}/?${qs}`, {
        method: 'POST',
        headers: { 'X-ClickHouse-User': this.user, 'X-ClickHouse-Key': this.password },
        body: sql,
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
      });
    let res: Response;
    try {
      res = await send();
    } catch {
      // One retry on a network failure ("fetch failed", a dropped keep-alive connection, a timeout while
      // the Cloud service wakes up). A ClickHouse ERROR response is never retried: it would fail again.
      res = await send();
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.slice(0, 300)}`);
    return text;
  }
}

export class ClickHouseReader implements AnalyticsReader {
  constructor(private readonly ch: ClickHouseClient) {}

  async recent(siteId: number, minutes: number): Promise<RecentActivity> {
    const db = this.ch.database;
    const [summary] = await this.ch.query<{ events: string; pageviews: string; last_at: string; last_name: string; last_path: string }>(
      `SELECT count() AS events, countIf(name = 'pageview') AS pageviews,
              max(received_at) AS last_at, argMax(name, received_at) AS last_name, argMax(pathname, received_at) AS last_path
         FROM ${db}.events
        WHERE site_id = {site:UInt64} AND received_at >= now64(3) - toIntervalMinute({minutes:UInt32})`,
      { site: siteId, minutes },
    );
    const drops = await this.ch.query<{ reason: string; hits: string; detail: string }>(
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

  async siteActivity(siteIds: number[], days: number): Promise<Map<number, SiteActivity>> {
    const out = new Map<number, SiteActivity>();
    if (!siteIds.length) return out;
    // Events grouped to the minute first, so a busy site still yields at most days x 1440 values.
    const rows = await this.ch.query<{ site_id: string; last_at: string; max_gap: string }>(
      `SELECT site_id, toString(max(received_at)) AS last_at,
              arrayMax(arrayPushBack(arrayDifference(arraySort(groupUniqArray(intDiv(toUInt32(toUnixTimestamp(received_at)), 60)))), 0)) AS max_gap
         FROM ${this.ch.database}.events
        WHERE site_id IN {sites:Array(UInt64)} AND received_at >= now64(3) - toIntervalDay({days:UInt32})
        GROUP BY site_id`,
      { sites: `[${siteIds.map((id) => Math.trunc(id)).join(',')}]`, days },
    );
    for (const r of rows) {
      out.set(Number(r.site_id), { lastAt: new Date(`${r.last_at.replace(' ', 'T')}Z`), maxGapMinutes: Number(r.max_gap) });
    }
    return out;
  }

  async wrongHosts(siteIds: number[], days: number): Promise<Map<number, WrongHost[]>> {
    const out = new Map<number, WrongHost[]>();
    if (!siteIds.length) return out;
    const rows = await this.ch.query<{ site_id: string; host: string; hits: string; last_at: string }>(
      `SELECT site_id, detail AS host, sum(hits) AS hits, toString(max(at)) AS last_at
         FROM ${this.ch.database}.dropped_hits
        WHERE site_id IN {sites:Array(UInt64)} AND reason = 'hostname' AND detail != '' AND at >= now64(3) - toIntervalDay({days:UInt32})
        GROUP BY site_id, detail
        ORDER BY site_id, hits DESC`,
      { sites: `[${siteIds.map((id) => Math.trunc(id)).join(',')}]`, days },
    );
    for (const r of rows) {
      const id = Number(r.site_id);
      const list = out.get(id) ?? [];
      list.push({ host: r.host, hits: Number(r.hits), lastAt: new Date(`${r.last_at.replace(' ', 'T')}Z`) });
      out.set(id, list);
    }
    return out;
  }
}

export class UnconfiguredReader implements AnalyticsReader {
  async recent(): Promise<RecentActivity> {
    throw new Error('ClickHouse is not configured for the API: set TW_CH_URL, TW_CH_READ_USER and TW_CH_READ_PASSWORD in .env');
  }
}
