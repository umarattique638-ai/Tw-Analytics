import { useMemo, useState } from 'react';
import { stats } from '../api/client';
import type { RangeKey } from '../api/client';
import { usePoll } from './usePoll';

/** Dropped hits of a site in a period, grouped by reason, plus the page's reason filter. */
export function useDropsReport(siteId: number, range: RangeKey) {
  const report = usePoll(() => stats.drops(siteId, range), [siteId, range], 60_000);
  const [filter, setFilter] = useState('all');
  const rows = report.data?.rows ?? [];

  const { byReason, total, reasons } = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.reason, (map.get(r.reason) ?? 0) + r.hits);
    return { byReason: map, total: [...map.values()].reduce((a, b) => a + b, 0), reasons: [...map.entries()].sort((a, b) => b[1] - a[1]) };
  }, [rows]);

  const shown = useMemo(() => rows.filter((r) => filter === 'all' || r.reason === filter), [rows, filter]);
  return { report, byReason, total, reasons, shown, filter, setFilter };
}
