import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, Sparkles, Star, Target, X, Zap } from 'lucide-react';
import KpiCard from '../components/dashboard/KpiCard';
import PageHead from '../components/dashboard/PageHead';
import Panel from '../components/dashboard/Panel';
import Button from '../components/ui/Button';
import { inputCls } from '../components/ui/styles';
import { createPaths, events } from '../data/pagesMock';
import type { EventKind } from '../data/pagesMock';

type Filter = 'all' | EventKind;
const filters: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'automatic', label: 'Automatic' }, { id: 'custom', label: 'Custom' },
];

export default function EventsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [path, setPath] = useState<(typeof createPaths)[number]['id']>('code');

  const rows = useMemo(
    () => events.filter((e) => (filter === 'all' || e.kind === filter) && (e.name + e.label).toLowerCase().includes(query.toLowerCase())),
    [filter, query],
  );
  const max = Math.max(...events.map((e) => e.count));
  const total = events.reduce((a, e) => a + e.count, 0);
  const active = createPaths.find((p) => p.id === path)!;

  return (
    <div className="grid gap-6">
      <PageHead
        title="Events"
        sub="Everything your site sends: automatic events plus the ones you create."
        action={
          <Button onClick={() => setCreating((c) => !c)} className="gap-2">
            {creating ? <X className="size-4" /> : <Plus className="size-4" />} {creating ? 'Close' : 'Create event'}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Zap} label="Events tracked" value={total.toLocaleString()} />
        <KpiCard icon={Sparkles} label="Event types" value={String(events.length)} />
        <KpiCard icon={Target} label="Conversion events" value="578" />
        <KpiCard icon={AlertTriangle} label="New, to review" value="1" />
      </div>

      {creating && (
        <Panel title="Create an event" subtitle="Any event name works right away. No registration needed.">
          <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
            {createPaths.map((p) => (
              <button
                key={p.id} role="tab" aria-selected={path === p.id} onClick={() => setPath(p.id)}
                className={`cursor-pointer border-b-[3px] px-3.5 py-2 text-sm font-semibold ${path === p.id ? 'border-teal-700 dark:border-teal-400' : 'border-transparent text-slate-500 dark:text-slate-400'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {active.id === 'rule' ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_1.4fr_auto] sm:items-end">
              <label className="grid gap-1.5 text-sm font-medium">Event name<input className={inputCls} defaultValue="pricing_view" /></label>
              <span className="pb-3 text-sm text-slate-500">when</span>
              <label className="grid gap-1.5 text-sm font-medium">Condition
                <select className={inputCls} defaultValue="path"><option value="path">path matches</option><option value="click">click matches</option></select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">Value<input className={`${inputCls} font-mono`} defaultValue="/pricing*" /></label>
              <Button type="button">Save rule</Button>
            </div>
          ) : (
            <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-[13.5px] leading-relaxed text-teal-100"><code>{active.code}</code></pre>
          )}
          <p className="mt-3 text-[13px] text-slate-500 dark:text-slate-400">
            {active.note} Events created in the dashboard collect from today onward, not from the past.
          </p>
        </Panel>
      )}

      <Panel
        title="All events"
        subtitle="Last 7 days"
        action={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" aria-label="Search events" className={`${inputCls} !h-10 w-48 pl-9`} />
          </div>
        }
      >
        <div className="mb-4 flex gap-1.5">
          {filters.map((f) => (
            <button
              key={f.id} onClick={() => setFilter(f.id)} aria-pressed={filter === f.id}
              className={`cursor-pointer rounded-full border px-3.5 py-1 text-sm font-medium transition ${
                filter === f.id
                  ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="pb-3 font-medium">Event</th><th className="pb-3 font-medium">Type</th>
                <th className="pb-3 text-right font-medium">Events</th><th className="pb-3 pl-6 font-medium">Last seen</th><th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((e) => (
                <tr key={e.name}>
                  <td className="py-3 pr-4">
                    <p className="flex items-center gap-1.5 font-mono text-[13px] font-medium text-slate-900 dark:text-white">
                      {e.name}{e.conversion && <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Conversion" />}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{e.label}</p>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${e.kind === 'custom' ? 'bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {e.kind === 'custom' ? 'Custom' : 'Automatic'}
                    </span>
                    <span className="ml-2 text-xs text-slate-400">{e.tier}</span>
                  </td>
                  <td className="py-3 text-right">
                    <span className="font-semibold tabular-nums">{e.count.toLocaleString()}</span>
                    <span className="mt-1 ml-auto block h-1 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <span className="block h-full rounded-full bg-teal-500" style={{ width: `${(e.count / max) * 100}%` }} />
                    </span>
                  </td>
                  <td className="py-3 pl-6 text-slate-500 dark:text-slate-400">{e.last}</td>
                  <td className="py-3">
                    {e.status === 'new'
                      ? <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">New · review</span>
                      : <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" />Active</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-slate-400">No events match your search.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="flex gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 size-4 flex-none" />
        <p>
          The property <span className="font-mono font-medium">order_id</span> on <span className="font-mono font-medium">purchase</span> has
          1,240 distinct values. High-cardinality properties can't be used as report breakdowns, so they stay searchable but never become a rollup.
        </p>
      </div>
    </div>
  );
}