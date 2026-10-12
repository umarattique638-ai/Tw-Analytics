import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** What an empty list says, and what to do about it. `compact` for small panels. */
export default function EmptyState({ icon: Icon, title, children, action, compact }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`grid place-items-center gap-2 text-center ${compact ? 'py-6' : 'py-10'}`}>
      {Icon && (
        <span className="grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      )}
      <p className={`font-semibold text-slate-800 dark:text-slate-100 ${compact ? 'text-sm' : 'text-[15px]'}`}>{title}</p>
      {children && <div className="max-w-sm text-sm text-slate-500 dark:text-slate-400">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
