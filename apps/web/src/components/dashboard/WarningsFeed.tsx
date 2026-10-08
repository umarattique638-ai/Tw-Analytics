import type { DropReason, Warning } from '../../types';
import Card from '../ui/Card';
import { muted } from '../ui/styles';

const tone: Record<DropReason, string> = {
  bot: 'text-red-700 dark:text-red-400',
  hostname: 'text-amber-700 dark:text-amber-400',
  quota: 'text-amber-700 dark:text-amber-400',
  'verification agent': 'text-slate-500 dark:text-slate-400',
};

export default function WarningsFeed({ items }: { items: Warning[] }) {
  return (
    <Card title="Warnings feed">
      <p className={`-mt-2 mb-3 text-[13px] ${muted}`}>Hits we dropped, with the reason. Nothing is discarded silently.</p>
      <ul className="grid gap-3.5">
        {items.map((w) => (
          <li key={w.reason} className="flex gap-3 text-sm">
            <span className={`h-fit min-w-[70px] flex-none rounded-md border border-current px-2.5 py-0.5 text-center text-xs font-extrabold ${tone[w.reason]}`}>
              {w.reason}
            </span>
            <div>
              {w.detail}
              <small className={`block text-xs ${muted}`}>{w.count.toLocaleString()} hits · last {w.last}</small>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
