import type { ReactNode } from 'react';

interface Props { title?: string; children: ReactNode; className?: string }

export default function Card({ title, children, className = '' }: Props) {
  return (
    <section className={`min-w-0 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 ${className}`}>
      {title && <h2 className="mb-3 text-[15px] font-extrabold">{title}</h2>}
      {children}
    </section>
  );
}
