import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FilterKey, OverviewFilters } from '../api/client';

const KEYS: FilterKey[] = ['page', 'country', 'source', 'device', 'browser'];

/**
 * Decision 30: the overview's filters live in the address (?page=/pricing&country=PK), so the back button
 * undoes a click and a filtered view can be bookmarked. Another site: the filters are cleared.
 */
export function useOverviewFilters(siteId: number) {
  const [params, setParams] = useSearchParams();
  const filters = useMemo<OverviewFilters>(() => {
    const out: OverviewFilters = {};
    for (const k of KEYS) {
      const v = params.get(k);
      if (v) out[k] = v;
    }
    return out;
  }, [params]);

  const set = useCallback(
    (key: FilterKey, value: string) => {
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.set(key, value);
        return next;
      });
    },
    [setParams],
  );
  const remove = useCallback(
    (key: FilterKey) =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        next.delete(key);
        return next;
      }),
    [setParams],
  );
  const clear = useCallback(
    () =>
      setParams((p) => {
        const next = new URLSearchParams(p);
        for (const k of KEYS) next.delete(k);
        return next;
      }),
    [setParams],
  );

  const first = useRef(siteId);
  useEffect(() => {
    if (first.current === siteId) return;
    first.current = siteId;
    clear();
  }, [siteId, clear]);

  return { filters, set, remove, clear, active: KEYS.filter((k) => filters[k]) };
}
