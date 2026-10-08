interface Props { received: number; expected: number }

export default function CaptureRate({ received, expected }: Props) {
  const pct = (received / expected) * 100;
  return (
    <section
      aria-label="Capture rate"
      className="mb-4 grid items-center gap-8 rounded-2xl border border-teal-700 bg-teal-50 px-7 py-6 max-md:gap-3 md:grid-cols-[auto_1fr] dark:border-teal-400 dark:bg-teal-950"
    >
      <div>
        <p className="text-sm font-semibold">Capture rate</p>
        <p className="text-6xl font-extrabold leading-none">{pct.toFixed(1)}%</p>
      </div>
      <div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white dark:bg-slate-900">
          <span className="block h-full bg-teal-700 dark:bg-teal-400" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2.5 max-w-[62ch] text-sm">
          We received {received.toLocaleString()} of {expected.toLocaleString()} expected beacons.
          Visitors whose script was blocked or who declined consent can't be counted, so real traffic is higher than shown.
        </p>
      </div>
    </section>
  );
}
