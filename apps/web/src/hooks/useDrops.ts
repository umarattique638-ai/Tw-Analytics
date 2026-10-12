import { useCallback, useMemo, useState } from 'react';
import { stats } from '../api/client';
import type { RangeKey, Site } from '../api/client';
import { notify } from '../lib/notify';
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

/**
 * "Allow host" on a hostname drop: the host joins the site's accepted hosts (the API writes Cloudflare first).
 * One request per host at a time; hosts allowed in this visit are remembered for the buttons. The result is a toast.
 */
export function useAllowHost(site: Site, onSite: (s: Site) => void) {
  const [busyHost, setBusyHost] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<string[]>([]);

  const isAllowed = useCallback((host: string) => allowed.includes(host) || site.allowedHosts.includes(host), [allowed, site.allowedHosts]);

  const allow = useCallback(
    async (host: string) => {
      if (busyHost) return;
      setBusyHost(host);
      try {
        const { site: updated, sync } = await stats.allowHost(site.id, host);
        onSite(updated);
        setAllowed((a) => [...a, host]);
        if (sync.ok) notify.success(`${host} is now accepted`, { description: 'New hits from it count from now on.' });
        else notify.warning(`${host} was added, but activation is pending`, { description: sync.message });
      } catch (e) {
        notify.error(e, 'Could not allow that host.');
      } finally {
        setBusyHost(null);
      }
    },
    [busyHost, site.id, onSite],
  );

  return { allow, isAllowed, busyHost };
}
