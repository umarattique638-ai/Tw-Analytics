import { Code, ShieldCheck } from 'lucide-react';
import CancelSetup from '../onboarding/CancelSetup';
import LinkButton from '../ui/LinkButton';
import { muted } from '../ui/styles';
import type { Setup } from '../../api/client';

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' });

/** A setup is in progress and no site is saved yet: send the user back into it. */
export default function FinishSetup({ setup }: { setup: Setup }) {
  return (
    <div className="my-auto px-1">
      <div className="mx-auto w-full max-w-[760px]">
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
          <span className="size-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden="true" /> Not verified yet
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight break-words text-slate-900 sm:text-4xl dark:text-white">Finish setting up {setup.domain}</h1>
        <p className={`mt-3 max-w-xl text-base leading-relaxed ${muted}`}>
          Nothing is saved for this site yet. Add the script to your pages, then verify: the site is saved and the dashboard opens once every check passes and the first pageview has arrived.
          This setup ends by itself on {dateFmt.format(new Date(setup.expiresAt))}.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <LinkButton to="/install">
            <Code className="size-4" aria-hidden="true" /> Get the script
          </LinkButton>
          <LinkButton to="/verify" variant="secondary">
            <ShieldCheck className="size-4" aria-hidden="true" /> Verify the install
          </LinkButton>
          <CancelSetup domain={setup.domain} />
        </div>
      </div>
    </div>
  );
}
