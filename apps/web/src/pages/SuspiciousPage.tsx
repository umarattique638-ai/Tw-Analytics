import { Bot, Link2, ShieldAlert, ShieldCheck } from 'lucide-react';
import KpiCard from '../components/dashboard/KpiCard';
import NoSiteYet from '../components/dashboard/NoSiteYet';
import RangeSelect, { rangeLong } from '../components/dashboard/RangeSelect';
import DropReasons from '../components/suspicious/DropReasons';
import DropsList from '../components/suspicious/DropsList';
import Notice from '../components/ui/Notice';
import PageHeader from '../components/ui/PageHeader';
import Panel from '../components/ui/Panel';
import SegmentedControl from '../components/ui/SegmentedControl';
import type { Site } from '../api/client';
import { dropLabel, num } from '../lib/format';
import { useAllowHost, useDropsReport } from '../hooks/useDrops';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRange } from '../hooks/useRange';
import { useSession } from '../hooks/useSession';

/** Every dropped hit from dropped_hits, with its reason. "Allow" exists where it makes sense: a host. */
export default function SuspiciousPage() {
  useDocumentTitle('Suspicious activity');
  const { current, upsert } = useSession();
  if (!current) return <NoSiteYet />;
  return <Suspicious site={current} onSite={upsert} />;
}

function Suspicious({ site, onSite }: { site: Site; onSite: (s: Site) => void }) {
  const [range, setRange] = useRange();
  const { report, byReason, total, reasons, shown, filter, setFilter } = useDropsReport(site.id, range);
  const hosts = useAllowHost(site, onSite);
  const ready = !!report.data;
  const count = (reason: string) => (ready ? num(byReason.get(reason) ?? 0) : null);

  return (
    <div className="grid gap-6">
      <PageHeader title="Suspicious activity" description="Every hit we dropped, with the reason. Nothing is discarded silently." actions={<RangeSelect value={range} onChange={setRange} />} />

      {report.error && <Notice tone="error">{report.error}</Notice>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ShieldAlert} label="Hits dropped" value={ready ? num(total) : null} />
        <KpiCard icon={Bot} label="Bots" value={count('bot')} />
        <KpiCard icon={Link2} label="Wrong hostname" value={count('hostname')} />
        <KpiCard icon={ShieldCheck} label="Install checks" value={count('verification_agent')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <DropReasons reasons={reasons} total={total} />
        <Panel
          title="Dropped hits"
          subtitle={`${rangeLong(range)}, newest first`}
          className="xl:col-span-2"
          action={
            reasons.length > 1 && (
              <SegmentedControl label="Reason" value={filter} options={[{ value: 'all', label: 'All' }, ...reasons.map(([r]) => ({ value: r, label: dropLabel(r) }))]} onChange={setFilter} />
            )
          }
        >
          <DropsList rows={shown} loading={!ready && !report.error} isAllowed={hosts.isAllowed} busyHost={hosts.busyHost} onAllow={hosts.allow} />
        </Panel>
      </div>
    </div>
  );
}
