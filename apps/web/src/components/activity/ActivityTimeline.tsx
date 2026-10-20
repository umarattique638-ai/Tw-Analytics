import { ArrowRightLeft, Clock3, TrendingUp, Download, FileText, Globe, History, KeyRound, LogIn, LogOut, Pause, Play, PlugZap, ShieldAlert, Trash2, Unplug, UserPlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AuditEntry } from '../../api/client';

type Tone = 'teal' | 'amber' | 'rose' | 'slate';

/** Icon and colour per kind of action. Red = something to look at (failed sign-in, deletions). */
const LOOK: Record<string, { icon: LucideIcon; tone: Tone }> = {
  'account.created': { icon: UserPlus, tone: 'teal' },
  'auth.login': { icon: LogIn, tone: 'slate' },
  'auth.logout': { icon: LogOut, tone: 'slate' },
  'auth.login_failed': { icon: ShieldAlert, tone: 'rose' },
  'auth.password_reset': { icon: KeyRound, tone: 'amber' },
  'site.created': { icon: Globe, tone: 'teal' },
  'site.restored': { icon: Globe, tone: 'teal' },
  'site.paused': { icon: Pause, tone: 'amber' },
  'site.resumed': { icon: Play, tone: 'teal' },
  'site.domain_changed': { icon: ArrowRightLeft, tone: 'amber' },
  'site.timezone_changed': { icon: Clock3, tone: 'slate' },
  'site.retention_changed': { icon: Clock3, tone: 'amber' },
  'site.deleted': { icon: Trash2, tone: 'rose' },
  'site.stopped_sending': { icon: Unplug, tone: 'rose' },
  'site.sending_again': { icon: PlugZap, tone: 'teal' },
  'site.traffic_spike': { icon: TrendingUp, tone: 'amber' },
  'key.created': { icon: KeyRound, tone: 'teal' },
  'key.revoked': { icon: KeyRound, tone: 'rose' },
  'host.allowed': { icon: Globe, tone: 'slate' },
  'report.created': { icon: FileText, tone: 'slate' },
  'report.deleted': { icon: FileText, tone: 'slate' },
  'account.exported': { icon: Download, tone: 'slate' },
  'data.pruned': { icon: Trash2, tone: 'slate' },
  'support.report_downloaded': { icon: Download, tone: 'amber' },
};
const TONES: Record<Tone, string> = {
  teal: 'bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const who = (e: AuditEntry) => (e.actor.kind === 'system' ? 'TailWatch (automatic)' : e.actor.you ? 'You' : e.actor.name);

/** The log, one section per day. */
export default function ActivityTimeline({ days }: { days: { key: string; label: string; items: AuditEntry[] }[] }) {
  return (
    <div className="grid gap-7" data-testid="activity-list">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h3 className="mb-2 flex items-center gap-3 text-xs font-medium text-slate-500 dark:text-slate-400">
            {day.label}
            <span className="h-px flex-1 bg-slate-100 dark:bg-slate-800" aria-hidden="true" />
          </h3>
          <ol className="grid gap-0.5">
            {day.items.map((e) => {
              const look = LOOK[e.action] ?? { icon: History, tone: 'slate' as Tone };
              const Icon = look.icon;
              return (
                <li key={e.id} className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <span className={`grid size-8 flex-none place-items-center rounded-lg ${TONES[look.tone]}`}>
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm break-words text-slate-800 dark:text-slate-100">{e.summary}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {who(e)}
                      {e.domain && !e.summary.includes(e.domain) ? ` · ${e.domain}` : ''}
                    </p>
                  </div>
                  <time dateTime={e.at} className="flex-none pt-0.5 text-xs whitespace-nowrap text-slate-500 tabular-nums dark:text-slate-400">
                    {timeFmt.format(new Date(e.at))}
                  </time>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
