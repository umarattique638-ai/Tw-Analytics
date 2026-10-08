import { useEffect, useRef, useState } from 'react';

/**
 * Loads data now and then every `everyMs` while the tab is visible. Keeps the last good result on a
 * failed refresh; `error` says why the latest attempt failed.
 */
export function usePoll<T>(load: () => Promise<T>, deps: unknown[], everyMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    setLoading(true);
    setData(null);
    const tick = async () => {
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
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading };
}
