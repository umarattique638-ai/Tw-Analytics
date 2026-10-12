import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { account } from '../api/client';
import type { AuditEntry } from '../api/client';

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/**
 * The activity log, newest first, 50 at a time, optionally for one site. Only the newest request may
 * update the list, so a slow answer for the previous filter never overwrites the current one.
 */
export function useActivity() {
  const [site, setSite] = useState<number | null>(null);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [keepDays, setKeepDays] = useState(400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(
    async (before: string | null) => {
      const ticket = ++latest.current;
      setBusy(true);
      setError(null);
      try {
        const r = await account.activity({ before, site });
        if (ticket !== latest.current) return;
        setEntries((list) => (before ? [...(list ?? []), ...r.entries] : r.entries));
        setNext(r.next);
        setKeepDays(r.keepDays);
      } catch (e) {
        if (ticket === latest.current) setError(e instanceof Error ? e.message : 'Could not load the activity log.');
      } finally {
        if (ticket === latest.current) setBusy(false);
      }
    },
    [site],
  );

  useEffect(() => {
    setEntries(null);
    load(null);
  }, [load]);

  /** Entries grouped by local day, newest day first. */
  const days = useMemo(() => {
    const out: { key: string; label: string; items: AuditEntry[] }[] = [];
    for (const e of entries ?? []) {
      const key = dayKey(e.at);
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, label: dayFmt.format(new Date(e.at)), items: [e] });
    }
    return out;
  }, [entries]);

  return {
    site,
    setSite,
    entries,
    days,
    keepDays,
    busy,
    error,
    hasMore: !!next,
    loadMore: () => next && load(next),
    refresh: () => load(null),
  };
}
