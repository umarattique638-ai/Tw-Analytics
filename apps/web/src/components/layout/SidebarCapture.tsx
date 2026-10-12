import { Info } from 'lucide-react';
import { rangeLong } from '../dashboard/RangeSelect';
import type { Site } from '../../api/client';
import { num, percent } from '../../lib/format';
import { useOverview } from '../../hooks/useDashboard';
import { useRange } from '../../hooks/useRange';

const EXPLAIN =
  "Beacons received out of those expected. Visitors whose script was blocked or who declined consent can't be counted at all, so real traffic is higher than shown.";

/**
 * PLAN 5: capture rate = received / expected beacons, for the selected site and period, always in view in
 * the sidebar: it says how far the other numbers can be trusted. Below 85% it turns amber.
 */
export default function SidebarCapture({ site }: { site: Site }) {
  const [range] = useRange();
  const { data, error } = useOverview(site.id, range);
  const c = data?.capture ?? null;
  const pct = c?.rate == null ? 0 : Math.min(c.rate * 100, 100);
  const low = c?.rate != null && pct < 85;

  return (
    <section aria-label="Capture rate" className="rounded-xl border border-white/10 bg-gradient-to-br from-teal-400/[0.12] to-white/[0.03] p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          Capture rate
          <span title={EXPLAIN} aria-label={EXPLAIN} role="img" className="cursor-help text-slate-500 hover:text-slate-300">
            <Info className="size-3.5" aria-hidden="true" />
          </span>
        </span>
        <span className="text-[11px] text-slate-500">{rangeLong(range)}</span>
      </div>

      {c === null ? (
        error ? (
          <p className="mt-2 text-xs text-slate-500">Not available right now</p>
        ) : (
          <span aria-hidden="true" className="mt-2 block h-7 w-20 animate-pulse rounded-md bg-white/10" />
        )
      ) : (
        <>
          <p data-testid="capture-rate" className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${low ? 'text-amber-300' : 'text-white'}`}>
            {percent(c.rate)}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <span className={`block h-full rounded-full ${low ? 'bg-amber-400' : 'bg-gradient-to-r from-teal-500 to-teal-300'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">{c.rate === null ? 'No beacons in this period yet' : `${num(c.received)} of ${num(c.expected)} beacons`}</p>
        </>
      )}
    </section>
  );
}
