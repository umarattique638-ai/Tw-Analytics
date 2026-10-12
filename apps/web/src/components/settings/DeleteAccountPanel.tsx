import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Download, ShieldCheck, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import Field from '../ui/Field';
import FormError from '../ui/FormError';
import Panel from '../ui/Panel';
import { textLinkCls } from '../ui/TextLink';
import { notify } from '../../lib/notify';
import { useAccountExport, useDeleteAccount } from '../../hooks/useAccount';

const Step = ({ n }: { n: number }) => (
  <span className="grid size-7 flex-none place-items-center rounded-full bg-rose-50 text-sm font-semibold text-rose-700 dark:bg-rose-400/10 dark:text-rose-300" aria-hidden="true">
    {n}
  </span>
);

const toastDeleted = (stopped: boolean, days: number) =>
  notify.success(`Your account was deleted. ${stopped ? 'Tracking has stopped.' : 'Tracking stops within a day.'}`, {
    description: `Collected analytics are erased within ${days} days; we e-mail you when it is done.`,
  });

/** Owner only: delete the account, after the password and the word DELETE. */
export default function DeleteAccountPanel({ siteCount }: { siteCount: number }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const exporting = useAccountExport();
  const del = useDeleteAccount((erasure) => {
    toastDeleted(erasure.trackingStopped, erasure.finishesWithinDays);
    navigate('/login', { replace: true });
  });

  return (
    <Panel tone="danger" title="Delete account" subtitle="Permanently removes your workspace and erases all collected data">
      {!open ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <ul className="grid flex-1 list-disc gap-1.5 pl-5 text-sm text-slate-600 marker:text-rose-400 dark:text-slate-300">
            <li>Your login, workspace, {siteCount === 1 ? 'site' : `${siteCount} sites`}, saved reports and activity log are deleted at once.</li>
            <li>Tracking stops: the collector no longer accepts your site keys.</li>
            <li>Collected analytics are erased within a few days, and we e-mail you when that is confirmed.</li>
          </ul>
          <Button variant="dangerOutline" className="flex-none" onClick={() => setOpen(true)}>
            <Trash2 className="size-4" aria-hidden="true" /> Delete account…
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (del.ready) del.submit();
          }}
          className="grid max-w-lg gap-5"
          data-testid="delete-account-form"
        >
          <ol className="grid gap-4">
            <li className="flex gap-3">
              <Step n={1} />
              <div className="min-w-0 text-sm text-slate-600 dark:text-slate-300">
                <p className="font-semibold text-slate-900 dark:text-white">Download your data first</p>
                <p className="mt-0.5">This cannot be undone. Keep a copy.</p>
                <button type="button" onClick={() => exporting.download()} disabled={exporting.busy} className={`mt-2 inline-flex items-center gap-1.5 disabled:opacity-60 ${textLinkCls}`}>
                  {exporting.done ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <Download className="size-4" aria-hidden="true" />}
                  {exporting.busy ? 'Preparing…' : exporting.done ? 'Downloaded' : 'Download all data'}
                </button>
              </div>
            </li>
            <li className="flex gap-3">
              <Step n={2} />
              <div className="min-w-0 flex-1">
                <Field label="Your password" type="password" autoComplete="current-password" value={del.password} onChange={(e) => del.setPassword(e.target.value)} required />
              </div>
            </li>
            <li className="flex gap-3">
              <Step n={3} />
              <div className="min-w-0 flex-1">
                <Field label="Type DELETE to confirm" autoComplete="off" spellCheck={false} value={del.confirm} onChange={(e) => del.setConfirm(e.target.value)} placeholder="DELETE" required />
              </div>
            </li>
          </ol>
          <FormError message={del.error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" disabled={!del.ready} loading={del.busy}>
              {!del.busy && <Trash2 className="size-4" aria-hidden="true" />}
              {del.busy ? 'Deleting…' : 'Delete account permanently'}
            </Button>
            <Button
              variant="secondary"
              disabled={del.busy}
              onClick={() => {
                setOpen(false);
                del.reset();
              }}
            >
              Cancel
            </Button>
          </div>
          <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="size-4 flex-none" aria-hidden="true" /> We keep only a receipt that the erasure happened, without your e-mail address.
          </p>
        </form>
      )}
    </Panel>
  );
}
