import { useState } from 'react';
import type { FormEvent } from 'react';
import { Copy, Download, KeyRound, Mail, Plus, X } from 'lucide-react';
import PageHead from '../components/dashboard/PageHead';
import Panel from '../components/dashboard/Panel';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import Toggle from '../components/ui/Toggle';
import { inputCls } from '../components/ui/styles';
import { reconciliation } from '../data/pagesMock';

const Row = ({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 py-3">
    <div className="min-w-0">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{title}</p>
      <p className="text-[13px] text-slate-500 dark:text-slate-400">{desc}</p>
    </div>
    {children}
  </div>
);

export default function ReportsPage() {
  const [digest, setDigest] = useState(true);
  const [freq, setFreq] = useState('Weekly');
  const [emails, setEmails] = useState(['you@company.com']);
  const [draft, setDraft] = useState('');
  const [spike, setSpike] = useState(true);
  const [drop, setDrop] = useState(true);
  const [capture, setCapture] = useState(false);
  const [spikePct, setSpikePct] = useState('+50%');
  const [dropPct, setDropPct] = useState('-40%');
  const [exportRange, setExportRange] = useState('Last 30 days');
  const [isPublic, setIsPublic] = useState(false);

  const addEmail = (e: FormEvent) => {
    e.preventDefault();
    const v = draft.trim();
    if (v && !emails.includes(v)) setEmails([...emails, v]);
    setDraft('');
  };

  return (
    <div className="grid gap-6">
      <PageHead title="Reports" sub="Digests, alerts, exports and sharing for your site." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Email digest" subtitle="A summary in your inbox">
          <Row title="Send a digest" desc="Visitors, top pages, sources and capture rate.">
            <Toggle checked={digest} onChange={setDigest} label="Send a digest" />
          </Row>
          <div className={`grid gap-4 border-t border-slate-100 pt-4 dark:border-slate-800 ${digest ? '' : 'pointer-events-none opacity-50'}`}>
            <Select label="How often" name="freq" value={freq} onChange={setFreq} options={['Weekly', 'Monthly']} />
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">Recipients</p>
              <div className="mb-2 flex flex-wrap gap-2">
                {emails.map((m) => (
                  <span key={m} className="flex items-center gap-1.5 rounded-full bg-slate-100 py-1 pl-3 pr-1.5 text-sm dark:bg-slate-800">
                    <Mail className="size-3.5 text-slate-400" />{m}
                    <button onClick={() => setEmails(emails.filter((x) => x !== m))} aria-label={`Remove ${m}`} className="grid size-5 cursor-pointer place-items-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"><X className="size-3" /></button>
                  </span>
                ))}
              </div>
              <form onSubmit={addEmail} className="flex gap-2">
                <input type="email" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an email" aria-label="Add recipient" className={inputCls} />
                <Button type="submit" variant="ghost" aria-label="Add recipient"><Plus className="size-4" /></Button>
              </form>
            </div>
            <Button variant="ghost" type="button" className="w-fit">Send a test email</Button>
          </div>
        </Panel>

        <Panel title="Alerts" subtitle="Get told when something changes">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            <Row title="Traffic spike" desc="Visitors jump compared with the last 7 days."><Toggle checked={spike} onChange={setSpike} label="Traffic spike" /></Row>
            {spike && <div className="py-3"><Select label="Alert when visitors are" name="spike" value={spikePct} onChange={setSpikePct} options={['+25%', '+50%', '+100%']} /></div>}
            <Row title="Traffic drop" desc="Visitors fall, which can mean a broken snippet."><Toggle checked={drop} onChange={setDrop} label="Traffic drop" /></Row>
            {drop && <div className="py-3"><Select label="Alert when visitors are" name="drop" value={dropPct} onChange={setDropPct} options={['-25%', '-40%', '-60%']} /></div>}
            <Row title="Capture rate below 85%" desc="We are missing more beacons than usual."><Toggle checked={capture} onChange={setCapture} label="Capture rate alert" /></Row>
          </div>
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-[13px] text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">Alerts go to your email and to the TailWatch mobile app as push notifications.</p>
        </Panel>

        <Panel title="Export and API" subtitle="Take your numbers with you">
          <div className="grid gap-4">
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
              <Select label="Date range" name="range" value={exportRange} onChange={setExportRange} options={['Last 7 days', 'Last 30 days', 'Last 90 days']} />
              <Button variant="ghost" type="button" className="gap-2"><Download className="size-4" />Download CSV</Button>
            </div>
            <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="mb-1.5 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"><KeyRound className="size-4 text-slate-400" />Stats API key</p>
              <div className="flex gap-2">
                <input readOnly value="tw_api_••••••••••••••••a1b2" aria-label="API key" className={`${inputCls} font-mono`} />
                <Button variant="ghost" type="button" aria-label="Copy key"><Copy className="size-4" /></Button>
              </div>
              <p className="mt-2 text-[13px] text-slate-500 dark:text-slate-400">Use it to read your stats from your own tools. Keep it secret.</p>
            </div>
          </div>
        </Panel>

        <Panel title="Share a public dashboard" subtitle="Anyone with the link can view">
          <Row title="Make dashboard public" desc="Read only. You can turn it off any time."><Toggle checked={isPublic} onChange={setIsPublic} label="Public dashboard" /></Row>
          <div className={`mt-2 flex gap-2 ${isPublic ? '' : 'pointer-events-none opacity-50'}`}>
            <input readOnly value="https://app.tailwatch.com/share/x7k2m9qa" aria-label="Public link" className={`${inputCls} font-mono text-[13px]`} />
            <Button variant="ghost" type="button" aria-label="Copy link"><Copy className="size-4" /></Button>
          </div>
        </Panel>
      </div>

      <Panel
        title="Where your traffic really goes"
        subtitle="Server logs compared with what the script recorded"
        action={<span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">Preview</span>}
      >
        <p className="text-[15px] text-slate-700 dark:text-slate-200">
          Your script recorded <b>{reconciliation.js.toLocaleString()}</b> humans. Your logs show <b>{reconciliation.requests.toLocaleString()}</b> requests. Here is the difference.
        </p>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full" role="img" aria-label="Breakdown of server log requests">
          {reconciliation.parts.map((p) => <div key={p.label} className={p.bar} style={{ width: `${(p.value / reconciliation.requests) * 100}%` }} />)}
        </div>
        <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-5">
          {reconciliation.parts.map((p) => (
            <li key={p.label} className="text-sm">
              <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400"><span className={`size-2 rounded-full ${p.bar}`} />{p.label}</span>
              <span className="font-semibold tabular-nums">{p.value.toLocaleString()}</span>
            </li>
          ))}
        </ul>
        <Button variant="ghost" type="button" className="mt-5">Connect server logs</Button>
      </Panel>
    </div>
  );
}