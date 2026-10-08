import { useMemo, useState } from 'react';
import { AlertTriangle, Code, Search, Sparkles, Target, X, Zap } from 'lucide-react';
import KpiCard from '../components/dashboard/KpiCard';
import PageHead from '../components/dashboard/PageHead';
import Panel from '../components/dashboard/Panel';
import RangeSelect, { RANGES } from '../components/dashboard/RangeSelect';
import Button from '../components/ui/Button';
import { inputCls } from '../components/ui/styles';
import { stats } from '../api/client';
import type { RangeKey } from '../api/client';
import { useSession } from '../api/session';
import { ago, num } from '../lib/format';
import { usePoll } from '../lib/usePoll';
import { useRange } from '../lib/useRange';

/** Names TailWatch sends by itself (PLAN 6.1). Anything else is the site's own custom event. */
const LABELS: Record<string, string> = {
  pageview: 'Pageview',
  engagement: 'Engagement time (sent when a visitor leaves or switches tabs)',
  scroll: 'Scroll depth',
  outbound_click: 'Outbound link click',
  file_download: 'File download',
  form_start: 'Form start',
  form_submit: 'Form submit',
};

type Filter = 'all' | 'automatic' | 'custom';

export default function EventsPage() {
  const { current } = useSession();
  const [range, setRange] = useRange();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const report = usePoll(() => (current ? stats.events(current.id, range) : Promise.resolve(null)), [current?.id, range], 60_000);
  const events = report.data?.events ?? [];

  const rows = useMemo(
    () => events.filter((e) => (filter === 'all' || e.kind === filter) && e.name.toLowerCase().includes(query.toLowerCase())),
    [events, filter, query],
  );
  const max = Math.max(1, ...events.map((e) => e.events));
  const total = events.reduce((a, e) => a + e.events, 0);
  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? '';

  if (!current) return <p className="text-slate-500">Add a site first.</p>;

  return (
    <div className="grid gap-6">
      <PageHead
        title="Events"
        sub="Everything your site sends: automatic events plus the ones you create."
        action={
          <div className="flex items-center gap-2">
            <RangeSelect value={range} onChange={(v) => setRange(v as RangeKey)} />
            <Button onClick={() => setCreating((c) => !c)} className="gap-2">
              {creating ? <X className="size-4" /> : <Code className="size-4" />} {creating ? 'Close' : 'Create event'}
            </Button>
          </div>
        }
      />

      {report.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">{report.error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Zap} label="Events tracked" value={report.data ? num(total) : '…'} />
        <KpiCard icon={Sparkles} label="Event types" value={report.data ? num(events.length) : '…'} />
        <KpiCard icon={Target} label="Custom event types" value={report.data ? num(events.filter((e) => e.kind === 'custom').length) : '…'} />
        <KpiCard icon={AlertTriangle} label="New, to review" value={report.data ? num(events.filter((e) => e.isNew).length) : '…'} />
      </div>

      {creating && (
        <Panel title="Create an event" subtitle="Any event name works right away. No registration needed.">
          <pre className="overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-[13.5px] leading-relaxed text-teal-100"><code>{`// Script tag: anywhere after the snippet
tw('track', 'signup', { plan: 'pro', seats: 5 });

// npm / framework packages
const tw = useTailwatch();          // React, Next.js, Vue
tw.track('signup', { plan: 'pro' });`}</code></pre>
          <p className="mt-3 text-[13px] text-slate-500 dark:text-slate-400">
            Names: lowercase letters, digits and _ (up to 40). Up to 25 properties per event. The event shows up here with its first hit.
            Creating events from HTML attributes or dashboard rules comes in a later release.
          </p>
        </Panel>
      )}

      <Panel
        title="All events"
        subtitle={rangeLabel}
        action={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" aria-label="Search events" className={`${inputCls} !h-10 w-48 pl-9`} />
          </div>
        }
      >
        <div className="mb-4 flex gap-1.5">
          {(['all', 'automatic', 'custom'] as const).map((f) => (
            <button
              key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={`cursor-pointer rounded-full border px-3.5 py-1 text-sm font-medium capitalize transition ${
                filter === f
                  ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm" data-testid="events-table">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                <th className="pb-3 font-medium">Event</th><th className="pb-3 font-medium">Type</th>
                <th className="pb-3 text-right font-medium">Events</th><th className="pb-3 pl-6 font-medium">Last seen</th><th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((e) => (
                <tr key={e.name} data-event={e.name}>
                  <td className="py-3 pr-4">
                    <p className="font-mono text-[13px] font-medium text-slate-900 dark:text-white">{e.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{LABELS[e.name] ?? 'Custom event'}</p>
                  </td>
                  <td className="py-3 pr-4">
                    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${e.kind === 'custom' ? 'bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                      {e.kind === 'custom' ? 'Custom' : 'Automatic'}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <span className="font-semibold tabular-nums">{num(e.events)}</span>
                    <span className="mt-1 ml-auto block h-1 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <span className="block h-full rounded-full bg-teal-500" style={{ width: `${(e.events / max) * 100}%` }} />
                    </span>
                  </td>
                  <td className="py-3 pl-6 text-slate-500 dark:text-slate-400">{ago(e.last)}</td>
                  <td className="py-3">
                    {e.isNew
                      ? <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-400/10 dark:text-amber-300">New · review</span>
                      : <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-500" />Active</span>}
                  </td>
                </tr>
              ))}
              {report.data && rows.length === 0 && (
                <tr><td colSpan={5} className="py-10 text-center text-slate-400">{events.length === 0 ? 'No events in this period yet.' : 'No events match your search.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {(report.data?.highCardinality ?? []).map((h) => (
        <div key={`${h.name}.${h.key}`} className="flex gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 flex-none" />
          <p>
            The property <span className="font-mono font-medium">{h.key}</span> on <span className="font-mono font-medium">{h.name}</span> has {num(h.distinctValues)} distinct
            values. High-cardinality properties can't be used as report breakdowns, so they stay searchable but never become a rollup.
          </p>
        </div>
      ))}
    </div>
  );
}
