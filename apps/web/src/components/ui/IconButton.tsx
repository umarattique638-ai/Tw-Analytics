import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

export const iconButtonCls =
  'grid size-9 flex-none cursor-pointer place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/20 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white';

const dangerCls = 'hover:!border-rose-200 hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!border-rose-400/30 dark:hover:!bg-rose-400/10 dark:hover:!text-rose-300';

/** A square button with only an icon. `label` is what screen readers and the tooltip say. */
export default function IconButton({ icon: Icon, label, spin, danger, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; spin?: boolean; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} className={`${iconButtonCls} ${danger ? dangerCls : ''} ${className}`} {...rest}>
      <Icon className={`size-4 ${spin ? 'animate-spin' : ''}`} aria-hidden="true" />
    </button>
  );
}
