import { muted } from './styles';

export default function Divider({ children }: { children: string }) {
  return (
    <div className={`my-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-wider ${muted}`}>
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      {children}
      <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}