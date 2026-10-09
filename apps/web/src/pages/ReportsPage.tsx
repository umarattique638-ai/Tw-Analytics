import { useCallback, useEffect, useState } from 'react';
import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Link2,
  Mail,
  RefreshCw,
  ServerCog,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PageHead from '../components/dashboard/PageHead';
import Panel from '../components/dashboard/Panel';
import ConfirmDeleteModal from '../components/common/ConfirmDeleteModal';
import { reports, startDownload } from '../api/client';
import type { RangeKey, Report } from '../api/client';
import { useSession } from '../api/session';

const RANGES: { value: RangeKey; label: string; hint: string }[] = [
  { value: 'today', label: 'Today', hint: 'one row per hour' },
  { value: '7d', label: 'Last 7 days', hint: 'one row per day' },
  { value: '30d', label: 'Last 30 days', hint: 'one row per day' },
];
const rangeLabel = (r: RangeKey) => RANGES.find((x) => x.value === r)?.label ?? r;

/** Not built yet. Listed honestly instead of showing controls that do nothing. */
const NEXT: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Mail, title: 'Email digest', desc: 'A weekly or monthly summary in your inbox.' },
  { icon: BellRing, title: 'Alerts', desc: 'Traffic spike, traffic drop (often a broken snippet) and capture rate below 85%.' },
  { icon: KeyRound, title: 'Stats API key', desc: 'Read your numbers from your own tools with a read-only key.' },
  { icon: Link2, title: 'Public dashboard link', desc: 'A read-only page anyone with the link can open.' },
  { icon: ServerCog, title: 'Server log comparison', desc: 'What your server saw versus what the script recorded.' },
];

const DAY = 86_400_000;
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
/** "2026-10-02" (a local calendar date, no time zone) -> "2 Oct 2026". */
const localDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return y && m && day ? dateFmt.format(new Date(Date.UTC(y, m - 1, day, 12))) : d;
};
const period = (r: Report) => (r.from === r.to ? localDate(r.from) : `${localDate(r.from)} – ${localDate(r.to)}`);
const size = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const daysLeft = (r: Report, now: number) => Math.max(0, Math.ceil((Date.parse(r.expiresAt) - now) / DAY));

const iconBtn =
  'grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white';

