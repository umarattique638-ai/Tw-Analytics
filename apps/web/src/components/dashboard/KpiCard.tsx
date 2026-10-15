import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import Skeleton from '../ui/Skeleton';

type Props = {
  icon: LucideIcon;
  label: string;
  /** Null while loading. */
  value: string | null;
  delta?: string;
  /** Whether the change is good news (green) or bad (red). */
  positive?: boolean;
  /** Arrow direction. */
  up?: boolean;
  /** A short line under the value when there is no change to show ("Too few visits yet"). */
  note?: string;
};

/** One headline number. */
export default function KpiCard({ icon: Icon, label, value, delta, positive = true, up = true, note }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
        <span className="grid size-9 flex-none place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300">
          <Icon className="size-[18px]" aria-hidden="true" />
        </span>
      </div>
      {value === null ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-2 text-[28px] leading-tight font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">{value}</p>
      )}
      {!delta && note && value !== null && <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">{note}</p>}
      {delta && (
        <p className={`mt-1.5 flex flex-wrap items-center gap-1 text-xs font-medium ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {up ? <ArrowUpRight className="size-3.5" aria-hidden="true" /> : <ArrowDownRight className="size-3.5" aria-hidden="true" />}
          {up ? 'Up' : 'Down'} {delta}
          <span className="font-normal text-slate-400 dark:text-slate-500">vs previous period</span>
        </p>
      )}
    </div>
  );
}
