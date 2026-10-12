import { Activity, Eye, Radio, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import { SkeletonRows } from '../ui/Skeleton';
import { ago, countryName } from '../../lib/format';
import type { Live } from '../../api/client';

const look = (name: string): { icon: LucideIcon; cls: string } =>
  name === 'pageview'
    ? { icon: Eye, cls: 'bg-teal-50 text-teal-600 dark:bg-teal-400/10 dark:text-teal-300' }
    : name === 'engagement'
      ? { icon: Activity, cls: 'bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300' }
      : { icon: Sparkles, cls: 'bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300' };

/** The latest hits, newest first. */
export default function LiveEvents({ events }: { events: Live['events'] | null }) {
  if (!events) return <SkeletonRows rows={4} className="h-10" />;
  if (events.length === 0)
    return (
      <EmptyState compact icon={Radio} title="Quiet for now">
        No hits in the last 24 hours.
      </EmptyState>
    );
  return (
    <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto pr-1 dark:divide-slate-800" data-testid="live-events">
      {events.map((e, i) => {
        const { icon: Icon, cls } = look(e.name);
        return (
          <li key={`${e.at}-${i}`} className="flex items-center gap-3 py-2.5">
            <span className={`grid size-8 flex-none place-items-center rounded-full ${cls}`}>
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <p className="min-w-0 flex-1 truncate text-sm">
              <span className="font-medium text-slate-800 dark:text-slate-100">{e.name}</span> <span className="text-slate-500 dark:text-slate-400">{e.path}</span>
            </p>
            <span className="flex-none text-xs text-slate-500 dark:text-slate-400">
              {countryName(e.country)} · {ago(e.at)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
