import { useState } from 'react';
import { BellRing, Download, FileSpreadsheet, KeyRound, Link2, Mail, ServerCog } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import PageHead from '../components/dashboard/PageHead';
import Panel from '../components/dashboard/Panel';
import Select from '../components/ui/Select';
import { stats } from '../api/client';
import type { RangeKey } from '../api/client';
import { useSession } from '../api/session';

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

/** Not built yet. Listed honestly instead of showing controls that do nothing. */
const NEXT: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Mail, title: 'Email digest', desc: 'A weekly or monthly summary in your inbox. Needs the e-mail service (with password reset).' },
  { icon: BellRing, title: 'Alerts', desc: 'Traffic spike, traffic drop (often a broken snippet) and capture rate below 85%.' },
  { icon: KeyRound, title: 'Stats API key', desc: 'Read your numbers from your own tools. The same API the dashboard uses, with a read-only key.' },
  { icon: Link2, title: 'Public dashboard link', desc: 'A read-only page anyone with the link can open. You can turn it off any time.' },
  { icon: ServerCog, title: 'Server log comparison', desc: 'What your server saw versus what the script recorded: bots, blocked scripts, beacon loss.' },
];

export default function ReportsPage() {
  const { current } = useSession();
  const [range, setRange] = useState<RangeKey>('30d');
  if (!current) return <p className="text-slate-500">Add a site first.</p>;

  return (
    <div className="grid gap-6">
      <PageHead title="Reports" sub="Take your numbers with you." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Export" subtitle="The same numbers as the Visitors over time chart">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
            <Select label="Date range" name="range" value={range} onChange={(v) => setRange(v as RangeKey)} options={RANGE_OPTIONS} />
            <a
              href={stats.exportUrl(current.id, range)}
              data-testid="export-csv"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-5 text-[15px] font-semibold text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              <Download className="size-4" /> Download CSV
            </a>
          </div>
          <p className="mt-4 flex gap-2 text-[13px] text-slate-500 dark:text-slate-400">
            <FileSpreadsheet className="size-4 flex-none" />
            One row per day ({current.timezone}), or per hour for Today: visitors, sessions, page views. Opens in Excel or Google Sheets.
          </p>
        </Panel>

        <Panel title="Coming next" subtitle="Not available yet">
          <ul className="grid gap-4">
            {NEXT.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex gap-3">
                <span className="grid size-9 flex-none place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><Icon className="size-4" /></span>
                <div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</p>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
