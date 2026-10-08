import { useNavigate } from 'react-router-dom';
import { ArrowRight, Code, Globe, ShieldCheck } from 'lucide-react';
import Button from '../ui/Button';
import { muted } from '../ui/styles';

const steps = [
  { icon: Globe, title: 'Add your site', desc: 'Enter your domain and timezone. We never touch your DNS.' },
  { icon: Code, title: 'Install the snippet', desc: 'Paste one script tag, or use npm, a framework or WordPress.' },
  { icon: ShieldCheck, title: 'Verify the install', desc: 'We check your page and wait for the first pageview.' },
];

const badges = ['No IP addresses stored', 'Bots filtered out', 'Ready in ~2 minutes'];

export default function GettingStarted() {
  const navigate = useNavigate();

  return (
    <div className="my-auto px-4">
      <div className="mx-auto w-full max-w-[760px]">
        <span className="inline-flex items-center gap-2 rounded-full border border-teal-600/20 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700 dark:border-teal-400/25 dark:bg-teal-400/10 dark:text-teal-300">
          <span className="size-1.5 rounded-full bg-teal-500" /> Welcome to TailWatch
        </span>

        <h1 className="mt-4 text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
          Let's set up your first site
        </h1>
        <p className={`mt-3 max-w-xl text-base leading-relaxed ${muted}`}>
          Three quick steps. Your dashboard fills in as soon as the first pageview arrives.
        </p>

        <ol className="mt-8 grid gap-3">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className={`flex items-center gap-4 rounded-2xl border bg-white p-5 shadow-sm transition dark:bg-slate-900 ${
                i === 0
                  ? 'border-teal-600/40 ring-4 ring-teal-600/10 dark:border-teal-400/40 dark:ring-teal-400/10'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <span
                className={`grid size-11 flex-none place-items-center rounded-xl ${
                  i === 0
                    ? 'bg-teal-700 text-white dark:bg-teal-400 dark:text-slate-950'
                    : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                }`}
              >
                <s.icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold text-slate-900 dark:text-white">{s.title}</p>
                <p className={`mt-0.5 text-sm ${muted}`}>{s.desc}</p>
              </div>
              <span className="text-sm font-semibold text-slate-300 dark:text-slate-600">0{i + 1}</span>
            </li>
          ))}
        </ol>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button onClick={() => navigate('/sites/new')} className="gap-2">
            Add your site <ArrowRight className="size-4" />
          </Button>
        </div>

        <ul className={`mt-8 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-6 text-[13px] dark:border-slate-800 ${muted}`}>
          {badges.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-teal-500" /> {b}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}