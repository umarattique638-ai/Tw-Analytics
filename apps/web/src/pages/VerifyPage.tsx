import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import CheckList from '../components/onboarding/CheckList';
import { inputCls, muted } from '../components/ui/styles';
import { api } from '../api/client';
import type { Status, VerifyResult } from '../api/client';
import { useSession } from '../api/session';

const POLL_MS = 3000;

const DROP_TEXT: Record<string, string> = {
  hostname: 'Hits arrive from a host that is not one of this site\'s hosts',
  bot: 'Hits look like a bot and are filtered',
  verification_agent: 'Install checks (never counted)',
  gpc: 'Visitors with Global Privacy Control on (respected, not counted)',
  identity_unavailable: 'Hits could not be attributed',
  referrer_spam: 'Hits from referrer-spam domains (filtered)',
  consumer_invalid: 'Hits that could not be read',
};

export default function VerifyPage() {
  const navigate = useNavigate();
  const { current, upsert } = useSession();
  const [status, setStatus] = useState<Status | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [url, setUrl] = useState(current ? `https://${current.domain}/` : '');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Passive check: "waiting for your first pageview" until one arrives (BUILD-ORDER ④/⑤).
  useEffect(() => {
    if (!current) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await api.status(current.id);
        if (!live) return;
        setStatus(s);
        setPollError(null);
        if (s.verifiedAt && !current.verifiedAt) upsert({ ...current, verifiedAt: s.verifiedAt });
        if (s.pageviews > 0) return; // got it: stop polling
      } catch (e) {
        if (live) setPollError(e instanceof Error ? e.message : 'Status unavailable.');
      }
      if (live) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) return <Navigate to="/sites/new" replace />;

  const run = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    setCheckError(null);
    try {
      setResult(await api.verify(current.id, url));
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'The check could not run.');
    } finally {
      setRunning(false);
    }
  };

  const received = status && status.pageviews > 0 && status.last;

  return (
    <>
      <PageHeader
        title="Check the install"
        sub={<>Open <b>{current.domain}</b> in a new tab, then run the check. Verifier visits never count in your stats.</>}
      />

      {received ? (
        <div data-testid="first-pageview" className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
          <span className="grid size-6 place-items-center rounded-full bg-emerald-600 text-sm text-white">✓</span>
          <span>
            <b>First pageview received</b> on <code className="font-mono">{status.last!.path}</code> at{' '}
            {new Date(status.last!.at).toLocaleTimeString()}. Your site is live.
          </span>
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-dashed border-slate-300 p-4 dark:border-slate-700">
          <span className="size-3 animate-pulse rounded-full bg-teal-700 motion-reduce:animate-none dark:bg-teal-400" />
          {pollError ?? 'Waiting for your first pageview…'}
        </div>
      )}

      {status && status.drops.length > 0 && (
        <ul className="mb-4 grid gap-2">
          {status.drops.map((d) => (
            <li key={d.reason} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
              <b>{d.hits} hit{d.hits === 1 ? '' : 's'} dropped:</b> {DROP_TEXT[d.reason] ?? d.reason}
              {d.detail ? <span className="font-mono"> ({d.detail})</span> : null}. Allowed hosts: {current.allowedHosts.join(', ')}.
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={run} className="mb-4 flex flex-wrap items-end gap-2.5">
        <label className="grid min-w-0 flex-1 gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Page to check</span>
          <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
        </label>
        <Button type="submit" loading={running}>Run check</Button>
      </form>

      <FormError message={checkError} />
      {result ? (
        <>
          <CheckList items={result.checks} />
          {result.ok && <p className={`mt-3 text-sm ${muted}`}>Everything looks right on {new URL(result.url).hostname}.</p>}
        </>
      ) : (
        <p className={`text-sm ${muted}`}>
          The check opens your page like a visitor would and tells you exactly what is wrong: unreachable site, missing or duplicated
          snippet, wrong key, a blocked script. npm and framework installs have no script tag: for those, the first pageview above is the proof.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2.5">
        <Button variant={received ? 'primary' : 'ghost'} onClick={() => navigate('/dashboard')}>
          Finish and go to dashboard
        </Button>
        <Button variant="ghost" onClick={() => navigate('/install')}>Back to the snippet</Button>
      </div>
    </>
  );
}
