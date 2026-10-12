import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonVariants } from './Button';

type Variant = keyof typeof buttonVariants;

/** A link that looks like a Button (navigation, not an action). */
export default function LinkButton({ to, variant = 'primary', className = '', children, state }: { to: string; variant?: Variant; className?: string; children: ReactNode; state?: unknown }) {
  return (
    <Link
      to={to}
      state={state}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-[15px] font-semibold whitespace-nowrap transition focus-visible:outline-none focus-visible:ring-4 ${buttonVariants[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}
