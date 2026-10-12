import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'teal' | 'amber' | 'rose' | 'violet' | 'emerald';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300',
};

/** A short status word ("Custom", "New · review", "in 12 days"). */
export default function Badge({ tone = 'neutral', children, className = '', title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}
