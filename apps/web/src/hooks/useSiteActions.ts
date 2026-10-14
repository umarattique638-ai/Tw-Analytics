import { useCallback, useState } from 'react';
import { api } from '../api/client';
import type { Site } from '../api/client';
import { notify } from '../lib/notify';

/**
 * Deleting a site from the sidebar, keeping its data or erasing it too. The site is gone once the API says so, even if reloading the list
 * afterwards fails; then the next site is selected, or "Add a site" opens when none is left.
 */
export function useDeleteSite(opts: { reload: () => Promise<Site[]>; currentId: number | null; select: (id: number) => void; onNoneLeft: () => void }) {
  const [target, setTarget] = useState<Site | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { reload, currentId, select, onNoneLeft } = opts;

  const confirm = useCallback(async (eraseData: boolean) => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteSite(target.id, eraseData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed.');
      setBusy(false);
      return;
    }
    notify.success(
      eraseData ? `${target.domain} and its data deleted` : `${target.domain} deleted`,
      { description: eraseData ? 'Everything collected for it is being erased. It cannot be brought back.' : 'It no longer collects. Adding it again brings the data back.' },
    );
    const remaining = await reload().catch(() => null);
    if (remaining && currentId === target.id) {
      if (remaining.length) select(remaining[0]!.id);
      else onNoneLeft();
    }
    setTarget(null);
    setBusy(false);
  }, [target, reload, currentId, select, onNoneLeft]);

  return {
    target,
    ask: (site: Site) => (setError(null), setTarget(site)),
    cancel: () => setTarget(null),
    confirm,
    busy,
    error,
  };
}
