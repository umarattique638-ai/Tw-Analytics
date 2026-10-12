import type { ReactNode } from 'react';
import { muted } from './styles';

/**
 * The title of a page, a sentence about it, and the page's own controls on the right.
 * `compact` is for the cards of the sign-in and setup screens.
 */
export default function PageHeader({ title, description, actions, compact }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  return (
    <header className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-4 ${compact ? 'mb-7' : ''}`}>
      <div className="min-w-0 max-w-2xl">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-900 dark:text-white">{title}</h1>
        {description && <p className={`mt-1.5 text-[15px] leading-relaxed ${muted}`}>{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
