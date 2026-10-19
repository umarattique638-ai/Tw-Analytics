import { Filter, X } from 'lucide-react';
import type { FilterKey, OverviewFilters } from '../../api/client';
import { capital, countryName } from '../../lib/format';

const NAME: Record<FilterKey, string> = { page: 'Page', country: 'Country', source: 'Referrer', device: 'Device', browser: 'Browser' };
const shown = (k: FilterKey, v: string) => (k === 'country' ? countryName(v) : k === 'device' ? capital(v) : v);

/** Decision 30: what the overview is narrowed to, each removable; live numbers are never filtered. */
export default function FilterBar({ filters, active, onRemove, onClear }: { filters: OverviewFilters; active: FilterKey[]; onRemove: (k: FilterKey) => void; onClear: () => void }) {
  if (active.length === 0) return null;
  return (
    // Right under the Filter button (right-aligned), so the chips read as that button's state. On a narrow
    // screen the header's buttons wrap to the left, and so does this.
    <div className="-mt-3 flex flex-col items-start gap-1.5 sm:items-end" data-testid="filter-bar">
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <span className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
          <Filter className="size-4" aria-hidden="true" /> Showing only
        </span>
        {active.map((k) => (
          <span key={k} className="flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 py-1 pr-1 pl-2.5 text-sm text-teal-900 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-100">
            <span className="text-teal-700/80 dark:text-teal-300/80">{NAME[k]}</span>
            <b className="max-w-[240px] truncate font-semibold">{shown(k, filters[k]!)}</b>
            <button
              type="button"
              onClick={() => onRemove(k)}
              aria-label={`Remove the ${NAME[k].toLowerCase()} filter`}
              className="grid size-6 place-items-center rounded-md hover:bg-teal-100 focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:outline-none dark:hover:bg-teal-400/20"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        {active.length > 1 && (
          <button type="button" onClick={onClear} className="text-sm font-medium text-teal-700 hover:underline dark:text-teal-300">
            Clear all
          </button>
        )}
      </div>
      <span className="text-xs text-slate-400 dark:text-slate-500">Active now, Live visitors and Latest hits are not filtered.</span>
    </div>
  );
}
