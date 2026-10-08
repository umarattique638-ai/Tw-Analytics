import { QUERIES } from './stats';
import type { QueryName } from './stats';

/** Where each documented query shows up in the dashboard (BUILD-ORDER Stage 6: every number reproducible). */
const USED_BY: Record<QueryName, string> = {
  visitors_pageviews: 'Dashboard KPIs: Visitors, Page views (and the same for the previous period, for the change %)',
  sessions_bounce: 'Dashboard KPIs: Sessions, Bounce rate = 1 - engaged_sessions / sessions',
  series_daily: 'Visitors over time (7 / 30 days): visitors and page views per local day',
  series_daily_sessions: 'Visitors over time (7 / 30 days): sessions per local day',
  series_hourly: 'Visitors over time (Today): visitors and page views per local hour',
  series_hourly_sessions: 'Visitors over time (Today): sessions per local hour',
  top_pages: 'Top pages (from the 15-minute rollup)',
  sources: 'Traffic sources (grouped into Direct / Search / Social / Referral by apps/api/src/stats.ts channelOf) and Top referrers',
  countries: 'Top locations',
  devices: 'Device breakdown',
  browsers: 'Browser breakdown',
  capture_rate: 'Capture rate = received / expected',
  drops_by_reason: 'Dashboard warnings feed',
  drops_list: 'Suspicious activity page',
  events_by_name: 'Events page: count and last seen per event name',
  events_first_seen: 'Events page: "New" = a custom event first seen in the last 7 days',
  high_cardinality_props: 'Events page: high-cardinality property warning',
  live_active: 'Active visitors (last 5 minutes)',
  live_minutes: 'Live chart: visitors per minute, last 30 minutes',
  live_events: 'Live events list',
};

export function queriesMarkdown(): string {
  const parts = [
    '# Dashboard queries',
    '',
    'Generated from `apps/api/src/stats.ts` (a test fails if this file and the code differ).',
    'Every number on the dashboard comes from exactly one of these queries, so any of them can be',
    're-run by hand in the ClickHouse SQL console. Replace `{db}` with `tailwatch` and set the parameters first, e.g.:',
    '',
    '```sql',
    "SET param_site = 101, param_tz = 'Asia/Karachi', param_from = '2026-10-02 00:00:00', param_until = '2026-10-09 00:00:00';",
    "SET param_now = '2026-10-08 10:00:00.000'; -- live queries: the current time in UTC",
    '```',
    '',
    '`from` / `until` are LOCAL midnights in the site\'s timezone (`until` = the day after the last day shown).',
    'ClickHouse turns them into UTC instants with `toDateTime64(..., tz)`, so a DST day has 23 or 25 hours.',
    'Metric definitions: PLAN section 5 and `packages/contract/src/metrics.ts`.',
    '',
  ];
  for (const [name, sql] of Object.entries(QUERIES) as [QueryName, string][]) {
    parts.push(`## ${name}`, '', USED_BY[name], '', '```sql', sql, '```', '');
  }
  return parts.join('\n');
}
