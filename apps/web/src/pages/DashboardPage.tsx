import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Activity, Download, Eye, Globe, MapPin, MousePointerClick, Monitor, ShoppingCart, Smartphone, Tablet, UserPlus, Users, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import GettingStarted from '../components/dashboard/GettingStarted';
import KpiCard from '../components/dashboard/KpiCard';
import Panel from '../components/dashboard/Panel';
import RangeSelect from '../components/dashboard/RangeSelect';
import { BarList, LiveChart, SourcesDonut, VisitorsChart } from '../components/dashboard/charts';
import { useSession } from '../api/session';
import FinishSetup from '../components/dashboard/FinishSetup';
import { browsers, devices, liveEvents, locations, sources, topPages, visitorsSeries } from '../data/dashboardMock';
import type { LiveEvent } from '../data/dashboardMock';
import VerticalBars from '../components/dashboard/VerticalBars';

const eventStyle: Record<LiveEvent['type'], { icon: LucideIcon; cls: string }> = {
  pageview: { icon: Eye, cls: 'bg-teal-50 text-teal-600 dark:bg-teal-400/10 dark:text-teal-300' },
  click: { icon: MousePointerClick, cls: 'bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300' },
  signup: { icon: UserPlus, cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300' },
  purchase: { icon: ShoppingCart, cls: 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300' },
};

const deviceIcon = (label: string) => (label === 'Mobile' ? Smartphone : label === 'Tablet' ? Tablet : Monitor);

const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour12: false });

function useLiveSeries() {
  const [points, setPoints] = useState(() =>
    Array.from({ length: 20 }, (_, i) => ({ time: clock(new Date(Date.now() - (20 - i) * 2000)), count: 8 + Math.round(Math.random() * 10) })),
  );
  useEffect(() => {
    const id = setInterval(() => {
      setPoints((p) => [...p.slice(1), { time: clock(new Date()), count: 8 + Math.round(Math.random() * 10) }]);
    }, 2000);
    return () => clearInterval(id);
  }, []);
  return points;
}

export default function DashboardPage() {
  const { state } = useLocation();
  const { user, current } = useSession();
  const preview = Boolean((state as { preview?: boolean } | null)?.preview);
  const [range, setRange] = useState('7d');
  const live = useLiveSeries();

  // Stage 5: the setup state is real (from the API). The charts below are still sample data until
  // Stage 6 builds the Query API over the rollups.
  if (!current && !preview) return <GettingStarted />;
  if (current && !current.verifiedAt && !preview) return <FinishSetup site={current} />;
  const site = { domain: current?.domain ?? 'example.com' };
  const firstName = (user.name ?? user.email).split(' ')[0];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const totalVisitors = 4167;
  const currentLive = live[live.length - 1].count;

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{today} · {site.domain}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{greeting}, {firstName}.</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Here's what's happening with your website.</p>
        </div>
        <div className="flex items-center gap-2">
          <RangeSelect value={range} onChange={setRange} />
          <button className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
            <Download className="size-4" /> Export report
          </button>
        </div>
      </div>


      <p role="note" className="rounded-xl border border-teal-600/20 bg-teal-50 px-4 py-3 text-sm text-teal-900 dark:border-teal-400/25 dark:bg-teal-400/10 dark:text-teal-200">
        <b>Sample data.</b> Your site is collecting real visits; the live reports replace these charts in the next release (Stage 6).
      </p>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard icon={Users} label="Active visitors" value={String(currentLive)} />
        <KpiCard icon={Activity} label="Total sessions" value="5,140" delta="12%" />
        <KpiCard icon={Eye} label="Page views" value="6,474" delta="9%" />
        <KpiCard icon={Zap} label="Bounce rate" value="41.2%" delta="1.4 pts" up={false} positive />
      </div>

      {/* Visitors + Sources */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Visitors over time" subtitle="Daily unique visitors & sessions" className="lg:col-span-2">
          <VisitorsChart data={visitorsSeries} />
        </Panel>
        <Panel title="Traffic sources" subtitle="Where visitors come from">
          <SourcesDonut sources={sources} total={totalVisitors} />
        </Panel>
      </div>

      {/* Live */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Live sessions"
          subtitle={`${currentLive} active sessions right now`}
          action={<span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"><span className="size-2 animate-pulse rounded-full bg-emerald-500" />Live</span>}
        >
          <LiveChart data={live} />
        </Panel>
        <Panel title="Live events" subtitle={`${liveEvents.length} events tracked today`}>
          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto pr-1 dark:divide-slate-800">
            {liveEvents.map((e) => {
              const { icon: Icon, cls } = eventStyle[e.type];
              return (
                <li key={e.id} className="flex items-center gap-3 py-2.5">
                  <span className={`grid size-8 flex-none place-items-center rounded-full ${cls}`}><Icon className="size-3.5" /></span>
                  <p className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium capitalize text-slate-800 dark:text-slate-100">{e.type}</span>{' '}
                    <span className="text-slate-400">{e.url}</span>
                  </p>
                  <span className="flex-none text-xs text-slate-400">{e.ago}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      {/* Breakdowns */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top pages" subtitle="Most visited pages this period"><BarList rows={topPages} /></Panel>
        <Panel title="Top locations" subtitle="Visitors by country"><BarList rows={locations} icon={MapPin} /></Panel>
       <Panel title="Device breakdown" subtitle="How visitors browse">
  <VerticalBars rows={devices} iconFor={deviceIcon} />
</Panel>
<Panel title="Browser breakdown" subtitle="Most used browsers">
  <VerticalBars rows={browsers} iconFor={() => Globe} />
</Panel>
      </div>
    </div>
  );
}