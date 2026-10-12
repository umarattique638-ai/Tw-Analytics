import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CalendarDays, Check, ChevronDown } from 'lucide-react';
import type { RangeKey } from '../../api/client';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export const RANGES: { value: RangeKey; label: string; long: string; hint: string }[] = [
  { value: 'today', label: 'Today', long: 'Today', hint: 'Since midnight, per hour' },
  { value: '7d', label: '7 days', long: 'Last 7 days', hint: 'Per day' },
  { value: '30d', label: '30 days', long: 'Last 30 days', hint: 'Per day' },
];
export const rangeLong = (r: RangeKey) => RANGES.find((x) => x.value === r)?.long ?? r;

/**
 * The period of the report pages (shared by Overview, Events and Suspicious activity), as a dropdown.
 * Keyboard: Enter / Space / arrows open it, arrows move, Enter picks, Escape or Tab closes.
 */
export default function RangeSelect({ value, onChange }: { value: RangeKey; onChange: (v: RangeKey) => void }) {
  const selected = Math.max(
    RANGES.findIndex((r) => r.value === value),
    0,
  );
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(box, close, open);
  useEscapeKey(
    useCallback(() => {
      setOpen(false);
      button.current?.focus();
    }, []),
    open,
  );

  // Opening starts on the current choice.
  useEffect(() => {
    if (open) setActive(selected);
  }, [open, selected]);

  const choose = (i: number) => {
    onChange(RANGES[i]!.value);
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) setOpen(true);
        else setActive((a) => Math.min(a + 1, RANGES.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) setOpen(true);
        else setActive((a) => Math.max(a - 1, 0));
        break;
      case 'Home':
        if (open) (e.preventDefault(), setActive(0));
        break;
      case 'End':
        if (open) (e.preventDefault(), setActive(RANGES.length - 1));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) choose(active);
        else setOpen(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`Period: ${RANGES[selected]!.long}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`flex h-10 min-w-[168px] cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:ring-4 focus-visible:ring-teal-600/20 focus-visible:outline-none dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 ${
          open ? 'border-teal-600 dark:border-teal-400' : 'border-slate-300 dark:border-slate-700'
        }`}
      >
        <CalendarDays className="size-4 flex-none text-slate-400" aria-hidden="true" />
        <span className="flex-1 text-left">{RANGES[selected]!.long}</span>
        <ChevronDown className={`size-4 flex-none text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Period"
          className="absolute right-0 z-30 mt-1.5 w-60 origin-top-right animate-[tw-pop_120ms_ease-out] rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)] dark:border-slate-700 dark:bg-slate-900"
        >
          {RANGES.map((r, i) => {
            const isSelected = i === selected;
            return (
              <li
                key={r.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 ${
                  i === active ? 'bg-teal-50 dark:bg-teal-400/10' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm ${isSelected ? 'font-semibold text-teal-800 dark:text-teal-200' : 'font-medium text-slate-800 dark:text-slate-100'}`}>{r.long}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">{r.hint}</span>
                </span>
                {isSelected && <Check className="size-4 flex-none text-teal-600 dark:text-teal-400" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
