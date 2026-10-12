import { ShieldCheck } from 'lucide-react';
import Badge from '../ui/Badge';
import type { BadgeTone } from '../ui/Badge';
import EmptyState from '../ui/EmptyState';
import Panel from '../ui/Panel';
import { ago, dropDetail, dropLabel, num } from '../../lib/format';

const tone: Record<string, BadgeTone> = { bot: 'rose', hostname: 'amber', verification_agent: 'neutral' };

/** Dropped hits by reason, from dropped_hits. Nothing is discarded silently (PLAN 6.5). */
export default function WarningsFeed({ items }: { items: { reason: string; hits: number; detail: string; last: number }[] }) {
  return (
    <Panel title="Warnings feed" subtitle="Hits we dropped, with the reason">
      {items.length === 0 ? (
        <EmptyState compact icon={ShieldCheck} title="Nothing dropped">
          No hits were filtered in this period.
        </EmptyState>
      ) : (
        <ul className="grid gap-3.5">
          {items.map((w) => (
            <li key={w.reason} className="flex gap-3 text-sm">
              <Badge tone={tone[w.reason] ?? 'violet'} className="h-fit min-w-[110px] justify-center">
                {dropLabel(w.reason)}
              </Badge>
              <div className="min-w-0">
                <span className="text-[13px] break-words text-slate-700 dark:text-slate-200" title={w.detail}>
                  {dropDetail(w.reason, w.detail) || '—'}
                </span>
                <small className="block text-xs text-slate-500 dark:text-slate-400">
                  {num(w.hits)} hits · last {ago(w.last)}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
