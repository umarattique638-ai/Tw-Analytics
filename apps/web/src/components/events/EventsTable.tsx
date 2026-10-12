import { Sparkles } from 'lucide-react';
import Badge from '../ui/Badge';
import EmptyState from '../ui/EmptyState';
import { SkeletonRows } from '../ui/Skeleton';
import { ago, num } from '../../lib/format';
import type { EventsReport } from '../../api/client';

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

type Row = EventsReport['events'][number];

const th = 'px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400';

export default function EventsTable({ rows, max, loading, noEventsAtAll }: { rows: Row[]; max: number; loading: boolean; noEventsAtAll: boolean }) {
  if (loading) return <div className="p-5 sm:p-6"><SkeletonRows rows={4} /></div>;
  if (rows.length === 0)
    return (
      <EmptyState icon={Sparkles} title={noEventsAtAll ? 'No events in this period yet' : 'No events match'}>
        {noEventsAtAll ? 'Events appear here with their first hit.' : 'Try another filter or search.'}
      </EmptyState>
    );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm" data-testid="events-table">
        <thead className="border-b border-slate-100 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/30">
          <tr>
            <th scope="col" className={`${th} pl-5 sm:pl-6`}>Event</th>
            <th scope="col" className={th}>Type</th>
            <th scope="col" className={`${th} text-right`}>Events</th>
            <th scope="col" className={th}>Last seen</th>
            <th scope="col" className={`${th} pr-5 sm:pr-6`}>Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((e) => (
            <tr key={e.name} data-event={e.name} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
              <td className="py-3 pr-4 pl-5 sm:pl-6">
                <p className="font-mono text-[13px] font-medium text-slate-900 dark:text-white">{e.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{LABELS[e.name] ?? 'Custom event'}</p>
              </td>
              <td className="px-4 py-3">
                <Badge tone={e.kind === 'custom' ? 'teal' : 'neutral'}>{e.kind === 'custom' ? 'Custom' : 'Automatic'}</Badge>
              </td>
              <td className="px-4 py-3 text-right">
                <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{num(e.events)}</span>
                <span className="mt-1 ml-auto block h-1 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
                  <span className="block h-full rounded-full bg-teal-500" style={{ width: `${(e.events / max) * 100}%` }} />
                </span>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">{ago(e.last)}</td>
              <td className="py-3 pr-5 pl-4 sm:pr-6">
                {e.isNew ? (
                  <Badge tone="amber" title="First seen in this period">New · review</Badge>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    Active
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
