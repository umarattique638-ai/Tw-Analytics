import { ObjectId } from 'mongodb';
import { HttpError } from '../http/errors';
import { FILTER_KEYS, RANGE_KEYS } from '../repositories/stats';
import type { FilterKey, Filters, RangeKey } from '../repositories/stats';

/** Request checks of the analytics pages and saved reports. Each throws the error the client sees. */

/** A `range` value from the client (`fallback` when it is missing), checked. */
export function rangeKeyInput(raw: string | undefined, fallback?: RangeKey): RangeKey {
  const key = (raw ?? fallback ?? '') as RangeKey;
  if (!RANGE_KEYS.includes(key)) throw new HttpError(400, 'invalid_range', `range is one of ${RANGE_KEYS.join(', ')}.`);
  return key;
}

/** Overview filters from the query string (?page=/pricing&country=PK): plain values, length-capped. */
export function filtersInput(query: (key: string) => string | undefined): Filters {
  const out: Filters = {};
  for (const k of FILTER_KEYS) {
    const v = query(k);
    if (typeof v === 'string' && v.trim() && v.length <= 500) out[k] = v;
  }
  return out;
}

/** The Filter menu: ?key=page|country|source|device|browser&q=search. */
export function filterValuesInput(rawKey: string | undefined, rawQ: string | undefined): { key: FilterKey; q: string } {
  const key = rawKey as FilterKey;
  if (!FILTER_KEYS.includes(key)) throw new HttpError(400, 'invalid_filter', 'Unknown filter.');
  return { key, q: (rawQ ?? '').trim().slice(0, 100) };
}

/** `:exportId` of the URL; anything that is not an id is simply "no such report". */
export function exportIdParam(raw: string | undefined): ObjectId {
  const id = raw ?? '';
  if (!/^[0-9a-f]{24}$/.test(id)) throw new HttpError(404, 'not_found', 'No such report.');
  return new ObjectId(id);
}
