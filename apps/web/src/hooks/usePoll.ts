import { useEffect, useRef, useState } from 'react';

export interface Polled<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/**
 * Loads data now, then every `everyMs` while the tab is visible, and once more as soon as a hidden tab
 * becomes visible again. Keeps the last good result when a refresh fails; `error` says why the latest
 * attempt failed. A change in `deps` (another site, another period) starts over with no data.
 */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], everyMs: number): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setData(null);
    setError(null);

    const tick = async () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        try {
          const d = await loader.current();
          if (live) {
            setData(d);
            setError(null);
          }
        } catch (e) {
          if (live) setError(e instanceof Error ? e.message : 'Could not load.');
        } finally {
          if (live) setLoading(false);
        }
      }
      if (live) timer = setTimeout(tick, everyMs);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };

    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading };
}
