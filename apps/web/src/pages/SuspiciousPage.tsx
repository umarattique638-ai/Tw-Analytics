import { useState } from 'react';
import { Bot, Link2, ShieldAlert, ShieldCheck, Undo2 } from 'lucide-react';
import KpiCard from '../components/dashboard/KpiCard';
import PageHead from '../components/dashboard/PageHead';
import Panel from '../components/dashboard/Panel';
import RangeSelect from '../components/dashboard/RangeSelect';
import { stats } from '../api/client';
import type { RangeKey } from '../api/client';
import { useSession } from '../api/session';
import { ago, countryName, dropLabel, num } from '../lib/format';
import { usePoll } from '../lib/usePoll';
import { useRange } from '../lib/useRange';

const tone: Record<string, { badge: string; bar: string }> = {
  bot: { badge: 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300', bar: 'bg-rose-500' },
  hostname: { badge: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300', bar: 'bg-amber-500' },
  verification_agent: { badge: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', bar: 'bg-slate-400' },
};
const other = { badge: 'bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300', bar: 'bg-violet-500' };
const toneOf = (r: string) => tone[r] ?? other;

/** Every dropped hit from dropped_hits, with its reason. "Allow" exists where it makes sense: a host. */
export default function SuspiciousPage() {
  const { current, upsert } = useSession();
  const [range, setRange] = useRange();
  const [filter, setFilter] = useState<string>('all');
  const [allowed, setAllowed] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const report = usePoll(() => (current ? stats.drops(current.id, range) : Promise.resolve(null)), [current?.id, range], 60_000);
  const rows = report.data?.rows ?? [];

  if (!current) return <p className="text-slate-500">Add a site first.</p>;

  const byReason = new Map<string, number>();
  for (const r of rows) byReason.set(r.reason, (byReason.get(r.reason) ?? 0) + r.hits);
  const all = [...byReason.values()].reduce((a, b) => a + b, 0);
  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
  const shown = rows.filter((r) => filter === 'all' || r.reason === filter);

  const allow = async (host: string) => {
    try {
      const { site, sync } = await stats.allowHost(current.id, host);
      upsert(site);
      setAllowed((a) => [...a, host]);
      setMessage(sync.ok ? `${host} is now accepted. New hits from it count from now on.` : `${host} was added, but activation is pending: ${sync.message}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not allow that host.');
    }
  };

  return (
    <div className="grid gap-6">
      <PageHead
        title="Suspicious activity"
        sub="Every hit we dropped, with the reason. Nothing is discarded silently."
        action={<RangeSelect value={range} onChange={(v) => setRange(v as RangeKey)} />}
      />
      {report.error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">{report.error}</p>}
      {message && <p role="status" className="rounded-xl border border-teal-300 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-200">{message}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={ShieldAlert} label="Hits dropped" value={report.data ? num(all) : '…'} />
        <KpiCard icon={Bot} label="Bots" value={report.data ? num(byReason.get('bot') ?? 0) : '…'} />
        <KpiCard icon={Link2} label="Wrong hostname" value={report.data ? num(byReason.get('hostname') ?? 0) : '…'} />
        <KpiCard icon={ShieldCheck} label="Install checks" value={report.data ? num(byReason.get('verification_agent') ?? 0) : '…'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Why hits were dropped" subtitle="Share of all dropped hits" className="lg:col-span-1">
          {reasons.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No dropped hits in this period.</p>
          ) : (
            <ul className="grid gap-4">
              {reasons.map(([reason, hits]) => (
                <li key={reason}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-200">{dropLabel(reason)}</span>
                    <span className="font-semibold tabular-nums">{Math.round((hits / all) * 100)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={`h-full rounded-full ${toneOf(reason).bar}`} style={{ width: `${(hits / all) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-5 border-t border-slate-100 pt-4 text-[13px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Dropped hits never count in your stats. If one of your own hosts was dropped, allow it and its hits count from then on.
          </p>
        </Panel>

        <Panel title="Dropped hits" subtitle="Newest first" className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-1.5">
            {['all', ...reasons.map(([r]) => r)].map((k) => (
              <button
                key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
                className={`cursor-pointer rounded-full border px-3.5 py-1 text-sm font-medium transition ${
                  filter === k
                    ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {k === 'all' ? 'All' : dropLabel(k)}
              </button>
            ))}
          </div>
          {report.data && shown.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nothing dropped in this period.</p>}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="drops">
            {shown.map((d, i) => {
              const done = allowed.includes(d.detail) || current.allowedHosts.includes(d.detail);
              return (
                <li key={`${d.reason}-${d.detail}-${d.country}-${d.asn}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <span className={`w-36 flex-none rounded-md px-2 py-1 text-center text-xs font-semibold ${toneOf(d.reason).badge}`}>{dropLabel(d.reason)}</span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate font-mono text-[13px] font-medium text-slate-800 dark:text-slate-100">{d.detail || '—'}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {countryName(d.country)}{d.asn ? ` · AS${d.asn}` : ''} · {ago(d.last)}
                    </p>
                  </div>
                  <span className="w-20 flex-none text-right text-sm font-semibold tabular-nums">{num(d.hits)} hits</span>
                  {d.reason === 'hostname' && d.detail ? (
                    <button
                      onClick={() => allow(d.detail)}
                      disabled={done}
                      className="flex w-24 flex-none cursor-pointer items-center justify-end gap-1.5 text-xs font-semibold text-teal-700 hover:underline disabled:cursor-default disabled:text-slate-400 disabled:no-underline dark:text-teal-400"
                    >
                      <Undo2 className="size-3.5" />{done ? 'Allowed' : 'Allow host'}
                    </button>
                  ) : (
                    <span className="w-24 flex-none" />
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
