import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock3, Download, FileJson, ShieldCheck, Trash2 } from 'lucide-react';
import PageHead from '../components/dashboard/PageHead';
import Panel from '../components/dashboard/Panel';
import Field from '../components/ui/Field';
import FormError from '../components/ui/FormError';
import { account, api } from '../api/client';
import type { Site } from '../api/client';
import { useSession } from '../api/session';

/** 30 -> "30 days", 395 -> "13 months". */
const retentionLabel = (days: number) => (days === 395 ? '13 months' : days === 180 ? '6 months' : `${days} days`);

const btn =
  'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-[15px] font-semibold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60';

export default function SettingsPage() {
  const { sites, role, retention, upsert, user } = useSession();
  const owner = role === 'owner';

  return (
    <div className="grid gap-6">
      <PageHead title="Settings" sub={`Signed in as ${user.email}`} />
      <RetentionPanel sites={sites} choices={retention.choices} canEdit={role !== 'viewer'} onSaved={upsert} />
      <ExportPanel />
      {owner && <DeletePanel siteCount={sites.length} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------ retention

function RetentionPanel({ sites, choices, canEdit, onSaved }: { sites: Site[]; choices: number[]; canEdit: boolean; onSaved: (s: Site) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  const [pending, setPending] = useState<{ site: Site; days: number } | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const save = async (site: Site, days: number) => {
    setBusy(site.id);
    setNotice(null);
    try {
      const { site: updated } = await api.updateSite(site.id, { retentionDays: days });
      onSaved(updated);
      setNotice({
        kind: 'ok',
        text: days < site.retentionDays ? `${site.domain} now keeps ${retentionLabel(days)}. Older data is deleted within a week.` : `${site.domain} now keeps ${retentionLabel(days)}.`,
      });
    } catch (e) {
      setNotice({ kind: 'error', text: e instanceof Error ? e.message : 'Could not save.' });
    } finally {
      setBusy(null);
      setPending(null);
    }
  };
  // Shorter = data will be deleted: ask first. Longer only keeps future data longer.
  const pick = (site: Site, days: number) => {
    if (days === site.retentionDays) return;
    if (days < site.retentionDays) setPending({ site, days });
    else save(site, days);
  };

  return (
    <Panel title="Data retention" subtitle="How long each site keeps its analytics. Older data is deleted automatically, in weekly batches.">
      {sites.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Add a site first.</p>
      ) : (
        <ul className="grid gap-3" data-testid="retention-list">
          {sites.map((site) => (
            <li key={site.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center dark:border-slate-800">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="grid size-9 flex-none place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300">
                  <Clock3 className="size-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900 dark:text-white">{site.domain}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Keeps {retentionLabel(site.retentionDays)}</p>
                </div>
              </div>
              <div role="radiogroup" aria-label={`Retention of ${site.domain}`} className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-4 dark:bg-slate-800/70">
                {choices.map((days) => {
                  const on = days === site.retentionDays;
                  return (
                    <button
                      key={days}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!canEdit || busy === site.id}
                      onClick={() => pick(site, days)}
                      className={`h-9 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/20 disabled:cursor-not-allowed ${
                        on
                          ? 'bg-white text-teal-800 shadow-sm dark:bg-slate-950 dark:text-teal-300'
                          : 'text-slate-600 hover:text-slate-900 disabled:opacity-60 dark:text-slate-400 dark:hover:text-white'
                      }`}
                    >
                      {retentionLabel(days)}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
        A deleted site keeps its data for its retention too, so adding it again brings the history back. {canEdit ? '' : 'Only the owner or an admin can change this.'}
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
      {pending && (
        <Confirm
          title={`Keep ${retentionLabel(pending.days)} for ${pending.site.domain}?`}
          body={`Data older than ${retentionLabel(pending.days)} is deleted within a week and cannot be brought back. Download your data first if you want a copy.`}
          action="Shorten retention"
          busy={busy !== null}
          onCancel={() => setPending(null)}
          onConfirm={() => save(pending.site, pending.days)}
        />
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------ export

/** Shared by the export panel and step 1 of deleting the account. */
function useExport() {
  const [state, setState] = useState<{ busy: boolean; done: boolean; error: string | null }>({ busy: false, done: false, error: null });
  const run = async () => {
    setState({ busy: true, done: false, error: null });
    try {
      await account.download();
      setState({ busy: false, done: true, error: null });
    } catch (e) {
      setState({ busy: false, done: false, error: e instanceof Error ? e.message : 'The download failed.' });
    }
  };
  return { ...state, run };
}

function ExportPanel() {
  const { busy, done, error, run } = useExport();
  return (
    <Panel title="Download your data" subtitle="Everything we store for your account, in one file">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className="grid size-10 flex-none place-items-center rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-300">
            <FileJson className="size-5" />
          </span>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Your account, every site and its settings, visitors, sessions and page views for every stored day, all pages and events, blocked
            traffic, saved reports and the activity log. A JSON file that opens in any editor and can be read by other tools.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          data-testid="export-account"
          className={`${btn} flex-none bg-teal-700 text-white shadow-sm hover:bg-teal-800 focus-visible:ring-teal-600/30 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400`}
        >
          {busy ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Download className="size-4" />}
          {busy ? 'Preparing…' : 'Download all data'}
        </button>
      </div>
      {done && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4" /> Downloaded. Keep the file somewhere safe.
        </p>
      )}
      {error && (
        <div className="mt-4">
          <FormError message={error} />
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------ delete

function DeletePanel({ siteCount }: { siteCount: number }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exporting = useExport();
  const ready = password.length > 0 && confirm === 'DELETE';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { erasure } = await account.remove(password, confirm);
      navigate('/login', {
        replace: true,
        state: {
          notice: `Your account was deleted. ${erasure.trackingStopped ? 'Tracking has stopped.' : 'Tracking stops within a day.'} Collected analytics are erased within ${erasure.finishesWithinDays} days; we e-mail you when it is done.`,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The account could not be deleted.');
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-rose-200 bg-white shadow-sm dark:border-rose-400/25 dark:bg-slate-900">
      <header className="flex items-start gap-3 border-b border-rose-100 px-6 py-4 dark:border-rose-400/15">
        <AlertTriangle className="mt-0.5 size-5 flex-none text-rose-600 dark:text-rose-400" />
        <div>
          <h2 className="text-[15px] font-semibold text-slate-900 dark:text-white">Delete account</h2>
          <p className="mt-0.5 text-[13px] text-slate-500 dark:text-slate-400">Permanently removes your workspace and erases all collected data</p>
        </div>
      </header>
      <div className="p-6">
        {!open ? (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <ul className="grid flex-1 gap-1.5 text-sm text-slate-600 dark:text-slate-300">
              <li>Your login, workspace, {siteCount === 1 ? 'site' : `${siteCount} sites`}, saved reports and activity log are deleted at once.</li>
              <li>Tracking stops: the collector no longer accepts your site keys.</li>
              <li>Collected analytics are erased within a few days, and we e-mail you when that is confirmed.</li>
            </ul>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={`${btn} flex-none border border-rose-300 bg-white text-rose-700 hover:bg-rose-50 focus-visible:ring-rose-600/20 dark:border-rose-400/40 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-400/10`}
            >
              <Trash2 className="size-4" /> Delete account…
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="grid max-w-lg gap-5" data-testid="delete-account-form">
            <ol className="grid gap-4">
              <li className="flex gap-3">
                <Step n={1} />
                <div className="min-w-0 text-sm text-slate-600 dark:text-slate-300">
                  <p className="font-semibold text-slate-900 dark:text-white">Download your data first</p>
                  <p className="mt-0.5">This cannot be undone. Keep a copy with the button above.</p>
                  <button
                    type="button"
                    onClick={exporting.run}
                    disabled={exporting.busy}
                    className="mt-2 inline-flex items-center gap-1.5 font-semibold text-teal-700 hover:underline disabled:opacity-60 dark:text-teal-400"
                  >
                    {exporting.done ? <CheckCircle2 className="size-4" /> : <Download className="size-4" />}
                    {exporting.busy ? 'Preparing…' : exporting.done ? 'Downloaded' : 'Download all data'}
                  </button>
                  {exporting.error && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{exporting.error}</p>}
                </div>
              </li>
              <li className="flex gap-3">
                <Step n={2} />
                <div className="min-w-0 flex-1">
                  <Field label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
              </li>
              <li className="flex gap-3">
                <Step n={3} />
                <div className="min-w-0 flex-1">
                  <Field label="Type DELETE to confirm" autoComplete="off" spellCheck={false} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" required />
                </div>
              </li>
            </ol>
            <FormError message={error} />
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={!ready || busy}
                className={`${btn} bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600/30`}
              >
                {busy ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Trash2 className="size-4" />}
                {busy ? 'Deleting…' : 'Delete account permanently'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setPassword('');
                  setConfirm('');
                  setError(null);
                }}
                className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400/30 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800`}
              >
                Cancel
              </button>
            </div>
            <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <ShieldCheck className="size-4 flex-none" /> We keep only a receipt that the erasure happened, without your e-mail address.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}

const Step = ({ n }: { n: number }) => (
  <span className="grid size-7 flex-none place-items-center rounded-full bg-rose-50 text-sm font-semibold text-rose-700 dark:bg-rose-400/10 dark:text-rose-300">{n}</span>
);

/** A small confirm dialog (same look as ConfirmDeleteModal, with its own wording). */
function Confirm({ title, body, action, busy, onCancel, onConfirm }: { title: string; body: string; action: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={busy ? undefined : onCancel} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy} className="h-10 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:opacity-60">
            {busy ? 'Saving…' : action}
          </button>
        </div>
      </div>
    </div>
  );
}
