import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost';
  loading?: boolean;
};

const base =
  'inline-flex h-11 cursor-pointer items-center justify-center gap-2.5 rounded-lg px-5 text-[15px] font-semibold transition ' +
  'focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60';

const variants = {
  primary:
    'bg-teal-700 text-white shadow-sm hover:bg-teal-800 focus-visible:ring-teal-600/30 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400',
  ghost:
    'border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:ring-slate-400/25 ' +
    'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
};

export default function Button({ variant = 'primary', loading, className = '', children, disabled, ...rest }: Props) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}