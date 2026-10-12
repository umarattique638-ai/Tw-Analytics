import { ChevronDown, History, RefreshCw } from 'lucide-react';
import ActivityTimeline from '../components/activity/ActivityTimeline';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import IconButton from '../components/ui/IconButton';
import Notice from '../components/ui/Notice';
import PageHeader from '../components/ui/PageHeader';
import Panel from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { useActivity } from '../hooks/useActivity';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';

/** Who changed what, and when (the audit log). */
export default function ActivityPage() {
  useDocumentTitle('Activity');
  const { sites } = useSession();
  const log = useActivity();

  return (
    <div className="grid gap-6">
      <PageHeader title="Activity" description={`Who changed what, and when. Kept for ${log.keepDays} days; no IP addresses are stored.`} />
      <Panel
        title="Activity log"
        subtitle="Sign-ins, site and key changes, reports, and what the nightly jobs did"
        action={
          <>
            <div className="relative">
              <select
                aria-label="Filter by site"
                value={log.site ?? ''}
                onChange={(e) => log.setSite(e.target.value ? Number(e.target.value) : null)}
                className="h-9 max-w-[200px] cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white pr-8 pl-3 text-sm text-slate-700 transition hover:border-slate-300 focus:ring-4 focus:ring-teal-600/20 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">All activity</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.domain}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            </div>
            <IconButton icon={RefreshCw} label="Refresh" spin={log.busy} onClick={log.refresh} />
          </>
        }
      >
        {log.error && (
          <Notice tone="error" className="mb-4">
            {log.error}
          </Notice>
        )}
        {log.entries === null ? (
          <SkeletonRows rows={4} />
        ) : log.entries.length === 0 ? (
          <EmptyState icon={History} title="Nothing here yet">
            Sign-ins, changes to your sites and the nightly clean-up show up here.
          </EmptyState>
        ) : (
          <>
            <ActivityTimeline days={log.days} />
            {log.hasMore && (
              <div className="mt-6 flex justify-center">
                <Button variant="secondary" size="sm" className="h-10 px-4" onClick={log.loadMore} loading={log.busy}>
                  Show older
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
