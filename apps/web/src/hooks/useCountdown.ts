import { useEffect, useRef, useState } from 'react';

/**
 * Counts down from `seconds` while `active`, then calls `onDone` once. Stopping (active = false) resets it.
 * Returns the seconds left, or null when not counting.
 */
export function useCountdown(seconds: number, active: boolean, onDone: () => void): number | null {
  const [left, setLeft] = useState<number | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!active) {
      setLeft(null);
      return;
    }
    setLeft(seconds);
    const started = Date.now();
    const t = setInterval(() => {
      const remaining = seconds - Math.floor((Date.now() - started) / 1000);
      if (remaining <= 0) {
        clearInterval(t);
        setLeft(0);
        done.current();
      } else {
        setLeft(remaining);
      }
    }, 250);
    return () => clearInterval(t);
  }, [seconds, active]);

  return left;
}
