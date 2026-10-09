import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ExternalLink, PartyPopper, RotateCw } from 'lucide-react';
import Button from '../components/ui/Button';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import CheckList from '../components/onboarding/CheckList';
import type { Step } from '../components/onboarding/CheckList';
import { inputCls, muted } from '../components/ui/styles';
import { api } from '../api/client';
import type { Status, VerifyResult } from '../api/client';
import { useSession } from '../api/session';

const POLL_MS = 3000;
/** Pause between two steps turning green: quick, but slow enough to follow. */
const STEP_MS = 380;
const REDIRECT_SECONDS = 3;

/** The verifier's steps, in the order the server runs them (apps/api/src/verifier.ts). */
const CHECKS: { id: string; label: string }[] = [
  { id: 'reach', label: 'Site reachable' },
  { id: 'present', label: 'Snippet in page source' },
  { id: 'noscript', label: 'Not in noscript or a comment' },
  { id: 'once', label: 'Only one snippet' },
  { id: 'id', label: 'Site key matches' },
  { id: 'script', label: 'Script loads' },
  { id: 'csp', label: 'Content-Security-Policy allows it' },
];

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
  const [shown, setShown] = useState(0); // how many results are revealed so far
  const [checkError, setCheckError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [stay, setStay] = useState(false);
  const started = useRef(false);

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

  const run = useCallback(
    async (target: string) => {
      if (!current) return;
      setRunning(true);
      setCheckError(null);
      setResult(null);
      setShown(0);
      setCountdown(null);
      try {
        setResult(await api.verify(current.id, target));
      } catch (err) {
        setCheckError(err instanceof Error ? err.message : 'The check could not run.');
      } finally {
        setRunning(false);
      }
    },
    [current],
  );

  // The check starts by itself when the page opens.
  useEffect(() => {
    if (started.current || !current) return;
    started.current = true;
    run(`https://${current.domain}/`);
  }, [current, run]);

  // Reveal the results one by one.
  useEffect(() => {
    if (!result || shown >= result.checks.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 150 : STEP_MS);
    return () => clearTimeout(t);
  }, [result, shown]);

  const revealed = !!result && shown >= result.checks.length;
  const received = !!status && status.pageviews > 0 && !!status.last;
  // npm / framework installs have no script tag: there the first pageview is the proof.
  const noTagOnly = !!result && result.checks.find((c) => c.id === 'present')?.status === 'fail';
  const allGood = revealed && received && (result!.ok || noTagOnly);

  // Everything passed: count down, then on to the dashboard.
  useEffect(() => {
    if (!allGood || stay) return;
    setCountdown((c) => (c === null ? REDIRECT_SECONDS : c));
  }, [allGood, stay]);
  useEffect(() => {
    if (countdown === null || stay) return;
    if (countdown <= 0) {
      navigate('/dashboard', { replace: true });
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown, stay, navigate]);

  if (!current) return <Navigate to="/sites/new" replace />;

  const steps: Step[] = CHECKS.map((c, i) => {
    const r = result?.checks.find((x) => x.id === c.id);
    if (r && i < shown) return { id: c.id, label: r.label, state: r.status, message: r.message };
    const isNext = (running && i === 0) || (!!result && i === shown);
    return { id: c.id, label: c.label, state: isNext ? 'running' : 'waiting' };
  });
  steps.push(
    received
      ? {
          id: 'pageview',
          label: 'First pageview received',
          state: revealed || !result ? 'pass' : 'waiting',
          message: `On ${status!.last!.path} at ${new Date(status!.last!.at).toLocaleTimeString()}. Your site is live.`,
        }
      : {
          id: 'pageview',
          label: 'Waiting for your first pageview',
          state: revealed ? 'running' : 'waiting',
          message: revealed ? (pollError ?? 'Open your site in a new tab: the first visit shows up here within a minute.') : undefined,
        },
  );

  const done = steps.filter((s) => s.state === 'pass' || s.state === 'fail' || s.state === 'skip').length;
  const failed = revealed && !result!.ok && !(noTagOnly && received);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(url);
  };

  return (
    <>
      <PageHeader
        title="Check the install"
        sub={<>We open <b>{current.domain}</b> like a visitor would and check every step. Verifier visits never count in your stats.</>}
      />

      {/* progress */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
          <span>{allGood ? 'All checks passed' : running ? 'Checking your site…' : failed ? 'Something needs fixing' : `${done} of ${steps.length} checks done`}</span>
          <span className="tabular-nums">{Math.round((done / steps.length) * 100)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${failed ? 'bg-red-500' : 'bg-gradient-to-r from-teal-500 to-emerald-500'}`}
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
      </div>

      <CheckList steps={steps} />

      <FormError message={checkError} />

      {allGood && (
        <div
          data-testid="all-good"
          className="mt-6 flex animate-[tw-rise_300ms_ease-out] flex-wrap items-center gap-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100"
        >
          <span className="grid size-10 flex-none place-items-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500">
            <PartyPopper className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">You're all set!</p>
            <p className="text-sm opacity-90">
              {stay ? 'Your dashboard is ready whenever you are.' : `Taking you to your dashboard in ${countdown ?? REDIRECT_SECONDS}…`}
            </p>
          </div>
          <div className="flex gap-2">
            {!stay && (
              <Button variant="ghost" className="h-10" onClick={() => setStay(true)}>
                Stay here
              </Button>
            )}
            <Button className="h-10" onClick={() => navigate('/dashboard', { replace: true })}>
              Go now
            </Button>
          </div>
        </div>
      )}

      {revealed && !received && !failed && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-sm text-teal-900 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-100">
          <span className="min-w-0 flex-1">The snippet is installed correctly. Visit your site once and this page finishes by itself.</span>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 font-semibold text-white transition hover:bg-teal-800 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            Open {current.domain} <ExternalLink className="size-4" />
          </a>
        </div>
      )}

      {status && status.drops.length > 0 && (
        <ul className="mt-4 grid gap-2">
          {status.drops.map((d) => (
            <li key={d.reason} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
              <b>{d.hits} hit{d.hits === 1 ? '' : 's'} dropped:</b> {DROP_TEXT[d.reason] ?? d.reason}
              {d.detail ? <span className="font-mono"> ({d.detail})</span> : null}. Allowed hosts: {current.allowedHosts.join(', ')}.
            </li>
          ))}
        </ul>
      )}

      {(failed || showUrl || checkError) && (
        <form onSubmit={submit} className="mt-6 flex flex-wrap items-end gap-2.5">
          <label className="grid min-w-0 flex-1 gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Page to check</span>
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
          </label>
          <Button type="submit" loading={running} className="gap-2">
            {!running && <RotateCw className="size-4" />} Check again
          </Button>
        </form>
      )}

      {!allGood && (
        <p className={`mt-4 text-[13px] ${muted}`}>
          npm and framework installs have no script tag: for those, the first pageview is the proof.{' '}
          {!showUrl && !failed && (
            <button type="button" onClick={() => setShowUrl(true)} className="font-medium text-teal-700 hover:underline dark:text-teal-400">
              Check a different page
            </button>
          )}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2.5 border-t border-slate-100 pt-5 dark:border-slate-800">
        <Button variant={received ? 'primary' : 'ghost'} onClick={() => navigate('/dashboard', { state: received ? undefined : { skipSetup: true } })}>
          {received ? 'Go to dashboard' : 'Skip for now'}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/install')}>Back to the snippet</Button>
      </div>
    </>
  );
}
