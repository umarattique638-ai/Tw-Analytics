import { describe, expect, it } from 'vitest';
import type { ClickHouseClient } from '../src/repositories/clickhouse';
import { StatsReader } from '../src/repositories/stats';
import { resolveRange } from '../src/repositories/stats/range';

/**
 * Overview KPIs from the sessions query (no ClickHouse here: each named query gets a canned answer). The SQL
 * itself runs on a real server in test/live/stats.live.test.ts.
 */
function reader(sessions: { sessions: string; engaged_sessions: string; engagement_ms: string }) {
  const ch = {
    database: 'tailwatch',
    query: async (sql: string) => (sql.includes('FROM tailwatch.sessions') && sql.includes('engaged_sessions') ? [sessions] : []),
  } as unknown as ClickHouseClient;
  return new StatsReader(ch);
}

describe('overview KPIs', () => {
  it('average visit time = engaged time of all visits / visits', async () => {
    const o = await reader({ sessions: '4', engaged_sessions: '2', engagement_ms: '180000' }).overview(101, resolveRange('7d', 'Asia/Karachi', new Date('2026-10-15T10:00:00Z')));
    expect(o.kpis).toMatchObject({ sessions: 4, bounceRate: 0.5, avgVisitMs: 45_000 });
  });

  it('no visits: no average (not 0)', async () => {
    const o = await reader({ sessions: '0', engaged_sessions: '0', engagement_ms: '0' }).overview(101, resolveRange('today', 'Asia/Karachi', new Date('2026-10-15T10:00:00Z')));
    expect(o.kpis.avgVisitMs).toBeNull();
    expect(o.kpis.bounceRate).toBeNull();
  });
});
