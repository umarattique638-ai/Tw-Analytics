import { ArrowRight, Code, Globe, ShieldCheck } from 'lucide-react';
import LinkButton from '../ui/LinkButton';
import { muted } from '../ui/styles';

const steps = [
  { icon: Globe, title: 'Add your site', desc: 'Enter your domain and timezone. We never touch your DNS.' },
  { icon: Code, title: 'Install the script', desc: 'Copy one line and paste it inside the <head> of your site.' },
  { icon: ShieldCheck, title: 'Verify the install', desc: 'We check your page and wait for the first pageview.' },
];

const badges = ['No IP addresses stored', 'Bots filtered out', 'Ready in about 2 minutes'];

/** The first screen of a new account: no site yet. */
export default function GettingStarted() {
  return (
    <div className="my-auto px-1">
      <div className="mx-auto w-full max-w-[760px]">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">Let's set up your first site</h1>
        <p className={`mt-3 max-w-xl text-base leading-relaxed ${muted}`}>Three quick steps. Your dashboard fills in as soon as the first pageview arrives.</p>

        <ol className="mt-8 grid gap-3">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className={`flex items-center gap-4 rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${
                i === 0 ? 'border-teal-600/40 ring-4 ring-teal-600/10 dark:border-teal-400/40 dark:ring-teal-400/10' : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <span
                className={`grid size-11 flex-none place-items-center rounded-xl ${
                  i === 0 ? 'bg-teal-700 text-white dark:bg-teal-400 dark:text-slate-950' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                <s.icon className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-slate-900 dark:text-white">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </p>
                <p className={`mt-0.5 text-sm ${muted}`}>{s.desc}</p>
              </div>
              <span className="text-sm font-semibold text-slate-300 tabular-nums dark:text-slate-600" aria-hidden="true">
                {i + 1}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-7">
          <LinkButton to="/sites/new">
            Add your site <ArrowRight className="size-4" aria-hidden="true" />
          </LinkButton>
        </div>

        <ul className={`mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-6 text-[13px] dark:border-slate-800 ${muted}`}>
          {badges.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-teal-500" aria-hidden="true" /> {b}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
