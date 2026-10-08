import { num, percent } from '../../lib/format';

/** PLAN 5 ⭐ capture rate: received / expected beacons (from the per-page-load sequence numbers). */
export default function CaptureRate({ received, expected, rate }: { received: number; expected: number; rate: number | null }) {
  const pct = rate === null ? 0 : Math.min(rate * 100, 100);
  return (
    <section aria-label="Capture rate" className="grid items-center gap-6 rounded-2xl border border-teal-700/40 bg-teal-50 px-6 py-5 md:grid-cols-[auto_1fr] dark:border-teal-400/30 dark:bg-teal-950/60">
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Capture rate</p>
        <p data-testid="capture-rate" className="text-5xl font-extrabold leading-none tabular-nums text-slate-900 dark:text-white">{percent(rate)}</p>
      </div>
      <div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white dark:bg-slate-900">
          <span className="block h-full bg-teal-700 dark:bg-teal-400" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2.5 max-w-[70ch] text-sm text-slate-600 dark:text-slate-300">
          {rate === null
            ? 'No beacons in this period yet.'
            : <>We received {num(received)} of {num(expected)} expected beacons. Visitors whose script was blocked or who declined consent can't be counted at all, so real traffic is higher than shown.</>}
        </p>
      </div>
    </section>
  );
}
