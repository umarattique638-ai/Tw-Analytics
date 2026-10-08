import { useNavigate } from 'react-router-dom';
import { Code, ShieldCheck } from 'lucide-react';
import Button from '../ui/Button';
import { muted } from '../ui/styles';
import type { Site } from '../../api/client';

/** A site exists but has not received its first pageview yet: send the user back into setup. */
export default function FinishSetup({ site }: { site: Site }) {
  const navigate = useNavigate();
  return (
    <div className="my-auto px-4">
      <div className="mx-auto w-full max-w-[760px]">
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
          <span className="size-1.5 animate-pulse rounded-full bg-amber-500" /> Waiting for the first pageview
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 dark:text-white">Finish setting up {site.domain}</h1>
        <p className={`mt-3 max-w-xl text-base leading-relaxed ${muted}`}>
          Your site is registered. Add the snippet to your pages, then verify: the dashboard opens as soon as the first pageview arrives.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button onClick={() => navigate('/install')} className="gap-2"><Code className="size-4" /> Get the snippet</Button>
          <Button variant="ghost" onClick={() => navigate('/verify')} className="gap-2"><ShieldCheck className="size-4" /> Verify the install</Button>
          <Button variant="ghost" onClick={() => navigate('/dashboard', { state: { preview: true } })}>Preview a demo dashboard</Button>
        </div>
      </div>
    </div>
  );
}
