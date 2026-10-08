import { useLocation } from 'react-router-dom';
import { Activity, Download, Eye, Globe, MapPin, Monitor, Smartphone, Sparkles, Tablet, Users, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import GettingStarted from '../components/dashboard/GettingStarted';
import FinishSetup from '../components/dashboard/FinishSetup';
import KpiCard from '../components/dashboard/KpiCard';
import Panel from '../components/dashboard/Panel';
import RangeSelect from '../components/dashboard/RangeSelect';
import CaptureRate from '../components/dashboard/CaptureRate';
import WarningsFeed from '../components/dashboard/WarningsFeed';
import VerticalBars from '../components/dashboard/VerticalBars';
import { BarList, LiveChart, SourcesDonut, VisitorsChart } from '../components/dashboard/charts';
import { useSession } from '../api/session';
import { stats } from '../api/client';
import type { RangeKey } from '../api/client';
import { ago, capital, change, countryName, num, percent, share } from '../lib/format';
import { usePoll } from '../lib/usePoll';
import { useRange } from '../lib/useRange';

const deviceIcon = (label: string) => (/mobile/i.test(label) ? Smartphone : /tablet/i.test(label) ? Tablet : Monitor);
const eventIcon = (name: string): { icon: LucideIcon; cls: string } =>
  name === 'pageview'
    ? { icon: Eye, cls: 'bg-teal-50 text-teal-600 dark:bg-teal-400/10 dark:text-teal-300' }
    : name === 'engagement'
      ? { icon: Activity, cls: 'bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300' }
      : { icon: Sparkles, cls: 'bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300' };

const OVERVIEW_EVERY = 60_000;
const LIVE_EVERY = 10_000;

/** Every number here comes from the Query API (docs/QUERIES.md). Nothing is sample data. */
export default function DashboardPage() {
  const { user, current } = useSession();
  const { state } = useLocation();
  const [range, setRange] = useRange();

  if (!current) return <GettingStarted />;
  if (!current.verifiedAt && !(state as { skipSetup?: boolean } | null)?.skipSetup) return <FinishSetup site={current} />;
  return <Reports siteId={current.id} domain={current.domain} name={user.name ?? user.email} range={range} setRange={setRange} />;
}

function Reports({ siteId, domain, name, range, setRange }: { siteId: number; domain: string; name: string; range: RangeKey; setRange: (r: RangeKey) => void }) {
  const overview = usePoll(() => stats.overview(siteId, range), [siteId, range], OVERVIEW_EVERY);
  const live = usePoll(() => stats.live(siteId), [siteId], LIVE_EVERY);
  const o = overview.data;
  const l = live.data;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const k = o?.kpis;
  const sessionsChange = k ? change(k.sessions, k.previous.sessions) : null;
  const pageviewsChange = k ? change(k.pageviews, k.previous.pageviews) : null;
  const bounceDelta = k && k.bounceRate !== null && k.previous.bounceRate !== null ? (k.bounceRate - k.previous.bounceRate) * 100 : null;
  const sourcesTotal = o ? o.sources.reduce((s, x) => s + x.sessions, 0) || 1 : 1;

  return (
    <div className="grid gap-6" data-testid="reports">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{today} · {domain}{o ? ` · ${o.range.tz}` : ''}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{greeting}, {name.split(' ')[0]}.</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Here's what's happening with your website.</p>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelect value={range} onChange={(v) => setRange(v as RangeKey)} />
          <a
            href={stats.exportUrl(siteId, range)}
            className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="size-4" /> Export CSV
          </a>
        </div>
      </div>

      {overview.error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          {overview.error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} label="Active visitors (5 min)" value={l ? num(l.active) : '…'} />
        <KpiCard icon={Activity} label="Total sessions" value={k ? num(k.sessions) : '…'} delta={sessionsChange?.delta} up={sessionsChange?.up} positive={sessionsChange?.up} />
        <KpiCard icon={Eye} label="Page views" value={k ? num(k.pageviews) : '…'} delta={pageviewsChange?.delta} up={pageviewsChange?.up} positive={pageviewsChange?.up} />
        <KpiCard
          icon={Zap}
          label="Bounce rate"
          value={k ? percent(k.bounceRate) : '…'}
          delta={bounceDelta === null ? undefined : `${Math.abs(bounceDelta).toFixed(1)} pts`}
          up={(bounceDelta ?? 0) >= 0}
          positive={(bounceDelta ?? 0) <= 0}
        />
      </div>

      {o && <CaptureRate {...o.capture} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Visitors over time"
          subtitle={`${o?.range.hourly ? 'Per hour' : 'Per day'} in ${o?.range.tz ?? 'the site timezone'}${k?.visitorsEstimated ? ' · visitors estimated (daily hashes)' : ''}`}
          className="lg:col-span-2"
        >
          <VisitorsChart data={(o?.series ?? []).map((r) => ({ date: r.label, visitors: r.visitors, sessions: r.sessions }))} />
        </Panel>
        <Panel title="Traffic sources" subtitle="Sessions by channel">
          <SourcesDonut
            sources={(o?.sources ?? []).map((s) => ({ name: s.name, value: Math.round((s.sessions / sourcesTotal) * 100) }))}
            total={k?.visitors ?? 0}
            caption={k?.visitorsEstimated ? 'Visitors (est.)' : 'Unique visitors'}
          />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Live visitors"
          subtitle={l ? `${num(l.active)} active in the last 5 minutes` : 'Loading…'}
          action={<span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><span className="size-2 animate-pulse rounded-full bg-emerald-500" />Live</span>}
        >
          <LiveChart data={(l?.minutes ?? []).map((m) => ({ time: new Date(m.minute).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), count: m.visitors }))} />
        </Panel>
        <Panel title="Live events" subtitle="The latest 20 hits (last 24 hours)">
          {l && l.events.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No hits in the last 24 hours.</p>
          ) : (
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto pr-1 dark:divide-slate-800" data-testid="live-events">
              {(l?.events ?? []).map((e, i) => {
                const { icon: Icon, cls } = eventIcon(e.name);
                return (
                  <li key={`${e.at}-${i}`} className="flex items-center gap-3 py-2.5">
                    <span className={`grid size-8 flex-none place-items-center rounded-full ${cls}`}><Icon className="size-3.5" /></span>
                    <p className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{e.name}</span> <span className="text-slate-400">{e.path}</span>
                    </p>
                    <span className="flex-none text-xs text-slate-400">{countryName(e.country)} · {ago(e.at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top pages" subtitle="Page views this period"><BarList rows={share(o?.pages ?? [])} /></Panel>
        <Panel title="Top referrers" subtitle="Sessions by referring site"><BarList rows={share(o?.referrers ?? [])} icon={Globe} empty="No referrers yet: all direct traffic." /></Panel>
        <Panel title="Top locations" subtitle="Visitors by country"><BarList rows={share((o?.countries ?? []).map((r) => ({ ...r, label: countryName(r.label) })))} icon={MapPin} /></Panel>
        <WarningsFeed items={o?.drops ?? []} />
        <Panel title="Device breakdown" subtitle="Visitors by device">
          {o && o.devices.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No data yet.</p> : <VerticalBars rows={share((o?.devices ?? []).map((r) => ({ ...r, label: capital(r.label) })))} iconFor={deviceIcon} />}
        </Panel>
        <Panel title="Browser breakdown" subtitle="Visitors by browser">
          {o && o.browsers.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No data yet.</p> : <VerticalBars rows={share((o?.browsers ?? []).map((r) => ({ ...r, label: r.label || 'Other' })))} iconFor={() => Globe} />}
        </Panel>
      </div>
    </div>
  );
}
