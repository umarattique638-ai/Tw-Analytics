import type { ReactNode } from 'react';

type Props = {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Content that runs edge to edge (tables): no inner padding. */
  flush?: boolean;
  tone?: 'default' | 'danger';
  children: ReactNode;
  testId?: string;
};

/** A titled section of a page. */
export default function Panel({ title, subtitle, action, className = '', flush, tone = 'default', children, testId }: Props) {
  const danger = tone === 'danger';
  return (
    <section
      data-testid={testId}
      className={`flex min-w-0 flex-col rounded-2xl border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:bg-slate-900 ${
        danger ? 'border-rose-200 dark:border-rose-400/25' : 'border-slate-200/80 dark:border-slate-800'
      } ${className}`}
    >
      <header className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b px-5 py-4 sm:px-6 ${danger ? 'border-rose-100 dark:border-rose-400/15' : 'border-slate-100 dark:border-slate-800'}`}>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </header>
      <div className={`min-w-0 flex-1 ${flush ? '' : 'p-5 sm:p-6'}`}>{children}</div>
    </section>
  );
}
