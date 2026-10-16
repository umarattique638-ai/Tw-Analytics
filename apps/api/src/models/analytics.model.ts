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

/** Decision 31: what an unusual day was made of (last 24 hours, most first). */
export interface SpikeDetails {
  pages: { label: string; count: number }[];
  countries: { label: string; count: number }[];
  referrers: { label: string; count: number }[];
  /** Hits dropped in the same 24 hours (bots, wrong host, ...): a flood often shows here too. */
  blocked: number;
}
