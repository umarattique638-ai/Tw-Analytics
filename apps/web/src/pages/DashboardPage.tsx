import { Activity, Download, Eye, Globe, MapPin, Monitor, Smartphone, Tablet, Users, Zap } from 'lucide-react';
import FinishSetup from '../components/dashboard/FinishSetup';
import GettingStarted from '../components/dashboard/GettingStarted';
import KpiCard from '../components/dashboard/KpiCard';
import LiveEvents from '../components/dashboard/LiveEvents';
import RangeSelect from '../components/dashboard/RangeSelect';
import VerticalBars from '../components/dashboard/VerticalBars';
import WarningsFeed from '../components/dashboard/WarningsFeed';
import { BarList, LiveChart, SourcesDonut, VisitorsChart } from '../components/dashboard/charts';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Notice from '../components/ui/Notice';
import Panel from '../components/ui/Panel';
import PageHeader from '../components/ui/PageHeader';
import type { Site, User } from '../api/client';
import { capital, change, countryName, num, percent, share } from '../lib/format';
import { greeting, useCsvExport, useLive, useOverview } from '../hooks/useDashboard';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRange } from '../hooks/useRange';
import { useSession } from '../hooks/useSession';

const deviceIcon = (label: string) => (/mobile/i.test(label) ? Smartphone : /tablet/i.test(label) ? Tablet : Monitor);
/** "Umar Attique" -> "Umar"; no name -> the part of the e-mail before @. */
const firstName = (u: User) => u.name?.trim().split(/\s+/)[0] || u.email.split('@')[0]!;
const todayLabel = () => new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

/** Every number here comes from the Query API (docs/QUERIES.md). Nothing is sample data. */
export default function DashboardPage() {
  useDocumentTitle('Overview');
  const { user, current, setup } = useSession();

  if (!current) return setup ? <FinishSetup setup={setup} /> : <GettingStarted />;
  return <Overview site={current} name={firstName(user)} />;
}

function Overview({ site, name }: { site: Site; name: string }) {
  const [range, setRange] = useRange();
  const overview = useOverview(site.id, range);
  const live = useLive(site.id);
  const csv = useCsvExport(site.id, range);
  const o = overview.data;
  const l = live.data;
  const k = o?.kpis;

  const sessionsChange = k ? change(k.sessions, k.previous.sessions) : null;
  const pageviewsChange = k ? change(k.pageviews, k.previous.pageviews) : null;
  const bounceDelta = k && k.bounceRate !== null && k.previous.bounceRate !== null ? (k.bounceRate - k.previous.bounceRate) * 100 : null;
  const sourcesTotal = o ? o.sources.reduce((s, x) => s + x.sessions, 0) || 1 : 1;
  const tz = o?.range.tz ?? site.timezone;

  return (
    <div className="grid gap-6" data-testid="reports">
      <PageHeader
        title={`${greeting()}, ${name}.`}
        description={
          <>
            {todayLabel()} · <span className="font-medium text-slate-700 dark:text-slate-300">{site.domain}</span> · {tz}
          </>
        }
        actions={
          <>
            <RangeSelect value={range} onChange={setRange} />
            <Button variant="secondary" size="sm" className="h-10" onClick={csv.exportCsv} loading={csv.busy}>
              {!csv.busy && <Download className="size-4" aria-hidden="true" />} Export CSV
            </Button>
          </>
        }
      />

      {overview.error && <Notice tone="error">{overview.error}</Notice>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Users} label="Active now" value={l ? num(l.active) : null} />
        <KpiCard icon={Activity} label="Sessions" value={k ? num(k.sessions) : null} delta={sessionsChange?.delta} up={sessionsChange?.up} positive={sessionsChange?.up} />
        <KpiCard icon={Eye} label="Page views" value={k ? num(k.pageviews) : null} delta={pageviewsChange?.delta} up={pageviewsChange?.up} positive={pageviewsChange?.up} />
        <KpiCard
          icon={Zap}
          label="Bounce rate"
          value={k ? percent(k.bounceRate) : null}
          delta={bounceDelta === null ? undefined : `${Math.abs(bounceDelta).toFixed(1)} pts`}
          up={(bounceDelta ?? 0) >= 0}
          positive={(bounceDelta ?? 0) <= 0}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Visitors over time"
          subtitle={`${o?.range.hourly ? 'Per hour' : 'Per day'} in ${tz}${k?.visitorsEstimated ? ' · visitors estimated (daily hashes)' : ''}`}
          className="xl:col-span-2"
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
          action={
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
              Live
            </span>
          }
        >
          <LiveChart data={(l?.minutes ?? []).map((m) => ({ time: new Date(m.minute).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), count: m.visitors }))} />
        </Panel>
        <Panel title="Latest hits" subtitle="The newest 20 from the last 24 hours">
          <LiveEvents events={l?.events ?? null} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top pages" subtitle="Page views in this period">
          <BarList rows={share(o?.pages ?? [])} />
        </Panel>
        <Panel title="Top referrers" subtitle="Sessions by referring site">
          <BarList rows={share(o?.referrers ?? [])} icon={Globe} empty="No referrers yet: all direct traffic." />
        </Panel>
        <Panel title="Top locations" subtitle="Visitors by country">
          <BarList rows={share((o?.countries ?? []).map((r) => ({ ...r, label: countryName(r.label) })))} icon={MapPin} />
        </Panel>
        <WarningsFeed items={o?.drops ?? []} />
        <Panel title="Devices" subtitle="Visitors by device">
          {o && o.devices.length === 0 ? (
            <EmptyState compact title="No data yet" />
          ) : (
            <VerticalBars rows={share((o?.devices ?? []).map((r) => ({ ...r, label: capital(r.label) })))} iconFor={deviceIcon} />
          )}
        </Panel>
        <Panel title="Browsers" subtitle="Visitors by browser">
          {o && o.browsers.length === 0 ? (
            <EmptyState compact title="No data yet" />
          ) : (
            <VerticalBars rows={share((o?.browsers ?? []).map((r) => ({ ...r, label: r.label || 'Other' })))} iconFor={() => Globe} />
          )}
        </Panel>
      </div>
    </div>
  );
}
