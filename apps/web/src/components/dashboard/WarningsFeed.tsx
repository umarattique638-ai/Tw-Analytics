import Panel from './Panel';
import { ago, dropDetail, dropLabel, num } from '../../lib/format';

const tone: Record<string, string> = {
  bot: 'text-rose-700 dark:text-rose-400',
  hostname: 'text-amber-700 dark:text-amber-400',
  verification_agent: 'text-slate-500 dark:text-slate-400',
};

/** Dropped hits by reason, from dropped_hits. Nothing is discarded silently (PLAN 6.5). */
export default function WarningsFeed({ items }: { items: { reason: string; hits: number; detail: string; last: number }[] }) {
  return (
    <Panel title="Warnings feed" subtitle="Hits we dropped, with the reason">
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">No dropped hits in this period.</p>
      ) : (
        <ul className="grid gap-3.5">
          {items.map((w) => (
            <li key={w.reason} className="flex gap-3 text-sm">
              <span className={`h-fit min-w-[110px] flex-none rounded-md border border-current px-2.5 py-0.5 text-center text-xs font-bold ${tone[w.reason] ?? 'text-slate-600 dark:text-slate-300'}`}>
                {dropLabel(w.reason)}
              </span>
              <div className="min-w-0">
                <span className="break-words text-[13px]" title={w.detail}>{dropDetail(w.reason, w.detail) || '—'}</span>
                <small className="block text-xs text-slate-500 dark:text-slate-400">{num(w.hits)} hits · last {ago(w.last)}</small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
