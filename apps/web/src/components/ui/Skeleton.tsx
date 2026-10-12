/** A grey placeholder while data loads. */
export default function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800 ${className}`} />;
}

/** A few rows of placeholders for a list. */
export function SkeletonRows({ rows = 3, className = 'h-12' }: { rows?: number; className?: string }) {
  return (
    <div className="grid gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={`${className} w-full rounded-xl`} />
      ))}
    </div>
  );
}
