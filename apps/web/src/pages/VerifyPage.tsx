import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ExternalLink, PartyPopper, RotateCw } from 'lucide-react';
import Button from '../components/ui/Button';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import CheckList from '../components/onboarding/CheckList';
import VerifyProgress from '../components/onboarding/VerifyProgress';
import { inputCls, muted } from '../components/ui/styles';
import { textLinkCls } from '../components/ui/TextLink';
import { safePageUrl, useInstallCheck } from '../hooks/useInstallCheck';
import { useCountdown } from '../hooks/useCountdown';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';

const REDIRECT_SECONDS = 3;

/** Why the collector dropped hits from this site, in words (only the reasons that can happen while installing). */
const DROP_TEXT: Record<string, string> = {
  hostname: "Hits arrive from a host that is not one of this site's hosts",
  bot: 'Hits look like a bot and are filtered',
  verification_agent: 'Install checks (never counted)',
  gpc: 'Visitors with Global Privacy Control on (respected, not counted)',
  identity_unavailable: 'Hits could not be attributed',
  referrer_spam: 'Hits from referrer-spam domains (filtered)',
  consumer_invalid: 'Hits that could not be read',
};

/** Setup step 3: the server checks the page step by step; the site is verified when all pass and a first pageview arrived. */
export default function VerifyPage() {
  useDocumentTitle('Check the install');
  const navigate = useNavigate();
  const { current, upsert } = useSession();
  const check = useInstallCheck(current, upsert);
  const [stay, setStay] = useState(false);
  const [otherPage, setOtherPage] = useState(false);
  const left = useCountdown(REDIRECT_SECONDS, check.allGood && !stay, () => navigate('/dashboard', { replace: true }));

  if (!current) return <Navigate to="/sites/new" replace />;

  const { steps, allGood, failed, passed, running, received, status } = check;
  const label = allGood ? 'All checks passed' : running ? 'Checking your site…' : failed ? 'Something needs fixing' : `${check.done} of ${steps.length} checks done`;
  const openUrl = safePageUrl(check.url) ?? `https://${current.domain}/`;

  return (
    <>
      <PageHeader
        compact
        title="Check the install"
        description={
          <>
            We open <b className="text-slate-700 dark:text-slate-200">{current.domain}</b> like a visitor would, step by step, and stop at the first problem. Our own visits never count in your stats.
          </>
        }
      />

      <VerifyProgress label={label} progress={check.progress} failed={failed} />
      <CheckList steps={steps} />
      {check.checkError && (
        <div className="mt-4">
          <FormError message={check.checkError} />
        </div>
      )}

      {allGood && (
        <div
          data-testid="all-good"
          className="mt-6 flex animate-[tw-rise_300ms_ease-out] flex-wrap items-center gap-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100"
        >
          <span className="grid size-10 flex-none place-items-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500">
            <PartyPopper className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">You're all set!</p>
            <p className="text-sm opacity-90" role="status">
              {stay ? 'Your dashboard is ready whenever you are.' : `Taking you to your dashboard in ${left ?? REDIRECT_SECONDS}…`}
            </p>
          </div>
          <div className="flex gap-2">
            {!stay && (
              <Button variant="secondary" size="sm" className="h-10" onClick={() => setStay(true)}>
                Stay here
              </Button>
            )}
            <Button size="sm" className="h-10" onClick={() => navigate('/dashboard', { replace: true })}>
              Go now
            </Button>
          </div>
        </div>
      )}

      {passed && !received && (
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-teal-200 bg-teal-50/70 p-4 text-sm text-teal-900 dark:border-teal-400/30 dark:bg-teal-400/10 dark:text-teal-100">
          <span className="min-w-0 flex-1">The script is installed correctly. Visit your site once and this page finishes by itself.</span>
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 font-semibold text-white transition hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-600/30 dark:bg-teal-500 dark:text-slate-950 dark:hover:bg-teal-400"
          >
            Open {current.domain} <ExternalLink className="size-4" aria-hidden="true" />
          </a>
        </div>
      )}

      {status && status.drops.length > 0 && (
        <ul className="mt-4 grid gap-2">
          {status.drops.map((d) => (
            <li key={d.reason} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
              <b>
                {d.hits} hit{d.hits === 1 ? '' : 's'} dropped:
              </b>{' '}
              {DROP_TEXT[d.reason] ?? d.reason}
              {d.detail ? <span className="font-mono"> ({d.detail})</span> : null}. Accepted hosts: {current.allowedHosts.join(', ')}.
            </li>
          ))}
        </ul>
      )}

      {(failed || otherPage || check.checkError) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            check.run(check.url);
          }}
          className="mt-6 flex flex-wrap items-end gap-2.5"
        >
          <label className="grid min-w-0 flex-1 basis-64 gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Page to check</span>
            <input className={inputCls} value={check.url} onChange={(e) => check.setUrl(e.target.value)} spellCheck={false} inputMode="url" />
          </label>
          <Button type="submit" loading={running}>
            {!running && <RotateCw className="size-4" aria-hidden="true" />} Check again
          </Button>
        </form>
      )}

      {!allGood && (
        <p className={`mt-4 text-[13px] leading-relaxed ${muted}`}>
          Your dashboard opens when every step is green and the first visit has arrived. Fix the first red step, publish the change, then check again.{' '}
          {!otherPage && !failed && (
            <button type="button" onClick={() => setOtherPage(true)} className={`${textLinkCls} !font-medium`}>
              Check a different page
            </button>
          )}
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2.5 border-t border-slate-100 pt-5 dark:border-slate-800">
        {check.verified && <Button onClick={() => navigate('/dashboard')}>Go to dashboard</Button>}
        <Button variant={check.verified ? 'ghost' : 'secondary'} onClick={() => navigate('/install')}>
          Back to the script
        </Button>
      </div>
    </>
  );
}
