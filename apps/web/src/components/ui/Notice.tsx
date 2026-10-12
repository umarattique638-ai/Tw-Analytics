import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';

export type NoticeTone = 'success' | 'error' | 'info' | 'warning';

const look: Record<NoticeTone, { cls: string; icon: typeof Info }> = {
  success: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100', icon: CheckCircle2 },
  error: { cls: 'border-red-200 bg-red-50 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200', icon: XCircle },
  warning: { cls: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100', icon: AlertTriangle },
  info: { cls: 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-100', icon: Info },
};

/**
 * A message that belongs to a place on the page: a form error, a load error, a state that lasts ("not active
 * at the edge yet"). The result of an action is a toast instead (lib/notify.ts). Errors are announced at once.
 */
export default function Notice({ tone, children, action, className = '' }: { tone: NoticeTone; children: ReactNode; action?: ReactNode; className?: string }) {
  const { cls, icon: Icon } = look[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${cls} ${className}`}>
      <Icon className="mt-0.5 size-4 flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}
