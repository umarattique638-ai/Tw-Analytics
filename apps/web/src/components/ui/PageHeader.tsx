import type { ReactNode } from 'react';
import { muted } from './styles';

export default function PageHeader({ title, sub }: { title: string; sub: ReactNode }) {
  return (
    <div className="mb-7">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h1>
      <p className={`mt-1.5 text-[15px] leading-relaxed ${muted}`}>{sub}</p>
    </div>
  );
}