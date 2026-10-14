import { useState } from 'react';
import FinishSetup from '../components/dashboard/FinishSetup';
import NoSiteYet from '../components/dashboard/NoSiteYet';
import NewReport from '../components/reports/NewReport';
import SavedReports from '../components/reports/SavedReports';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import PageHeader from '../components/ui/PageHeader';
import type { Report, Site } from '../api/client';
import { useReports } from '../hooks/useReports';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';

export default function ReportsPage() {
  useDocumentTitle('Reports');
  const { current } = useSession();
  if (!current) return <NoSiteYet />;
  if (!current.verifiedAt) return <FinishSetup site={current} />;
  return <Reports site={current} />;
}

function Reports({ site }: { site: Site }) {
  const r = useReports(site.id);
  const [toDelete, setToDelete] = useState<Report | null>(null);

  return (
    <div className="grid gap-6">
      <PageHeader title="Reports" description={`Download your numbers as CSV. Every report is saved here for ${r.keepDays} days.`} />
      <NewReport timezone={site.timezone} creating={r.creating} onCreate={r.create} />
      <SavedReports siteId={site.id} list={r.list} keepDays={r.keepDays} max={r.max} loadError={r.loadError} fresh={r.fresh} onReload={r.reload} onDelete={setToDelete} />

      {toDelete && (
        <ConfirmDialog
          title="Delete this report?"
          confirmLabel="Delete"
          busyLabel="Deleting…"
          busy={r.deleting}
          onCancel={() => setToDelete(null)}
          onConfirm={async () => {
            await r.remove(toDelete);
            setToDelete(null);
          }}
          message={
            <>
              <span className="font-medium text-slate-700 dark:text-slate-200">{toDelete.filename}</span> is removed from your saved reports. Your analytics data is not touched: you
              can make the same report again any time.
            </>
          }
        />
      )}
    </div>
  );
}
