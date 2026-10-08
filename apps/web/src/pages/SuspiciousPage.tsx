import { useState } from 'react';
import { Bot, Link2, Megaphone, ShieldAlert, Undo2 } from 'lucide-react';
import KpiCard from '../components/dashboard/KpiCard';
import PageHead from '../components/dashboard/PageHead';
import Panel from '../components/dashboard/Panel';
import { dropped } from '../data/pagesMock';
import type { DropKind } from '../data/pagesMock';

const tone: Record<DropKind, { badge: string; bar: string }> = {
  bot: { badge: 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300', bar: 'bg-rose-500' },
  hostname: { badge: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300', bar: 'bg-amber-500' },
  'referrer spam': { badge: 'bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300', bar: 'bg-violet-500' },
  'verification agent': { badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', bar: 'bg-slate-400' },
};
const kinds = Object.keys(tone) as DropKind[];

export default function SuspiciousPage() {
  const [filter, setFilter] = useState<'all' | DropKind>('all');
  const [reversed, setReversed] = useState<number[]>([]);

  const totals = kinds.map((k) => ({ kind: k, hits: dropped.filter((d) => d.reason === k).reduce((a, d) => a + d.hits, 0) }));
  const all = totals.reduce((a, t) => a + t.hits, 0);
  const rows = dropped.filter((d) => filter === 'all' || d.reason === filter);
  const get = (k: DropKind) => totals.find((t) => t.kind === k)!.hits;

  return (
    <div className="grid gap-6">
      <PageHead title="Suspicious activity" sub="Every hit we dropped, with the reason. Nothing is discarded silently." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={ShieldAlert} label="Hits dropped" value={all.toLocaleString()} />
        <KpiCard icon={Bot} label="Bots" value={get('bot').toLocaleString()} />
        <KpiCard icon={Link2} label="Wrong hostname" value={get('hostname').toLocaleString()} />
        <KpiCard icon={Megaphone} label="Referrer spam" value={get('referrer spam').toLocaleString()} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Why hits were dropped" subtitle="Share of all dropped hits" className="lg:col-span-1">
          <ul className="grid gap-4">
            {totals.map((t) => (
              <li key={t.kind}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="capitalize text-slate-700 dark:text-slate-200">{t.kind}</span>
                  <span className="font-semibold tabular-nums">{Math.round((t.hits / all) * 100)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={`h-full rounded-full ${tone[t.kind].bar}`} style={{ width: `${(t.hits / all) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-5 border-t border-slate-100 pt-4 text-[13px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Dropped hits never count in your stats. If we got one wrong, allow it and it counts from then on.
          </p>
        </Panel>

        <Panel title="Dropped hits" subtitle="Newest first" className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(['all', ...kinds] as const).map((k) => (
              <button
                key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={`cursor-pointer rounded-full border px-3.5 py-1 text-sm font-medium capitalize transition ${
                  filter === k
                    ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((d) => {
              const done = reversed.includes(d.id);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <span className={`w-32 flex-none rounded-md px-2 py-1 text-center text-xs font-semibold capitalize ${tone[d.reason].badge}`}>{d.reason}</span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{d.detail}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{d.origin} · {d.at}</p>
                  </div>
                  <span className="w-20 flex-none text-right text-sm font-semibold tabular-nums">{d.hits} hits</span>
                  {d.reason === 'verification agent' ? (
                    <span className="w-24 flex-none text-right text-xs text-slate-400">Ignored</span>
                  ) : (
                    <button
                      onClick={() => setReversed((r) => (done ? r.filter((x) => x !== d.id) : [...r, d.id]))}
                      className="flex w-24 flex-none cursor-pointer items-center justify-end gap-1.5 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400"
                    >
                      <Undo2 className="size-3.5" />{done ? 'Allowed' : 'Allow'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}