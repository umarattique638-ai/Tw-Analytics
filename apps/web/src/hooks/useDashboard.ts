import { useCallback, useState } from 'react';
import { reports, startDownload, stats } from '../api/client';
import type { RangeKey } from '../api/client';
import { usePoll } from './usePoll';

export const OVERVIEW_EVERY_MS = 60_000;
export const LIVE_EVERY_MS = 10_000;

/** KPIs, charts and top lists for one site and period (refreshed every minute). */
export const useOverview = (siteId: number, range: RangeKey) => usePoll(() => stats.overview(siteId, range), [siteId, range], OVERVIEW_EVERY_MS);

/** Active visitors and the latest hits (refreshed every 10 seconds). */
export const useLive = (siteId: number) => usePoll(() => stats.live(siteId), [siteId], LIVE_EVERY_MS);

/**
 * "Export CSV" on the dashboard: the report is saved (Reports page, kept 90 days) and downloaded at once.
 */
export function useCsvExport(siteId: number, range: RangeKey) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const exportCsv = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const { export: r } = await reports.create(siteId, range);
      startDownload(reports.downloadUrl(siteId, r.id), r.filename);
      setResult({ ok: true, text: 'Saved to Reports' });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Export failed.' });
    } finally {
      setBusy(false);
    }
  }, [siteId, range]);

  return { exportCsv, busy, result };
}

/** "Good morning" by the browser's clock. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
