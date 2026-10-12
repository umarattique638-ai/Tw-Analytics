type Option<T extends string> = { value: T; label: string };

/** A small set of mutually exclusive choices shown side by side (filters). Arrow keys move between them. */
export default function SegmentedControl<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: Option<T>[]; onChange: (v: T) => void; disabled?: boolean }) {
  const move = (dir: number) => {
    if (disabled) return;
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + dir + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), move(1));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), move(-1));
      }}
      className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/70"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={`h-8 rounded-lg px-3 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/20 disabled:cursor-not-allowed ${
              on ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white' : 'text-slate-600 hover:text-slate-900 disabled:opacity-60 disabled:hover:text-slate-600 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
