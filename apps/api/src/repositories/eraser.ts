import type { ClickHouseClient } from './clickhouse';

/**
 * Deleting analytics rows (Phase 3: retention pruning and account erasure).
 *
 * Runs as the ClickHouse user tw_prune (infra/clickhouse/004_prune_user.sql): SELECT and ALTER DELETE on
 * the four tailwatch tables, nothing else. The dashboard's tw_read stays read-only, and the consumer's
 * tw_insert can still only insert.
 *
 * A delete is an ALTER TABLE ... DELETE (a ClickHouse "mutation"): the server rewrites the affected parts in
 * the background and the rows are physically gone afterwards. It is sent only for tables that actually
 * hold matching rows, so a quiet night costs four cheap count queries and no rewrite.
 */
export const DATA_TABLES = ['events', 'sessions', 'dropped_hits', 'rollup_15m_pages'] as const;
export type DataTable = (typeof DATA_TABLES)[number];

/** The time column of each table, and the parameter type to compare it with. */
const TIME: Record<DataTable, { column: string; type: string }> = {
  events: { column: 'timestamp', type: "DateTime64(3, 'UTC')" },
  sessions: { column: 'start', type: "DateTime64(3, 'UTC')" },
  dropped_hits: { column: 'at', type: "DateTime64(3, 'UTC')" },
  rollup_15m_pages: { column: 'bucket', type: "DateTime('UTC')" },
};

/** Rows per table, per site. */
export type RowCounts = Record<DataTable, Map<number, number>>;

export interface AnalyticsEraser {
  /** Rows of these sites, per table and site; with `before`, only rows older than that instant. */
  count(siteIds: number[], before: Date | null): Promise<RowCounts>;
  /** Sends the deletes for these tables. ClickHouse finishes them in the background. */
  remove(siteIds: number[], before: Date | null, tables: DataTable[]): Promise<void>;
}

export const emptyCounts = (): RowCounts => ({ events: new Map(), sessions: new Map(), dropped_hits: new Map(), rollup_15m_pages: new Map() });

export function totalOf(counts: RowCounts, table?: DataTable): number {
  let n = 0;
  for (const t of table ? [table] : DATA_TABLES) for (const v of counts[t].values()) n += v;
  return n;
}

/** Tables that hold at least one matching row. */
export const tablesWithRows = (counts: RowCounts): DataTable[] => DATA_TABLES.filter((t) => totalOf(counts, t) > 0);

/** "2026-07-14 00:00:00.000" (DateTime64 parameter) and "2026-07-14 00:00:00" (DateTime parameter), UTC. */
const at64 = (d: Date) => d.toISOString().replace('T', ' ').replace('Z', '');
const at32 = (d: Date) => at64(d).slice(0, 19);

/** IN lists stay short: a few hundred sites per statement. */
const CHUNK = 500;
const chunks = <T>(list: T[]) => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));

export class ClickHouseEraser implements AnalyticsEraser {
  constructor(private readonly ch: ClickHouseClient) {}

  private where(table: DataTable, before: Date | null) {
    const { column, type } = TIME[table];
    const p = table === 'rollup_15m_pages' ? 'before_s' : 'before';
    return `site_id IN {ids:Array(UInt64)}${before ? ` AND ${column} < {${p}:${type}}` : ''}`;
  }

  private params(ids: number[], before: Date | null) {
    return { ids: `[${ids.join(',')}]`, ...(before ? { before: at64(before), before_s: at32(before) } : {}) };
  }

  async count(siteIds: number[], before: Date | null): Promise<RowCounts> {
    const out = emptyCounts();
    for (const ids of chunks(siteIds)) {
      if (!ids.length) continue;
      const sql = DATA_TABLES.map(
        (t) => `SELECT '${t}' AS t, toString(site_id) AS site, count() AS n FROM ${this.ch.database}.${t} WHERE ${this.where(t, before)} GROUP BY site_id`,
      ).join('\nUNION ALL\n');
      const rows = await this.ch.query<{ t: DataTable; site: string; n: string }>(sql, this.params(ids, before));
      for (const r of rows) out[r.t].set(Number(r.site), (out[r.t].get(Number(r.site)) ?? 0) + Number(r.n));
    }
    return out;
  }

  async remove(siteIds: number[], before: Date | null, tables: DataTable[]): Promise<void> {
    for (const ids of chunks(siteIds)) {
      if (!ids.length) continue;
      for (const t of tables) {
        await this.ch.exec(`ALTER TABLE ${this.ch.database}.${t} DELETE WHERE ${this.where(t, before)}`, this.params(ids, before));
      }
    }
  }
}

/** For tests: rows as (table, site, time). */
export class MemoryEraser implements AnalyticsEraser {
  rows: { table: DataTable; site: number; at: Date }[] = [];
  removes: { siteIds: number[]; before: Date | null; tables: DataTable[] }[] = [];
  down = false;

  async count(siteIds: number[], before: Date | null) {
    if (this.down) throw new Error('ClickHouse 503: unavailable');
    const out = emptyCounts();
    for (const r of this.rows) {
      if (!siteIds.includes(r.site) || (before && r.at.getTime() >= before.getTime())) continue;
      out[r.table].set(r.site, (out[r.table].get(r.site) ?? 0) + 1);
    }
    return out;
  }
  async remove(siteIds: number[], before: Date | null, tables: DataTable[]) {
    if (this.down) throw new Error('ClickHouse 503: unavailable');
    this.removes.push({ siteIds: [...siteIds], before, tables: [...tables] });
    this.rows = this.rows.filter((r) => !(tables.includes(r.table) && siteIds.includes(r.site) && (!before || r.at.getTime() < before.getTime())));
  }
}
