import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock3, Download, FileText, Globe, KeyRound, LogIn, Pause, Play, RefreshCw, ShieldAlert, Trash2, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PageHead from '../components/dashboard/PageHead';
import Panel from '../components/dashboard/Panel';
import { account } from '../api/client';
import type { AuditEntry } from '../api/client';
import { useSession } from '../api/session';

/** Icon and colour per kind of action. Red = something to look at (failed sign-in, deletions). */
const LOOK: Record<string, { icon: LucideIcon; tone: string }> = {
  'account.created': { icon: UserPlus, tone: 'teal' },
  'auth.login': { icon: LogIn, tone: 'slate' },
  'auth.logout': { icon: LogIn, tone: 'slate' },
  'auth.login_failed': { icon: ShieldAlert, tone: 'rose' },
  'auth.password_reset': { icon: KeyRound, tone: 'amber' },
  'site.created': { icon: Globe, tone: 'teal' },
  'site.restored': { icon: Globe, tone: 'teal' },
  'site.paused': { icon: Pause, tone: 'amber' },
  'site.resumed': { icon: Play, tone: 'teal' },
  'site.timezone_changed': { icon: Clock3, tone: 'slate' },
  'site.retention_changed': { icon: Clock3, tone: 'amber' },
  'site.deleted': { icon: Trash2, tone: 'rose' },
  'key.created': { icon: KeyRound, tone: 'teal' },
  'key.revoked': { icon: KeyRound, tone: 'rose' },
  'host.allowed': { icon: Globe, tone: 'slate' },
  'report.created': { icon: FileText, tone: 'slate' },
  'report.deleted': { icon: FileText, tone: 'slate' },
  'account.exported': { icon: Download, tone: 'slate' },
  'data.pruned': { icon: Trash2, tone: 'slate' },
};
const TONES: Record<string, string> = {
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export default function ActivityPage() {
  const { sites } = useSession();
  const [site, setSite] = useState<number | null>(null);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [keepDays, setKeepDays] = useState(400);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Only the newest request may update the list (a slow answer for the previous filter is dropped). */
  const latest = useRef(0);

  const load = useCallback(
    async (before: string | null) => {
      const ticket = ++latest.current;
      setBusy(true);
      setError(null);
      try {
        const r = await account.activity({ before, site });
        if (ticket !== latest.current) return;
        setEntries((list) => (before ? [...(list ?? []), ...r.entries] : r.entries));
        setNext(r.next);
        setKeepDays(r.keepDays);
      } catch (e) {
        if (ticket === latest.current) setError(e instanceof Error ? e.message : 'Could not load the activity log.');
      } finally {
        if (ticket === latest.current) setBusy(false);
      }
    },
    [site],
  );

  useEffect(() => {
    setEntries(null);
    load(null);
  }, [load]);

  // Group by local day, newest first (the API already sorts).
  const days: { key: string; label: string; items: AuditEntry[] }[] = [];
  for (const e of entries ?? []) {
    const key = dayKey(e.at);
    const last = days[days.length - 1];
    if (last && last.key === key) last.items.push(e);
    else days.push({ key, label: dayFmt.format(new Date(e.at)), items: [e] });
  }

  return (
    <div className="grid gap-6">
      <PageHead title="Activity" sub={`Who changed what, and when. Kept for ${keepDays} days; no IP addresses are stored.`} />
      <Panel
        title="Activity log"
        subtitle="Sign-ins, site and key changes, reports, and what the nightly jobs did"
        action={
          <div className="flex items-center gap-2">
            <select
              aria-label="Filter by site"
              value={site ?? ''}
              onChange={(e) => setSite(e.target.value ? Number(e.target.value) : null)}
              className="h-9 max-w-[180px] rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700 focus:outline-none focus:ring-4 focus:ring-teal-600/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="">All activity</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.domain}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => load(null)}
              title="Refresh"
              aria-label="Refresh"
              className="grid size-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      >
        {error && (
          <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
            {error}
          </p>
        )}
        {entries === null ? (
          <div className="grid gap-3" aria-label="Loading">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">Nothing here yet.</p>
        ) : (
          <div className="grid gap-6" data-testid="activity-list">
            {days.map((day) => (
              <section key={day.key}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{day.label}</h3>
                <ol className="grid gap-1">
                  {day.items.map((e) => {
                    const look = LOOK[e.action] ?? { icon: FileText, tone: 'slate' };
                    const Icon = look.icon;
                    return (
                      <li key={e.id} className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <span className={`grid size-8 flex-none place-items-center rounded-lg ${TONES[look.tone]}`}>
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm text-slate-800 dark:text-slate-100">{e.summary}</p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {e.actor.kind === 'system' ? 'TailWatch (automatic)' : e.actor.you ? 'You' : e.actor.name}
                            {e.domain && !e.summary.includes(e.domain) ? ` · ${e.domain}` : ''}
                          </p>
                        </div>
                        <time dateTime={e.at} className="flex-none whitespace-nowrap pt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                          {timeFmt.format(new Date(e.at))}
                        </time>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
            {next && (
              <button
                type="button"
                onClick={() => load(next)}
                disabled={busy}
                className="mx-auto h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {busy ? 'Loading…' : 'Show older'}
              </button>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
