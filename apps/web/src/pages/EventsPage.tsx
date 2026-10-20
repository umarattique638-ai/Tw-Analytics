import { useState } from 'react';
import { Code, Search, Sparkles, Target, X, Zap } from 'lucide-react';
import KpiCard from '../components/dashboard/KpiCard';
import NoSiteYet from '../components/dashboard/NoSiteYet';
import RangeSelect, { rangeLong } from '../components/dashboard/RangeSelect';
import EventsTable from '../components/events/EventsTable';
import TrackEventPanel from '../components/events/TrackEventPanel';
import Button from '../components/ui/Button';
import Notice from '../components/ui/Notice';
import PageHeader from '../components/ui/PageHeader';
import Panel from '../components/ui/Panel';
import SegmentedControl from '../components/ui/SegmentedControl';
import { inputCls } from '../components/ui/styles';
import type { Site } from '../api/client';
import { num } from '../lib/format';
import { useEventsReport } from '../hooks/useEventsReport';
import type { EventFilter } from '../hooks/useEventsReport';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRange } from '../hooks/useRange';
import { useSession } from '../hooks/useSession';

const FILTERS: { value: EventFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'automatic', label: 'Automatic' },
  { value: 'custom', label: 'Custom' },
];

export default function EventsPage() {
  useDocumentTitle('Events');
  const { current } = useSession();
  if (!current) return <NoSiteYet />;
  return <Events site={current} />;
}

function Events({ site }: { site: Site }) {
  const [range, setRange] = useRange();
  const { report, rows, totals, filter, setFilter, query, setQuery, highCardinality } = useEventsReport(site.id, range);
  const [showCode, setShowCode] = useState(false);
  const ready = !!report.data;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Events"
        description="Everything your site sends: automatic events plus the ones you add."
        actions={
          <>
            <RangeSelect value={range} onChange={setRange} />
            <Button size="sm" className="h-10" variant={showCode ? 'secondary' : 'primary'} onClick={() => setShowCode((c) => !c)} aria-expanded={showCode}>
              {showCode ? <X className="size-4" aria-hidden="true" /> : <Code className="size-4" aria-hidden="true" />}
              {showCode ? 'Close' : 'Track an event'}
            </Button>
          </>
        }
      />

      {report.error && <Notice tone="error">{report.error}</Notice>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard icon={Zap} label="Events tracked" value={ready ? num(totals.events) : null} />
        <KpiCard icon={Sparkles} label="Event types" value={ready ? num(totals.types) : null} />
        <KpiCard icon={Target} label="Custom event types" value={ready ? num(totals.custom) : null} />
      </div>

      {showCode && <TrackEventPanel site={site} />}

      <Panel
        flush
        title="All events"
        subtitle={rangeLong(range)}
        action={
          <>
            <SegmentedControl label="Event type" value={filter} options={FILTERS} onChange={setFilter} />
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events" aria-label="Search events" className={`${inputCls} !h-10 w-48 pl-9 !text-sm`} />
            </div>
          </>
        }
      >
        <EventsTable rows={rows} max={totals.max} loading={!ready && !report.error} noEventsAtAll={totals.types === 0} />
      </Panel>

      {highCardinality.map((h) => (
        <Notice key={`${h.name}.${h.key}`} tone="warning">
          The property <span className="font-mono font-medium">{h.key}</span> on <span className="font-mono font-medium">{h.name}</span> has {num(h.distinctValues)} distinct values.
          Properties with that many values can't be used as report breakdowns: they stay searchable but never become a rollup.
        </Notice>
      ))}
    </div>
  );
}
