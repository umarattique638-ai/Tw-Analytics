import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export const textLinkCls = 'font-semibold text-teal-700 underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/20 dark:text-teal-400';

/** An inline link in running text. */
export default function TextLink({ to, children, className = '' }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`${textLinkCls} ${className}`}>
      {children}
    </Link>
  );
}
