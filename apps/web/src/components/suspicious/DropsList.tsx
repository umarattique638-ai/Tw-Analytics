import { ShieldCheck, Undo2 } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { SkeletonRows } from '../ui/Skeleton';
import { ago, countryName, dropDetail, dropLabel, num } from '../../lib/format';
import type { DropsReport } from '../../api/client';
import { dropTone } from './dropTone';

type Row = DropsReport['rows'][number];

/** Each group of dropped hits, newest first. A wrong-hostname drop can be allowed from here. */
export default function DropsList({ rows, loading, isAllowed, busyHost, onAllow }: { rows: Row[]; loading: boolean; isAllowed: (h: string) => boolean; busyHost: string | null; onAllow: (h: string) => void }) {
  if (loading) return <SkeletonRows rows={4} />;
  if (rows.length === 0)
    return (
      <EmptyState compact icon={ShieldCheck} title="Nothing dropped">
        No hits were filtered in this period.
      </EmptyState>
    );
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="drops">
      {rows.map((d, i) => {
        const allowed = isAllowed(d.detail);
        return (
          <li key={`${d.reason}-${d.detail}-${d.country}-${d.asn}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
            <Badge tone={dropTone(d.reason).badge} className="w-36 flex-none justify-center py-1">
              {dropLabel(d.reason)}
            </Badge>
            <div className="min-w-0 flex-1 basis-56">
              <p className="truncate text-[13px] font-medium text-slate-800 dark:text-slate-100" title={d.detail}>
                {dropDetail(d.reason, d.detail) || '—'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-mono">{d.detail || '—'}</span> · {countryName(d.country)}
                {d.asn ? ` · AS${d.asn}` : ''} · {ago(d.last)}
              </p>
            </div>
            <span className="w-20 flex-none text-right text-sm font-semibold text-slate-900 tabular-nums dark:text-white">{num(d.hits)} hits</span>
            <span className="flex w-28 flex-none justify-end">
              {d.reason === 'hostname' && d.detail && (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-teal-700 dark:text-teal-400" onClick={() => onAllow(d.detail)} disabled={allowed} loading={busyHost === d.detail}>
                  {busyHost !== d.detail && <Undo2 className="size-3.5" aria-hidden="true" />}
                  {allowed ? 'Allowed' : 'Allow host'}
                </Button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
