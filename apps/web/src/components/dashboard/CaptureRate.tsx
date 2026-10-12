import { Gauge, Info } from 'lucide-react';
import Skeleton from '../ui/Skeleton';
import { num, percent } from '../../lib/format';

type Capture = { received: number; expected: number; rate: number | null };

const EXPLAIN =
  "Beacons received out of those expected. Visitors whose script was blocked or who declined consent can't be counted at all, so real traffic is higher than shown.";

/**
 * PLAN 5: capture rate = received / expected beacons (from the per-page-load sequence numbers).
 * A card in the KPI row, a little more prominent than the others: it is the number that says how much
 * the other numbers can be trusted.
 */
export default function CaptureRate({ capture }: { capture: Capture | null }) {
  const pct = capture?.rate == null ? 0 : Math.min(capture.rate * 100, 100);
  const tone = capture?.rate == null ? 'bg-slate-300' : pct >= 85 ? 'bg-gradient-to-r from-teal-600 to-teal-400' : 'bg-gradient-to-r from-amber-500 to-amber-400';

  return (
    <section
      aria-label="Capture rate"
      className="rounded-2xl border border-teal-700/30 bg-gradient-to-br from-teal-50 to-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:border-teal-400/25 dark:from-teal-950/70 dark:to-slate-900"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
          Capture rate
          <span title={EXPLAIN} className="cursor-help text-slate-400" aria-label={EXPLAIN} role="img">
            <Info className="size-3.5" aria-hidden="true" />
          </span>
        </span>
        <span className="grid size-9 flex-none place-items-center rounded-lg bg-teal-700 text-white dark:bg-teal-400 dark:text-slate-950">
          <Gauge className="size-[18px]" aria-hidden="true" />
        </span>
      </div>

      {capture === null ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <>
          <p data-testid="capture-rate" className="mt-2 text-[28px] leading-tight font-semibold tracking-tight text-slate-900 tabular-nums dark:text-white">
            {percent(capture.rate)}
          </p>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white ring-1 ring-teal-700/10 dark:bg-slate-800 dark:ring-white/5" aria-hidden="true">
            <span className={`block h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {capture.rate === null ? 'No beacons in this period yet' : `${num(capture.received)} of ${num(capture.expected)} beacons`}
          </p>
        </>
      )}
    </section>
  );
}
