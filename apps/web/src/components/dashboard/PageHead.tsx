import type { ReactNode } from 'react';

interface Props { title: string; sub: string; action?: ReactNode }

export default function PageHead({ title, sub, action }: Props) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{sub}</p>
      </div>
      {action}
    </div>
  );
}