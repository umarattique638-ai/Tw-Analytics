import { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import Button from '../ui/Button';
import Panel from '../ui/Panel';
import type { RangeKey } from '../../api/client';

const RANGES: { value: RangeKey; label: string; hint: string }[] = [
  { value: 'today', label: 'Today', hint: 'One row per hour' },
  { value: '7d', label: 'Last 7 days', hint: 'One row per day' },
  { value: '30d', label: 'Last 30 days', hint: 'One row per day' },
];

/** Pick a period, make the CSV: it is saved and downloaded at once. */
export default function NewReport({ timezone, creating, onCreate }: { timezone: string; creating: boolean; onCreate: (r: RangeKey) => void }) {
  const [range, setRange] = useState<RangeKey>('30d');
  const move = (dir: number) => {
    const i = RANGES.findIndex((r) => r.value === range);
    setRange(RANGES[(i + dir + RANGES.length) % RANGES.length]!.value);
  };

  return (
    <Panel title="New report" subtitle="Visitors, sessions and page views: the same numbers as the Visitors over time chart">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <fieldset className="min-w-0 flex-1">
          <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Date range</legend>
          <div
            role="radiogroup"
            aria-label="Date range"
            className="grid gap-2 sm:grid-cols-3"
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), move(1));
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), move(-1));
            }}
          >
            {RANGES.map((r) => {
              const on = r.value === range;
              return (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setRange(r.value)}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/20 ${
                    on
                      ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-600 dark:border-teal-400 dark:bg-teal-400/10 dark:ring-teal-400'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
                  }`}
                >
                  <span className={`grid size-4 flex-none place-items-center rounded-full border-2 ${on ? 'border-teal-600 dark:border-teal-400' : 'border-slate-300 dark:border-slate-600'}`} aria-hidden="true">
                    {on && <span className="size-1.5 rounded-full bg-teal-600 dark:bg-teal-400" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">{r.label}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{r.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <Button className="h-12 flex-none px-6" onClick={() => onCreate(range)} loading={creating} data-testid="create-report">
          {!creating && <Download className="size-4" aria-hidden="true" />}
          {creating ? 'Preparing…' : 'Create & download'}
        </Button>
      </div>
      <p className="mt-4 flex items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400">
        <FileSpreadsheet className="size-4 flex-none" aria-hidden="true" />
        Days are counted in {timezone}. Opens in Excel or Google Sheets.
      </p>
    </Panel>
  );
}
