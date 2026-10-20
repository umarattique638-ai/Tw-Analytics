import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, ChevronRight, Globe, Search, Trash2, Users } from 'lucide-react';
import KpiCard from '../components/dashboard/KpiCard';
import EmptyState from '../components/ui/EmptyState';
import Notice from '../components/ui/Notice';
import PageHeader from '../components/ui/PageHeader';
import Panel from '../components/ui/Panel';
import { SkeletonRows } from '../components/ui/Skeleton';
import { inputCls } from '../components/ui/styles';
import { admin } from '../api/client';
import type { AdminAccountRow, AdminOverview } from '../api/client';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { num } from '../lib/format';

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Super admin (owner, 2026-10-20): every TailWatch account. Only the TailWatch team sees this page. */
export default function AdminPage() {
  useDocumentTitle('All accounts');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [accounts, setAccounts] = useState<AdminAccountRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);

  useEffect(() => {
    admin.overview().then(setOverview, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    let live = true;
    setAccounts(null);
    admin.accounts(q).then(
      (r) => live && setAccounts(r.accounts),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [q]);

  const o = overview;
  return (
    <div className="grid gap-6" data-testid="admin">
      <PageHeader title="All accounts" description="Every TailWatch account, its people and its sites. Only the TailWatch team sees this page." />
      {error && <Notice tone="error">{error}</Notice>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Building2} label="Accounts" value={o ? num(o.accounts) : null} note={o ? `${num(o.users)} ${o.users === 1 ? 'person' : 'people'}` : undefined} />
        <KpiCard icon={Globe} label="Active sites" value={o ? num(o.sites.active) : null} note={o ? `${num(o.sites.paused)} paused, ${num(o.sites.deleted)} deleted` : undefined} />
        <KpiCard icon={AlertTriangle} label="Sites not sending data" value={o ? num(o.brokenSites) : null} note="The install check failed" />
        <KpiCard icon={Trash2} label="Erasures in progress" value={o ? num(o.pendingErasures) : null} note="Deleted accounts and sites" />
      </div>
      {o && o.kvIssues > 0 && (
        <Notice tone="warning">
          {num(o.kvIssues)} {o.kvIssues === 1 ? 'site has' : 'sites have'} changes that have not reached Cloudflare yet. The nightly reconcile retries them.
        </Notice>
      )}

      <Panel
        flush
        title="Accounts"
        subtitle="Newest first"
        action={
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="E-mail, name or domain" aria-label="Search accounts" className={`${inputCls} !h-10 w-64 pl-9 !text-sm`} />
          </div>
        }
      >
        {accounts === null ? (
          <div className="p-5 sm:p-6">
            <SkeletonRows rows={5} />
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState icon={Users} title={q ? 'No account matches' : 'No accounts yet'}>
            {q ? 'Try another e-mail, name or domain.' : 'Accounts appear here as soon as someone signs up.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="admin-accounts">
            {accounts.map((a) => (
              <li key={a.id}>
                <Link to={`/admin/accounts/${a.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50/70 focus-visible:bg-slate-50 focus-visible:outline-none sm:px-6 dark:hover:bg-slate-800/30">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900 dark:text-white">{a.owner?.name ?? a.owner?.email ?? 'No owner'}</p>
                    <p className="truncate text-sm text-slate-500 dark:text-slate-400">{a.owner?.email}</p>
                  </div>
                  <div className="hidden min-w-0 flex-[1.3] flex-wrap gap-1.5 md:flex">
                    {a.sites.length === 0 ? (
                      <span className="text-sm text-slate-400">No sites</span>
                    ) : (
                      a.sites.slice(0, 3).map((s) => (
                        <span key={s.id} className="max-w-[180px] truncate rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[12px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {s.domain}
                        </span>
                      ))
                    )}
                    {a.sites.length > 3 && <span className="text-xs text-slate-500">+{a.sites.length - 3} more</span>}
                  </div>
                  <span className="hidden w-28 text-right text-sm whitespace-nowrap text-slate-500 sm:block dark:text-slate-400">{dateFmt.format(new Date(a.createdAt))}</span>
                  <ChevronRight className="size-4 flex-none text-slate-400" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
