import type { Check } from '../../api/client';
import { muted } from '../ui/styles';

const mark = {
  pass: { icon: '✓', cls: 'text-emerald-600 dark:text-emerald-400', label: 'passed' },
  fail: { icon: '✕', cls: 'text-red-600 dark:text-red-400', label: 'failed' },
  skip: { icon: '○', cls: 'text-slate-400', label: 'not checked' },
} as const;

/** The verifier's result, step by step, with the server's message for each. */
export default function CheckList({ items }: { items: Check[] }) {
  return (
    <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
      {items.map((c) => (
        <li key={c.id} data-check={c.id} data-status={c.status} className="flex gap-3 px-4 py-3 font-semibold">
          <span className={mark[c.status].cls} aria-label={mark[c.status].label}>{mark[c.status].icon}</span>
          <div>
            {c.label}
            <small className={`block text-[13px] font-normal ${c.status === 'fail' ? 'text-red-700 dark:text-red-300' : muted}`}>{c.message}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}
