import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

type Props = {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: string;
  positive?: boolean; // green ya red
  up?: boolean; // arrow ki direction
};

export default function KpiCard({ icon: Icon, label, value, delta, positive = true, up = true }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between">
        <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
        <span className="grid size-9 place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300">
          <Icon className="size-[18px]" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-white">{value}</p>
      {delta && (
        <p className={`mt-1.5 flex items-center gap-1 text-xs font-medium ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
          {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
          {delta}
          <span className="font-normal text-slate-400 dark:text-slate-500">vs previous period</span>
        </p>
      )}
    </div>
  );
}