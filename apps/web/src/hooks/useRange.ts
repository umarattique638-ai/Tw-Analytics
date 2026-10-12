import { useCallback, useEffect, useState } from 'react';
import type { RangeKey } from '../api/client';

const KEY = 'tw_range';
const EVENT = 'tw:range';
const valid = (v: unknown): v is RangeKey => v === 'today' || v === '7d' || v === '30d';

function read(): RangeKey {
  try {
    const v = sessionStorage.getItem(KEY);
    return valid(v) ? v : '7d';
  } catch {
    return '7d';
  }
}

/**
 * The selected period, shared by the report pages (Dashboard, Events, Suspicious activity) and remembered
 * for this browser tab. Every mounted user of the hook follows a change at once.
 */
export function useRange(): [RangeKey, (r: RangeKey) => void] {
  const [range, setRange] = useState<RangeKey>(read);

  useEffect(() => {
    const follow = () => setRange(read());
    window.addEventListener(EVENT, follow);
    return () => window.removeEventListener(EVENT, follow);
  }, []);

  const change = useCallback((r: RangeKey) => {
    setRange(r);
    try {
      sessionStorage.setItem(KEY, r);
    } catch {
      // storage blocked: the choice lasts until reload
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [range, change];
}