export default function ReportsPage() {
  const { current } = useSession();
  const [range, setRange] = useState<RangeKey>('30d');
  const [list, setList] = useState<Report[] | null>(null);
  const [keepDays, setKeepDays] = useState(90);
  const [max, setMax] = useState(200);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Report | null>(null);
  const [deleting, setDeleting] = useState(false);
  const siteId = current?.id;

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoadError(null);
    try {
      const r = await reports.list(siteId);
      setList(r.exports);
      setKeepDays(r.keepDays);
      setMax(r.max);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your reports.');
    }
  }, [siteId]);

  useEffect(() => {
    setList(null);
    setNotice(null);
    load();
  }, [load]);

  // A notice fades on its own.
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  if (!current) return <p className="text-slate-500">Add a site first.</p>;

  const create = async () => {
    setCreating(true);
    setNotice(null);
    try {
      const { export: r } = await reports.create(current.id, range);
      setList((l) => [r, ...(l ?? [])]);
      setFresh(r.id);
      startDownload(reports.downloadUrl(current.id, r.id), r.filename);
      setNotice({ kind: 'ok', text: `Report saved and downloading: ${r.filename}` });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'The report could not be made.' });
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await reports.remove(current.id, toDelete.id);
      setList((l) => (l ?? []).filter((r) => r.id !== toDelete.id));
      setNotice({ kind: 'ok', text: 'Report deleted.' });
      setToDelete(null);
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'The report could not be deleted.' });
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const now = Date.now();

  return (
    <div className="grid gap-6">
      <PageHead title="Reports" sub={`Download your numbers as CSV. Every report is saved here for ${keepDays} days.`} />

      {/* ------------------------------------------------------------ create */}
      <Panel title="New report" subtitle="The same numbers as the Visitors over time chart: visitors, sessions, page views">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <fieldset className="min-w-0 flex-1">
            <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">Date range</legend>
            <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
              {RANGES.map((r) => {
                const on = r.value === range;
                return (
                  <button
                    key={r.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setRange(r.value)}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/20 ${
                      on
                        ? 'border-teal-600 bg-teal-50/70 ring-1 ring-teal-600 dark:border-teal-400 dark:bg-teal-400/10 dark:ring-teal-400'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
                    }`}
                  >
                    <span
                      className={`grid size-4 flex-none place-items-center rounded-full border-2 ${
                        on ? 'border-teal-600 dark:border-teal-400' : 'border-slate-300 dark:border-slate-600'
                      }`}
                    >
                      {on && <span className="size-1.5 rounded-full bg-teal-600 dark:bg-teal-400" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900 dark:text-white">{r.label}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{r.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={create}
            disabled={creating}
            data-testid="create-report"
            className="inline-flex h-12 flex-none items-center justify-center gap-2 rounded-xl bg-teal-700 px-6 text-[15px] font-semibold text-white shadow-sm transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/30 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            {creating ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Download className="size-4" />}
            {creating ? 'Preparing…' : 'Create & download'}
          </button>
        </div>
        <p className="mt-4 flex items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400">
          <FileSpreadsheet className="size-4 flex-none" />
          Days are counted in {current.timezone}. Opens in Excel or Google Sheets.
        </p>
        {notice && (
          <p
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`mt-4 flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-medium ${
              notice.kind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200'
                : 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300'
            }`}
          >
            {notice.kind === 'ok' && <CheckCircle2 className="size-4 flex-none" />}
            <span className="min-w-0 break-words">{notice.text}</span>
          </p>
        )}
      </Panel>

      {/* ------------------------------------------------------------ saved */}
      <Panel
        title="Saved reports"
        subtitle={`Deleted automatically ${keepDays} days after they are made${list ? ` · ${list.length} of ${max}` : ''}`}
        action={
          <button type="button" onClick={load} className={iconBtn} title="Refresh" aria-label="Refresh the list">
            <RefreshCw className="size-4" />
          </button>
        }
        className="overflow-hidden"
      >
        {loadError ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
            {loadError}
          </p>
        ) : list === null ? (
          <div className="grid gap-3" aria-label="Loading">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="grid place-items-center gap-2 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300">
              <FileText className="size-6" />
            </span>
            <p className="text-[15px] font-semibold text-slate-800 dark:text-slate-100">No reports yet</p>
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
              Pick a date range above and press <b>Create &amp; download</b>. A copy stays here so you can download it again.
            </p>
          </div>
        ) : (
          <>
          {/* phones: one card per report */}
          <ul className="grid gap-3 md:hidden" data-testid="reports-cards">
            {list.map((r) => {
              const left = daysLeft(r, now);
              return (
                <li key={r.id} className={`rounded-xl border p-4 ${r.id === fresh ? 'border-teal-300 bg-teal-50/60 dark:border-teal-400/30 dark:bg-teal-400/5' : 'border-slate-200 dark:border-slate-800'}`}>
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 flex-none place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                      <FileSpreadsheet className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 dark:text-white">{rangeLabel(r.range)}</p>
                      <p className="text-[13px] text-slate-600 dark:text-slate-300">{period(r)}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {dateFmt.format(new Date(r.createdAt))} {timeFmt.format(new Date(r.createdAt))} · {size(r.bytes)} · deleted {left === 0 ? 'today' : `in ${left}d`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <a
                      href={reports.downloadUrl(current.id, r.id)}
                      download={r.filename}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Download className="size-4" /> Download
                    </a>
                    <button
                      type="button"
                      onClick={() => setToDelete(r)}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:border-slate-700 dark:text-rose-300 dark:hover:bg-rose-400/10"
                    >
                      <Trash2 className="size-4" /> Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="-mx-6 -my-6 hidden overflow-x-auto md:block">
            <table className="w-full min-w-[600px] text-left text-sm" data-testid="reports-table">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                  <th scope="col" className="px-6 py-3">Report</th>
                  <th scope="col" className="px-4 py-3">Period</th>
                  <th scope="col" className="hidden px-4 py-3 xl:table-cell">Size</th>
                  <th scope="col" className="px-4 py-3">Created</th>
                  <th scope="col" className="px-4 py-3">Auto-delete</th>
                  <th scope="col" className="px-6 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {list.map((r) => {
                  const left = daysLeft(r, now);
                  const created = new Date(r.createdAt);
                  return (
                    <tr
                      key={r.id}
                      data-report={r.id}
                      className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${r.id === fresh ? 'bg-teal-50/60 dark:bg-teal-400/5' : ''}`}
                    >
                      <td className="px-6 py-3.5">
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 flex-none place-items-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300">
                            <FileSpreadsheet className="size-[18px]" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 dark:text-white">{rangeLabel(r.range)}</p>
                            <p className="max-w-[200px] truncate text-xs text-slate-500 dark:text-slate-400" title={r.filename}>
                              {r.filename}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-slate-700 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <CalendarDays className="size-3.5 text-slate-400" />
                          {period(r)}
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3.5 text-slate-500 xl:table-cell dark:text-slate-400">
                        {r.rows} row{r.rows === 1 ? '' : 's'} · {size(r.bytes)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-slate-700 dark:text-slate-300">
                        {dateFmt.format(created)}
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{timeFmt.format(created)}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          title={`Deleted on ${dateFmt.format(new Date(r.expiresAt))}`}
                          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
                            left <= 7
                              ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          <Clock3 className="size-3" />
                          {left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`}
                        </span>
                      </td>
                      <td className="px-6 py-3.5">
                        <div className="flex justify-end gap-2">
                          <a
                            href={reports.downloadUrl(current.id, r.id)}
                            download={r.filename}
                            className={iconBtn}
                            title="Download"
                            aria-label={`Download ${r.filename}`}
                          >
                            <Download className="size-4" />
                          </a>
                          <button
                            type="button"
                            onClick={() => setToDelete(r)}
                            className={`${iconBtn} hover:!border-rose-200 hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!border-rose-400/30 dark:hover:!bg-rose-400/10 dark:hover:!text-rose-300`}
                            title="Delete"
                            aria-label={`Delete ${r.filename}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Panel>

      {/* ------------------------------------------------------------ next */}
      <Panel title="Coming next" subtitle="Not available yet">
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {NEXT.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-9 flex-none place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <Icon className="size-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
                <p className="text-[13px] text-slate-500 dark:text-slate-400">{desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      {toDelete && (
        <ConfirmDeleteModal
          title="Delete this report?"
          message={
            <>
              <span className="font-medium text-slate-700 dark:text-slate-200">{toDelete.filename}</span> is removed from your saved reports. Your
              analytics data is not touched: you can make the same report again any time.
            </>
          }
          deleting={deleting}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
