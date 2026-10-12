import type { ButtonHTMLAttributes } from 'react';
import Spinner from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline';
type Size = 'sm' | 'md';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

const base =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition ' +
  'focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60';

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-5 text-[15px]',
};

export const buttonVariants: Record<Variant, string> = {
  primary:
    'bg-teal-700 text-white shadow-sm hover:bg-teal-800 focus-visible:ring-teal-600/30 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400',
  secondary:
    'border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:ring-slate-400/25 ' +
    'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400/25 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 focus-visible:ring-rose-600/30',
  dangerOutline:
    'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-600/20 ' +
    'dark:border-rose-400/40 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-400/10',
};

/**
 * The one button. `type` defaults to "button" so a button inside a form never submits by accident;
 * pass type="submit" for the form's main action.
 */
export default function Button({ variant = 'primary', size = 'md', loading, className = '', children, disabled, type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={`${base} ${sizes[size]} ${buttonVariants[variant]} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}
