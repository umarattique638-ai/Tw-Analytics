import { Outlet } from 'react-router-dom';
import { Clock, Lock, ShieldCheck } from 'lucide-react';
import Stepper from './Stepper';
import { muted } from '../ui/styles';

const tips = [
  { icon: Clock, title: 'About 2 minutes', desc: 'Add your domain, paste one snippet, and you are done.' },
  { icon: Lock, title: 'Privacy-first', desc: 'No IP addresses stored. Bots and spam are filtered out.' },
  { icon: ShieldCheck, title: 'We never touch DNS', desc: 'Nothing changes on your hosting or your domain.' },
];

export default function SetupLayout() {
  return (
    <div className="mx-auto grid w-full max-w-[1080px] gap-8 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
      <div className="mx-auto w-full max-w-[720px]">
        <Stepper />
        <div className="mt-8 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-20px_rgba(15,23,42,0.16)] sm:p-10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
          <Outlet />
        </div>
      </div>

      <aside className="hidden xl:block xl:pt-[92px]">
        <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-6 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">Good to know</p>
          <ul className="mt-5 grid gap-5">
            {tips.map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex gap-3">
                <span className="grid size-9 flex-none place-items-center rounded-lg bg-teal-50 text-teal-700 dark:bg-teal-400/10 dark:text-teal-300">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
                  <p className={`mt-0.5 text-[13px] leading-relaxed ${muted}`}>{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}