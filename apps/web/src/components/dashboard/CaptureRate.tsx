import { num, percent } from '../../lib/format';

/** PLAN 5: capture rate = received / expected beacons (from the per-page-load sequence numbers). */
export default function CaptureRate({ received, expected, rate }: { received: number; expected: number; rate: number | null }) {
  const pct = rate === null ? 0 : Math.min(rate * 100, 100);
  return (
    <section
      aria-label="Capture rate"
      className="grid items-center gap-x-8 gap-y-4 rounded-2xl border border-teal-700/30 bg-gradient-to-br from-teal-50 to-white px-6 py-5 md:grid-cols-[auto_1fr] dark:border-teal-400/25 dark:from-teal-950/70 dark:to-slate-900"
    >
      <div>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Capture rate</p>
        <p data-testid="capture-rate" className="mt-1 text-5xl leading-none font-bold tracking-tight text-slate-900 tabular-nums dark:text-white">
          {percent(rate)}
        </p>
      </div>
      <div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white ring-1 ring-teal-700/10 dark:bg-slate-900 dark:ring-white/5" role="presentation">
          <span className="block h-full rounded-full bg-gradient-to-r from-teal-600 to-teal-400" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2.5 max-w-[70ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          {rate === null ? (
            'No beacons in this period yet.'
          ) : (
            <>
              We received {num(received)} of {num(expected)} expected beacons. Visitors whose script was blocked or who declined consent can't be counted at all, so real traffic is
              higher than shown.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
