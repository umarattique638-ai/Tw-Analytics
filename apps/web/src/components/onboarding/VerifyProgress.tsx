/** The bar above the install check: how many checks are done, and whether one failed. */
export default function VerifyProgress({ label, progress, failed }: { label: string; progress: number; failed: boolean }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
        <span aria-live="polite">{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Install check progress">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${failed ? 'bg-red-500' : 'bg-gradient-to-r from-teal-500 to-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
