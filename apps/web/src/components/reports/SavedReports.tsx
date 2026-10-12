import { CalendarDays, Clock3, Download, FileSpreadsheet, FileText, RefreshCw, Trash2 } from 'lucide-react';
import Badge from '../ui/Badge';
import EmptyState from '../ui/EmptyState';
import IconButton, { iconButtonCls } from '../ui/IconButton';
import Notice from '../ui/Notice';
import Panel from '../ui/Panel';
import { SkeletonRows } from '../ui/Skeleton';
import { reports } from '../../api/client';
import type { Report } from '../../api/client';
import { rangeLong } from '../dashboard/RangeSelect';
import { dateFmt, daysLeft, leftLabel, period, size, timeFmt } from './format';

type Props = {
  siteId: number;
  list: Report[] | null;
  keepDays: number;
  max: number;
  loadError: string | null;
  fresh: string | null;
  onReload: () => void;
  onDelete: (r: Report) => void;
};

const th = 'px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400';
const FileIcon = () => (
  <span className="grid size-9 flex-none place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
    <FileSpreadsheet className="size-[18px]" aria-hidden="true" />
  </span>
);

/** The saved CSV reports: cards on phones, a table from md up. */
export default function SavedReports({ siteId, list, keepDays, max, loadError, fresh, onReload, onDelete }: Props) {
  const now = Date.now();
  const body = loadError ? (
    <div className="p-5 sm:p-6">
      <Notice tone="error">{loadError}</Notice>
    </div>
  ) : list === null ? (
    <div className="p-5 sm:p-6">
      <SkeletonRows rows={3} className="h-14" />
    </div>
  ) : list.length === 0 ? (
    <EmptyState icon={FileText} title="No reports yet">
      Pick a date range above and press <b>Create &amp; download</b>. A copy stays here so you can download it again.
    </EmptyState>
  ) : (
    <>
      <ul className="grid gap-3 p-4 md:hidden" data-testid="reports-cards">
        {list.map((r) => (
          <li key={r.id} className={`rounded-xl border p-4 ${r.id === fresh ? 'border-teal-300 bg-teal-50/60 dark:border-teal-400/30 dark:bg-teal-400/5' : 'border-slate-200 dark:border-slate-800'}`}>
            <div className="flex items-start gap-3">
              <FileIcon />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 dark:text-white">{rangeLong(r.range)}</p>
                <p className="text-[13px] text-slate-600 dark:text-slate-300">{period(r)}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {dateFmt.format(new Date(r.createdAt))} {timeFmt.format(new Date(r.createdAt))} · {size(r.bytes)} · deleted {leftLabel(daysLeft(r, now))}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <a href={reports.downloadUrl(siteId, r.id)} download={r.filename} className={`${iconButtonCls} !flex !h-10 !w-auto gap-2 text-sm font-semibold`}>
                <Download className="size-4" aria-hidden="true" /> Download
              </a>
              <button type="button" onClick={() => onDelete(r)} className={`${iconButtonCls} !flex !h-10 !w-auto gap-2 text-sm font-semibold text-rose-600 dark:text-rose-300`}>
                <Trash2 className="size-4" aria-hidden="true" /> Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[600px] text-sm" data-testid="reports-table">
          <thead className="border-b border-slate-100 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/30">
            <tr>
              <th scope="col" className={`${th} pl-6`}>Report</th>
              <th scope="col" className={th}>Period</th>
              <th scope="col" className={`${th} hidden 2xl:table-cell`}>Size</th>
              <th scope="col" className={th}>Created</th>
              <th scope="col" className={th}>Auto-delete</th>
              <th scope="col" className={`${th} pr-6 text-right`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.map((r) => {
              const left = daysLeft(r, now);
              const created = new Date(r.createdAt);
              return (
                <tr key={r.id} data-report={r.id} className={`transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30 ${r.id === fresh ? 'bg-teal-50/60 dark:bg-teal-400/5' : ''}`}>
                  <td className="py-3.5 pr-4 pl-6">
                    <div className="flex items-center gap-3">
                      <FileIcon />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white">{rangeLong(r.range)}</p>
                        <p className="max-w-[180px] truncate text-xs text-slate-500 dark:text-slate-400" title={r.filename}>
                          {r.filename}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <CalendarDays className="size-3.5 text-slate-400" aria-hidden="true" />
                      {period(r)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3.5 whitespace-nowrap text-slate-500 2xl:table-cell dark:text-slate-400">
                    {r.rows} row{r.rows === 1 ? '' : 's'} · {size(r.bytes)}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-slate-700 dark:text-slate-300">
                    {dateFmt.format(created)}
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{timeFmt.format(created)}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge tone={left <= 7 ? 'amber' : 'neutral'} title={`Deleted on ${dateFmt.format(new Date(r.expiresAt))}`} className="rounded-full px-2.5 py-1 font-medium">
                      <Clock3 className="size-3" aria-hidden="true" />
                      {leftLabel(left)}
                    </Badge>
                  </td>
                  <td className="py-3.5 pr-6 pl-4">
                    <div className="flex justify-end gap-2">
                      <a href={reports.downloadUrl(siteId, r.id)} download={r.filename} className={iconButtonCls} title="Download" aria-label={`Download ${r.filename}`}>
                        <Download className="size-4" aria-hidden="true" />
                      </a>
                      <IconButton icon={Trash2} danger label={`Delete ${r.filename}`} onClick={() => onDelete(r)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <Panel
      flush
      title="Saved reports"
      subtitle={`Deleted automatically ${keepDays} days after they are made${list ? ` · ${list.length} of ${max}` : ''}`}
      action={<IconButton icon={RefreshCw} label="Refresh the list" onClick={onReload} />}
      className="overflow-hidden"
    >
      {body}
    </Panel>
  );
}
