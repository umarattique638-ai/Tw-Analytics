import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Clock, Lock, ShieldCheck } from 'lucide-react';
import PageLoading from '../common/PageLoading';
import Stepper from './Stepper';
import { muted } from '../ui/styles';

const tips = [
  { icon: Clock, title: 'About 2 minutes', desc: 'Add your domain, paste one line, and you are done.' },
  { icon: Lock, title: 'Privacy-first', desc: 'No IP addresses stored. Bots and spam are filtered out.' },
  { icon: ShieldCheck, title: 'We never touch DNS', desc: 'Nothing changes on your hosting or your domain.' },
];

/** The three setup steps: progress on top, the step in a card, and a few reassurances beside it. */
export default function SetupLayout() {
  return (
    <div className="mx-auto grid w-full max-w-[1080px] gap-8 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
      <div className="mx-auto w-full max-w-[720px]">
        <Stepper />
        <div className="mt-8 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-20px_rgba(15,23,42,0.16)] sm:p-10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
          <Suspense fallback={<PageLoading />}>
            <Outlet />
          </Suspense>
        </div>
      </div>

      <aside className="hidden xl:block xl:pt-[92px]" aria-label="Good to know">
        <ul className="grid gap-5 rounded-2xl border border-slate-200/80 bg-white/70 p-6 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          {tips.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-9 flex-none place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
                <p className={`mt-0.5 text-[13px] leading-relaxed ${muted}`}>{desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
