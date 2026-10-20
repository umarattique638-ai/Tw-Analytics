import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Download, Globe, History, Trash2 } from 'lucide-react';
import { RANGES } from '../components/dashboard/RangeSelect';
import DeleteSiteDialog from '../components/layout/DeleteSiteDialog';
import Badge from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import Button from '../components/ui/Button';
import EmptyState from '../components/ui/EmptyState';
import Modal from '../components/ui/Modal';
import Notice from '../components/ui/Notice';
import PageHeader from '../components/ui/PageHeader';
import Panel from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { inputCls } from '../components/ui/styles';
import { admin } from '../api/client';
import type { AdminAccount, AdminSite, HealthStatus, RangeKey, Site } from '../api/client';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { notify } from '../lib/notify';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const day = (iso: string) => dateFmt.format(new Date(iso));

const HEALTH: Record<HealthStatus, { tone: BadgeTone; label: string }> = {
  healthy: { tone: 'emerald', label: 'Sending data' },
  quiet: { tone: 'neutral', label: 'No visitors' },
  broken: { tone: 'rose', label: 'Not sending data' },
  unknown: { tone: 'neutral', label: 'Not checked yet' },
  paused: { tone: 'amber', label: 'Paused' },
};

/** Super admin: one account, its people and sites; delete the account or a site, download a site's report. */
export default function AdminAccountPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminSite | null>(null);
  const [siteBusy, setSiteBusy] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);
  const [askAccount, setAskAccount] = useState(false);
  useDocumentTitle(account?.owner?.email ?? 'Account');

  const load = useCallback(() => admin.account(id).then((r) => setAccount(r.account), (e: Error) => setError(e.message)), [id]);
  useEffect(() => {
    setAccount(null);
    setError(null);
    void load();
  }, [load]);

  const deleteSite = async (eraseData: boolean) => {
    if (!deleting) return;
    setSiteBusy(true);
    setSiteError(null);
    try {
      await admin.deleteSite(deleting.id, eraseData);
      notify.success(eraseData ? `${deleting.domain} and its data are being deleted.` : `${deleting.domain} was deleted. Its data is kept for its retention.`);
      setDeleting(null);
      await load();
    } catch (e) {
      setSiteError(e instanceof Error ? e.message : 'Could not delete the site.');
    } finally {
      setSiteBusy(false);
    }
  };

  const back = (
    <Link to="/admin" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
      <ArrowLeft className="size-4" aria-hidden="true" /> All accounts
    </Link>
  );

  if (error && !account) {
    return (
      <div className="grid gap-6">
        {back}
        <Notice tone="error">{error}</Notice>
      </div>
    );
  }
  if (!account) {
    return (
      <div className="grid gap-6">
        {back}
        <SkeletonRows rows={6} />
      </div>
    );
  }

  const a = account;
  const live = a.siteList.filter((s) => s.status !== 'deleted');
  const gone = a.siteList.filter((s) => s.status === 'deleted');

  return (
    <div className="grid gap-6" data-testid="admin-account">
      {back}
      <PageHeader
        title={a.owner?.name ?? a.owner?.email ?? 'Account'}
        description={
          <>
            {a.owner?.email} · since {day(a.createdAt)} · {a.plan} plan · region {a.region}
          </>
        }
      />
      {a.kvIssues.length > 0 && (
        <Notice tone="warning">
          {a.kvIssues.map((k) => k.domain).join(', ')}: changes have not reached Cloudflare yet ({a.kvIssues[0]!.error}). The nightly reconcile retries them.
        </Notice>
      )}

      <Panel flush title="Sites" subtitle={`${live.length} active or paused${gone.length ? `, ${gone.length} deleted` : ''}`}>
        {a.siteList.length === 0 ? (
          <EmptyState icon={Globe} title="No sites" compact>
            This account has not added a site.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {[...live, ...gone].map((s) => (
              <SiteRow key={s.id} site={s} onDelete={() => (setSiteError(null), setDeleting(s))} />
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="People" subtitle="Who can sign in to this account">
          <ul className="grid gap-3">
            {a.people.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{p.name ?? p.email}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {p.email} · joined {day(p.createdAt)}
                  </p>
                </div>
                <div className="flex flex-none gap-1.5">
                  <Badge tone="teal">{p.role}</Badge>
                  {!p.verified && <Badge tone="amber">E-mail not confirmed</Badge>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Recent activity" subtitle="The account's own activity log, newest first">
          {a.activity.length === 0 ? (
            <EmptyState icon={History} title="Nothing yet" compact />
          ) : (
            <ul className="grid max-h-80 gap-3 overflow-y-auto pr-1">
              {a.activity.map((e) => (
                <li key={e.id} className="text-sm">
                  <p className="text-slate-800 dark:text-slate-200">{e.summary}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {e.who} · {timeFmt.format(new Date(e.at))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel tone="danger" title="Delete this account" subtitle="Removes the login, the workspace and every site, and erases all collected data">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-sm text-slate-600 dark:text-slate-400">
            The same as the owner deleting it in Settings. Tracking stops at once, the owner is e-mailed that the TailWatch team deleted the account, and the data is erased within 3 days.
          </p>
          <Button variant="danger" size="sm" className="h-10" onClick={() => setAskAccount(true)}>
            <Trash2 className="size-4" aria-hidden="true" /> Delete account…
          </Button>
        </div>
      </Panel>

      {deleting && (
        <DeleteSiteDialog
          site={{ domain: deleting.domain, retentionDays: deleting.retentionDays } as Site}
          role="owner"
          busy={siteBusy}
          error={siteError}
          onCancel={() => setDeleting(null)}
          onConfirm={deleteSite}
        />
      )}
      {askAccount && (
        <DeleteAccountDialog
          email={a.owner?.email ?? a.id}
          onCancel={() => setAskAccount(false)}
          onConfirm={async () => {
            await admin.deleteAccount(a.id);
            notify.success(`The account of ${a.owner?.email ?? a.id} was deleted.`);
            navigate('/admin');
          }}
        />
      )}
    </div>
  );
}

/** One site: health, keys, a report for a period, delete. */
function SiteRow({ site, onDelete }: { site: AdminSite; onDelete: () => void }) {
  const [range, setRange] = useState<RangeKey>('30d');
  const [busy, setBusy] = useState(false);
  const deleted = site.status === 'deleted';
  const health = site.health ? HEALTH[site.health.status] : null;

  const download = async () => {
    setBusy(true);
    try {
      await admin.downloadReport(site.id, range);
    } catch (e) {
      notify.error(e, 'Could not download the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6" data-site={site.domain}>
      <div className="min-w-[220px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={`font-mono text-[13px] font-medium ${deleted ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white'}`}>{site.domain}</p>
          {deleted ? <Badge>Deleted</Badge> : health && <Badge tone={health.tone}>{health.label}</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          #{site.id} · {site.timezone} · keeps {site.retentionDays} days · added {day(site.createdAt)} · {site.keys.filter((k) => k.status === 'active').length} active key
          {site.keys.filter((k) => k.status === 'active').length === 1 ? '' : 's'}
        </p>
        {site.health?.status === 'broken' && site.health.reason && <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{site.health.reason}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <select
            aria-label={`Report period for ${site.domain}`}
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKey)}
            className="h-9 cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white pr-8 pl-3 text-sm text-slate-700 transition hover:border-slate-300 focus:ring-4 focus:ring-teal-600/20 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        </div>
        <Button variant="secondary" size="sm" className="h-9" onClick={download} loading={busy}>
          {!busy && <Download className="size-4" aria-hidden="true" />} Report
        </Button>
        <Button variant="secondary" size="sm" className="h-9 text-rose-700 dark:text-rose-300" onClick={onDelete}>
          <Trash2 className="size-4" aria-hidden="true" /> {deleted ? 'Erase data' : 'Delete'}
        </Button>
      </div>
    </li>
  );
}

/** "Delete this account?": typing DELETE, as the owner does in Settings. */
function DeleteAccountDialog({ email, onCancel, onConfirm }: { email: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the account.');
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Delete the account of ${email}?`}
      onClose={onCancel}
      locked={busy}
      footer={
        <>
          <Button variant="secondary" size="sm" className="h-10 px-4" onClick={onCancel} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" size="sm" className="h-10 px-4" onClick={run} loading={busy} disabled={typed !== 'DELETE'}>
            {busy ? 'Deleting…' : 'Delete account'}
          </Button>
        </>
      }
    >
      <p>Every site stops counting at once, and everything stored for this account is deleted. This cannot be undone.</p>
      <label className="mt-4 grid gap-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Type <b className="font-mono text-[13px]">DELETE</b> to confirm
        </span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} className={inputCls} disabled={busy} />
      </label>
      {error && (
        <Notice tone="error" className="mt-4">
          {error}
        </Notice>
      )}
    </Modal>
  );
}

