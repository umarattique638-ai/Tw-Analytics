import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { inputCls, muted } from './styles';

type Option = string | { value: string; label: string };

type SelectProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  name?: string;
  hint?: ReactNode;
  placeholder?: string;
};

const normalize = (o: Option) => (typeof o === 'string' ? { value: o, label: o } : o);

export default function Select({ label, value, onChange, options, name, hint, placeholder = 'Select…' }: SelectProps) {
  const items = options.map(normalize);
  const selectedIndex = items.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(Math.max(selectedIndex, 0));
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Type-to-find (long lists such as every IANA timezone): letters typed within 800 ms form a query.
  const typed = useRef({ text: '', at: 0 });
  const labelId = useId();
  const listId = useId();

  // bahar click karne par band
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // active option hamesha nazar aaye
  useEffect(() => {
    if (!open) return;
    (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openList = () => {
    setActive(Math.max(selectedIndex, 0));
    setOpen(true);
  };

  const choose = (i: number) => {
    onChange(items[i].value);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList();
        else setActive((a) => Math.min(a + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList();
        else setActive((a) => Math.max(a - 1, 0));
        break;
      case 'Home':
        if (open) { e.preventDefault(); setActive(0); }
        break;
      case 'End':
        if (open) { e.preventDefault(); setActive(items.length - 1); }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) choose(active);
        else openList();
        break;
      case 'Escape':
        if (open) { e.preventDefault(); setOpen(false); }
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          typed.current = { text: (now - typed.current.at < 800 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
          const q = typed.current.text;
          const hit =
            items.findIndex((o) => o.label.toLowerCase().startsWith(q)) >= 0
              ? items.findIndex((o) => o.label.toLowerCase().startsWith(q))
              : items.findIndex((o) => o.label.toLowerCase().includes(q));
          if (hit >= 0) {
            e.preventDefault();
            setOpen(true);
            setActive(hit);
          }
        }
    }
  };

  return (
    <div className="grid gap-1.5" ref={rootRef}>
      <span id={labelId} className="text-sm font-semibold">{label}</span>

      <div className="relative">
        <button
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-labelledby={labelId}
          onClick={() => (open ? setOpen(false) : openList())}
          onKeyDown={onKeyDown}
          className={`${inputCls} flex w-full cursor-pointer items-center justify-between gap-2 text-left`}
        >
          <span className={`truncate ${selected ? '' : 'text-slate-400'}`}>{selected ? selected.label : placeholder}</span>
          <ChevronDown className={`size-4 flex-none text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)] dark:border-slate-700 dark:bg-slate-900"
          >
            {items.map((o, i) => {
              const isSelected = o.value === value;
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${
                    i === active
                      ? 'bg-teal-50 text-teal-800 dark:bg-teal-400/10 dark:text-teal-200'
                      : 'text-slate-700 dark:text-slate-200'
                  } ${isSelected ? 'font-semibold' : ''}`}
                >
                  <span className="truncate">{o.label}</span>
                  {isSelected && <Check className="size-4 flex-none text-teal-600 dark:text-teal-400" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {name && <input type="hidden" name={name} value={value} />}
      {hint && <small className={`text-[13px] font-normal ${muted}`}>{hint}</small>}
    </div>
  );
}