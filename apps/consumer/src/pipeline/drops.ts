import { chTime } from '../core/rows';
import type { DroppedRow } from '../core/rows';

/** One dropped hit, before it is aggregated into dropped_hits rows. */
export interface DropItem {
  siteId: number;
  at: number;
  reason: string;
  detail: string;
  country: string;
  asn: number;
  /** Identical drops this item stands for (a batched drop message from the collector). Default 1. */
  hits?: number;
}

const minuteOf = (ms: number): number => Math.floor(ms / 60_000) * 60_000;

/** Same site, reason, detail, country, asn and minute collapse into one row with hits = n. */
export function aggregateDrops(items: readonly DropItem[]): DroppedRow[] {
  const map = new Map<string, DroppedRow>();
  for (const d of items) {
    const at = minuteOf(d.at);
    const key = [d.siteId, d.reason, d.detail, d.country, d.asn, at].join('|');
    const hit = map.get(key);
    const n = d.hits ?? 1;
    if (hit) hit.hits += n;
    else map.set(key, { site_id: d.siteId, at: chTime(at), reason: d.reason, detail: d.detail, country_code: d.country, asn: d.asn, hits: n });
  }
  return [...map.values()];
}
