import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { reports, startDownload, stats } from '../api/client';
import type { Overview, OverviewFilters, RangeKey } from '../api/client';
import { notify } from '../lib/notify';
import { usePoll } from './usePoll';

export const OVERVIEW_EVERY_MS = 30_000;
export const LIVE_EVERY_MS = 10_000;

/**
 * The Overview page and the sidebar's capture rate ask for the same report at the same moment: one request
 * answers both (an answer is shared for 5 seconds).
 */
const recent = new Map<string, { at: number; answer: Promise<Overview> }>();
function overviewShared(siteId: number, range: RangeKey, filters: OverviewFilters = {}) {
  const key = `${siteId}:${range}:${JSON.stringify(filters)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < 5_000) return hit.answer;
  const answer = stats.overview(siteId, range, filters);
  recent.set(key, { at: Date.now(), answer });
  answer.catch(() => recent.delete(key));
  return answer;
}

/** KPIs, charts and top lists for one site and period (refreshed every minute). */
export const useOverview = (siteId: number, range: RangeKey, filters: OverviewFilters = {}) =>
  usePoll(() => overviewShared(siteId, range, filters), [siteId, range, JSON.stringify(filters)], OVERVIEW_EVERY_MS);

/** Active visitors and the latest hits (refreshed every 10 seconds). */
export const useLive = (siteId: number) => usePoll(() => stats.live(siteId), [siteId], LIVE_EVERY_MS);

/**
 * "Export CSV" on the dashboard: the report is saved (Reports page, kept 90 days) and downloaded at once.
 */
export function useCsvExport(siteId: number, range: RangeKey) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const exportCsv = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { export: r } = await reports.create(siteId, range);
      startDownload(reports.downloadUrl(siteId, r.id), r.filename);
      notify.success('CSV downloaded', { description: 'A copy is saved in Reports.', action: { label: 'Open', onClick: () => navigate('/reports') } });
    } catch (e) {
      notify.error(e, 'Export failed.');
    } finally {
      setBusy(false);
    }
  }, [busy, siteId, range, navigate]);

  return { exportCsv, busy };
}

/** "Good morning" by the browser's clock. */
export function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
