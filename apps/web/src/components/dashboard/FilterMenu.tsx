import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, FileText, Filter, Globe, Link2, MapPin, Monitor, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { stats } from '../../api/client';
import type { FilterKey, OverviewFilters, RangeKey } from '../../api/client';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { capital, countryName, num } from '../../lib/format';

/** What can be filtered, in the menu's order. */
export const FILTERS: { key: FilterKey; label: string; icon: LucideIcon; search: string }[] = [
  { key: 'page', label: 'Page', icon: FileText, search: 'Search pages, e.g. /pricing' },
  { key: 'source', label: 'Referrer', icon: Link2, search: 'Search referrers' },
  { key: 'country', label: 'Country', icon: MapPin, search: 'Search countries' },
  { key: 'device', label: 'Device', icon: Monitor, search: 'Search devices' },
  { key: 'browser', label: 'Browser', icon: Globe, search: 'Search browsers' },
];

/** A value as people read it (country code -> name, "desktop" -> "Desktop"). */
export const filterLabel = (key: FilterKey, value: string) => {
  if (key === 'device') return capital(value);
  if (key !== 'country') return value;
  try {
    return countryName(value);
  } catch {
    return value; // not a country code: show it as it is
  }
};

type Value = { value: string; count: number };

/**
 * Decision 30: "Filter" next to the period. Step 1 picks what to filter by, step 2 picks a value from the
 * period's own values (most used first, with search). Keyboard: arrows move, Enter picks, Escape closes,
 * Backspace in an empty search goes back.
 */
export default function FilterMenu({ siteId, range, filters, onPick }: { siteId: number; range: RangeKey; filters: OverviewFilters; onPick: (key: FilterKey, value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<FilterKey | null>(null);
  const [query, setQuery] = useState('');
  // Tagged with their filter: switching from Page to Country never shows (or labels) the pages as countries.
  const [loaded, setLoaded] = useState<{ key: FilterKey; list: Value[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const count = Object.values(filters).filter(Boolean).length;

  const close = useCallback(() => {
    setOpen(false);
    setKey(null);
    setQuery('');
  }, []);
  useClickOutside(box, close, open);
  useEscapeKey(
    useCallback(() => {
      close();
      button.current?.focus();
    }, [close]),
    open,
  );

  // Countries are searched by their names here (the server knows only codes); the rest on the server.
  const serverQuery = useDebouncedValue(key === 'country' ? '' : query.trim(), 200);
  useEffect(() => {
    if (!open || !key) return;
    let live = true;
    setLoaded(null);
    setError(null);
    stats.filterValues(siteId, range, key, serverQuery).then(
      (r) => live && setLoaded({ key, list: r.values }),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [open, key, siteId, range, serverQuery]);

  const values = loaded && loaded.key === key ? loaded.list : null;
  const shown = useMemo(() => {
    const list = values ?? [];
    if (key !== 'country' || !query.trim()) return list;
    const q = query.trim().toLowerCase();
    return list.filter((v) => filterLabel('country', v.value).toLowerCase().includes(q) || v.value.toLowerCase() === q);
  }, [values, key, query]);

  useEffect(() => setQuery(''), [key]);
  useEffect(() => setActive(0), [key, shown.length]);
  useEffect(() => {
    if (key) input.current?.focus();
  }, [key]);

  const pick = (v: Value) => {
    onPick(key!, v.value);
    close();
    button.current?.focus();
  };

  const rows = key ? shown.length : FILTERS.length;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, rows - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (!key) setKey(FILTERS[active]!.key);
      else if (shown[active]) pick(shown[active]!);
    } else if (e.key === 'Backspace' && key && !query) {
      e.preventDefault();
      setKey(null);
    }
  };

  const meta = FILTERS.find((f) => f.key === key);

  return (
    <div ref={box} className="relative" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-10 cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:ring-4 focus-visible:ring-teal-600/20 focus-visible:outline-none dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${
          open || count ? 'border-teal-600 dark:border-teal-400' : 'border-slate-300 dark:border-slate-700'
        }`}
      >
        <Filter className="size-4 flex-none text-slate-400" aria-hidden="true" />
        Filter
        {count > 0 && <span className="grid size-5 place-items-center rounded-full bg-teal-600 text-[11px] font-semibold text-white dark:bg-teal-500">{count}</span>}
        <ChevronDown className={`size-4 flex-none text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={meta ? `Filter by ${meta.label.toLowerCase()}` : 'Filter by'}
          data-testid="filter-menu"
          className="absolute right-0 z-30 mt-1.5 w-[min(20rem,calc(100vw-2rem))] origin-top-right animate-[tw-pop_120ms_ease-out] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)] dark:border-slate-700 dark:bg-slate-900"
        >
          {!meta ? (
            <ul role="listbox" id={listId} aria-label="Filter by" className="p-1" tabIndex={-1}>
              <li className="px-3 pt-2 pb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400" role="presentation">
                Filter by
              </li>
              {FILTERS.map((f, i) => {
                const Icon = f.icon;
                const set = filters[f.key];
                return (
                  <li
                    key={f.key}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setKey(f.key);
                    }}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? 'bg-teal-50 dark:bg-teal-400/10' : ''}`}
                  >
                    <Icon className="size-4 flex-none text-slate-400" aria-hidden="true" />
                    <span className="flex-1 font-medium text-slate-800 dark:text-slate-100">{f.label}</span>
                    {set && <span className="max-w-[120px] truncate text-xs text-teal-700 dark:text-teal-300">{filterLabel(f.key, set)}</span>}
                    <ChevronRight className="size-4 flex-none text-slate-400" aria-hidden="true" />
                  </li>
                );
              })}
            </ul>
          ) : (
            <div>
              <div className="flex items-center gap-1 border-b border-slate-100 p-1.5 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setKey(null)}
                  aria-label="Back"
                  className="grid size-8 flex-none place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:outline-none dark:hover:bg-slate-800"
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                </button>
                <label className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    ref={input}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={meta.search}
                    aria-label={meta.search}
                    aria-controls={listId}
                    spellCheck={false}
                    autoComplete="off"
                    className="h-9 w-full rounded-lg bg-slate-50 pr-2 pl-8 text-sm text-slate-800 placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500/30 focus:outline-none dark:bg-slate-800 dark:text-slate-100"
                  />
                </label>
              </div>
              <ul role="listbox" id={listId} aria-label={`${meta.label} values`} className="max-h-72 overflow-y-auto p-1">
                {error && <li className="px-3 py-3 text-sm text-rose-600 dark:text-rose-400">{error}</li>}
                {!error && values === null && (
                  <li className="grid gap-2 p-2" aria-label="Loading">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="h-7 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
                    ))}
                  </li>
                )}
                {!error && values !== null && shown.length === 0 && (
                  <li className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">{query ? 'Nothing matches.' : 'No data in this period.'}</li>
                )}
                {shown.map((v, i) => {
                  const on = filters[key!] === v.value;
                  return (
                    <li
                      key={v.value}
                      role="option"
                      aria-selected={on}
                      onMouseEnter={() => setActive(i)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pick(v);
                      }}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? 'bg-teal-50 dark:bg-teal-400/10' : ''}`}
                    >
                      <span className={`min-w-0 flex-1 truncate ${on ? 'font-semibold text-teal-800 dark:text-teal-200' : 'text-slate-800 dark:text-slate-100'}`}>{filterLabel(key!, v.value)}</span>
                      <span className="flex-none text-xs text-slate-500 tabular-nums dark:text-slate-400">{num(v.count)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
