import { ShieldCheck } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import Panel from '../ui/Panel';
import { dropLabel } from '../../lib/format';
import { dropTone } from './dropTone';

/** Share of the dropped hits per reason. */
export default function DropReasons({ reasons, total }: { reasons: [string, number][]; total: number }) {
  return (
    <Panel title="Why hits were dropped" subtitle="Share of all dropped hits">
      {reasons.length === 0 ? (
        <EmptyState compact icon={ShieldCheck} title="Nothing dropped">
          No hits were filtered in this period.
        </EmptyState>
      ) : (
        <ul className="grid gap-4">
          {reasons.map(([reason, hits]) => {
            const pct = (hits / total) * 100;
            return (
              <li key={reason}>
                <div className="mb-1.5 flex justify-between gap-3 text-sm">
                  <span className="text-slate-700 dark:text-slate-200">{dropLabel(reason)}</span>
                  <span className="font-semibold text-slate-900 tabular-nums dark:text-white">{Math.round(pct)}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
                  <div className={`h-full rounded-full ${dropTone(reason).bar}`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-5 border-t border-slate-100 pt-4 text-[13px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Dropped hits never count in your stats. Bots are recognised by the known-bot list, headless-browser checks, datacentre networks and the referrer-spam list. "Wrong hostname" means the
        script with this site's key ran on another website: give that website its own site in TailWatch.
      </p>
    </Panel>
  );
}
