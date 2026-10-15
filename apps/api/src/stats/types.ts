import type { Range } from './range';

/** What the Query API answers (the dashboard's api/client.ts mirrors these). */
export interface Bar {
  label: string;
  value: number;
}
export interface Overview {
  range: Range;
  kpis: {
    visitors: number;
    visitorsEstimated: boolean;
    sessions: number;
    pageviews: number;
    bounceRate: number | null;
    /** Average engaged time per visit in ms (null without sessions). */
    avgVisitMs?: number | null;
    previous: { visitors: number; sessions: number; pageviews: number; bounceRate: number | null; avgVisitMs?: number | null };
  };
  series: { bucket: string; label: string; visitors: number; sessions: number; pageviews: number }[];
  sources: { name: string; sessions: number }[];
  referrers: Bar[];
  pages: Bar[];
  countries: Bar[];
  devices: Bar[];
  browsers: Bar[];
  capture: { received: number; expected: number; rate: number | null };
  drops: { reason: string; hits: number; detail: string; last: number }[];
}

export interface Live {
  now: number;
  active: number;
  minutes: { minute: number; visitors: number }[];
  events: { name: string; path: string; country: string; at: number }[];
}

export interface EventsReport {
  range: Range;
  events: { name: string; kind: 'automatic' | 'custom'; events: number; last: number; firstSeen: number; isNew: boolean }[];
  highCardinality: { name: string; key: string; distinctValues: number }[];
}

/** One site's analytics in the account export: the stored history, as the dashboard would show it. */
export interface SiteExport {
  from: string;
  to: string;
  timezone: string;
  days: { date: string; visitors: number; sessions: number; pageviews: number }[];
  pages: { path: string; pageviews: number; visitorsEstimated: number }[];
  events: { name: string; count: number; lastAt: string | null }[];
  blocked: { reason: string; detail: string; country: string; asn: number; hits: number; lastAt: string | null }[];
}

export interface DropsReport {
  range: Range;
  rows: { reason: string; detail: string; country: string; asn: number; hits: number; last: number }[];
}
