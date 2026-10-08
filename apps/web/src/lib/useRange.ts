import { useState } from 'react';
import type { RangeKey } from '../api/client';

const KEY = 'tw_range';
const valid = (v: unknown): v is RangeKey => v === 'today' || v === '7d' || v === '30d';

/** The selected period, shared by the report pages and remembered for this browser tab. */
export function useRange(): [RangeKey, (r: RangeKey) => void] {
  const [range, setRange] = useState<RangeKey>(() => {
    try {
      const v = sessionStorage.getItem(KEY);
      return valid(v) ? v : '7d';
    } catch {
      return '7d';
    }
  });
  return [
    range,
    (r) => {
      setRange(r);
      try {
        sessionStorage.setItem(KEY, r);
      } catch {
        // storage blocked: the choice lasts until reload
      }
    },
  ];
}
