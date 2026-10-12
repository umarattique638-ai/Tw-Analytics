import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs one async action (a form submit, a button) with `busy` and `error` state. A second call while the
 * first is running is ignored, so a double click never sends two requests. Returns the result, or
 * undefined when it failed (the message is in `error`).
 */
export function useAction<A extends unknown[], R>(action: (...args: A) => Promise<R>, fallback = 'Something went wrong. Try again.') {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const fn = useRef(action);
  fn.current = action;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (running.current) return undefined;
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        return await fn.current(...args);
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : fallback);
        return undefined;
      } finally {
        running.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [fallback],
  );

  return { run, busy, error, setError };
}
