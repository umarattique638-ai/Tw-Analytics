import { Code, ShieldCheck } from 'lucide-react';
import LinkButton from '../ui/LinkButton';
import { muted } from '../ui/styles';
import type { Site } from '../../api/client';

/** A site exists but has not received its first pageview yet: send the user back into setup. */
export default function FinishSetup({ site }: { site: Site }) {
  return (
    <div className="my-auto px-1">
      <div className="mx-auto w-full max-w-[760px]">
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
          <span className="size-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden="true" /> Not verified yet
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight break-words text-slate-900 sm:text-4xl dark:text-white">Finish setting up {site.domain}</h1>
        <p className={`mt-3 max-w-xl text-base leading-relaxed ${muted}`}>
          Your site is registered. Add the script to your pages, then verify: the dashboard opens once every check passes and the first pageview has arrived.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <LinkButton to="/install">
            <Code className="size-4" aria-hidden="true" /> Get the script
          </LinkButton>
          <LinkButton to="/verify" variant="secondary">
            <ShieldCheck className="size-4" aria-hidden="true" /> Verify the install
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
