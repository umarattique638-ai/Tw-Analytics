import type { LucideIcon } from 'lucide-react';
import type { Row } from '../../data/dashboardMock';

type Props = {
  rows: Row[];
  iconFor?: (label: string) => LucideIcon;
};

export default function VerticalBars({ rows, iconFor }: Props) {
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div className="flex gap-3 sm:gap-6">
      {rows.map((r, i) => {
        const Icon = iconFor?.(r.label);
        const height = Math.max((r.value / max) * 100, 4);
        return (
          <div key={r.label} className="group flex min-w-0 flex-1 flex-col items-center">
            {/* chart area: fixed height, bar neeche se upar barhta hai */}
            <div className="flex h-56 w-full flex-col items-center justify-end border-b border-slate-200 dark:border-slate-800">
              <div className="mb-2 text-center">
                <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{r.value.toLocaleString()}</p>
                <p className="text-xs font-medium text-teal-700 dark:text-teal-400">{r.pct}%</p>
              </div>
              <div
                className="w-full max-w-[72px] rounded-t-xl bg-gradient-to-t from-teal-700 to-teal-400 shadow-[0_8px_20px_-8px_rgba(13,148,136,0.6)] transition-all duration-700 ease-out group-hover:from-teal-600 group-hover:to-teal-300 dark:from-teal-500 dark:to-teal-300"
                style={{ height: `${height * 0.7}%`, opacity: 1 - i * 0.08 }}
              />
            </div>

            {/* label */}
            <div className="mt-3 flex max-w-full items-center justify-center gap-1.5 text-[13px] font-medium text-slate-600 dark:text-slate-300">
              {Icon && <Icon className="size-3.5 flex-none text-slate-400" />}
              <span className="truncate">{r.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}