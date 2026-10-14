import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import Button from '../components/ui/Button';
import FormError from '../components/ui/FormError';
import PageHeader from '../components/ui/PageHeader';
import CancelSetup from '../components/onboarding/CancelSetup';
import CheckList from '../components/onboarding/CheckList';
import VerifyProgress from '../components/onboarding/VerifyProgress';
import { inputCls, muted } from '../components/ui/styles';
import { textLinkCls } from '../components/ui/TextLink';
import { useInstallCheck } from '../hooks/useInstallCheck';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';
import { notify } from '../lib/notify';

/**
 * Setup step 3: the server checks the page step by step. When every step passes the site is saved
 * (decision 25) and the dashboard opens by itself; there is no waiting for a first pageview.
 */
export default function VerifyPage() {
  useDocumentTitle('Check the install');
  const navigate = useNavigate();
  const { setup, setSetup, upsert, select } = useSession();
  // Kept after the site is saved (the setup is gone then), until the dashboard opens.
  const [held, setHeld] = useState(setup);
  useEffect(() => {
    if (setup) setHeld(setup);
  }, [setup]);
  const check = useInstallCheck(held, (site) => {
    upsert(site);
    select(site.id);
    setSetup(null);
    notify.success(`${site.domain} added`, { description: 'Every check passed. Visits show up on your dashboard from now on.' });
    navigate('/dashboard', { replace: true });
  });
  const [otherPage, setOtherPage] = useState(false);

  if (!held) return <Navigate to="/sites/new" replace />;

  const { steps, allGood, failed, running } = check;
  const label = allGood
    ? 'All checks passed: opening your dashboard…'
    : running
      ? 'Checking your site…'
      : failed
        ? `Stopped at step ${check.stoppedAt} of ${check.total}: fix it, then check again`
        : `${check.done} of ${check.total} checks done`;

  return (
    <>
      <PageHeader
        compact
        title="Check the install"
        description={
          <>
            We open <b className="text-slate-700 dark:text-slate-200">{held.domain}</b> like a visitor would, step by step, and stop at the first problem. Our own visits never count in your stats.
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
          Nothing is saved until every step is green; then your site joins the dashboard by itself. Fix the first red step, publish the change, then check again.{' '}
          {!otherPage && !failed && (
            <button type="button" onClick={() => setOtherPage(true)} className={`${textLinkCls} !font-medium`}>
              Check a different page
            </button>
          )}
        </p>
      )}

      {!allGood && (
        <div className="mt-6 flex flex-wrap gap-2.5 border-t border-slate-100 pt-5 dark:border-slate-800">
          <Button variant="secondary" onClick={() => navigate('/install')}>
            Back to the script
          </Button>
          <span className="ml-auto">
            <CancelSetup domain={held.domain} />
          </span>
        </div>
      )}
    </>
  );
}
