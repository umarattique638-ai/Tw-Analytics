import { useCallback, useEffect, useState } from 'react';
import { reports, startDownload } from '../api/client';
import type { RangeKey, Report } from '../api/client';
import { useNotice } from './useNotice';

/** Saved CSV reports of a site: list, make (and download), delete. */
export function useReports(siteId: number) {
  const [list, setList] = useState<Report[] | null>(null);
  const [keepDays, setKeepDays] = useState(90);
  const [max, setMax] = useState(200);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const { notice, show, clear } = useNotice();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const r = await reports.list(siteId);
      setList(r.exports);
      setKeepDays(r.keepDays);
      setMax(r.max);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your reports.');
    }
  }, [siteId]);

  useEffect(() => {
    setList(null);
    clear();
    load();
  }, [load, clear]);

  const create = useCallback(
    async (range: RangeKey) => {
      if (creating) return;
      setCreating(true);
      clear();
      try {
        const { export: r } = await reports.create(siteId, range);
        setList((l) => [r, ...(l ?? [])]);
        setFresh(r.id);
        startDownload(reports.downloadUrl(siteId, r.id), r.filename);
        show('success', `Report saved and downloading: ${r.filename}`);
      } catch (e) {
        show('error', e instanceof Error ? e.message : 'The report could not be made.');
      } finally {
        setCreating(false);
      }
    },
    [creating, siteId, show, clear],
  );

  const remove = useCallback(
    async (report: Report) => {
      setDeleting(true);
      try {
        await reports.remove(siteId, report.id);
        setList((l) => (l ?? []).filter((r) => r.id !== report.id));
        show('success', 'Report deleted.');
        return true;
      } catch (e) {
        show('error', e instanceof Error ? e.message : 'The report could not be deleted.');
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [siteId, show],
  );

  return { list, keepDays, max, loadError, reload: load, create, creating, remove, deleting, fresh, notice };
}
