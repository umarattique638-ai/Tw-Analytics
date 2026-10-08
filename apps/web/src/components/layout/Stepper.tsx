import { useLocation } from 'react-router-dom';
import { muted } from '../ui/styles';

const STEPS = [
  { path: '/sites/new', label: 'Add site' },
  { path: '/install', label: 'Install' },
  { path: '/verify', label: 'Verify' },
];

const dotStyle = {
  done: 'border-teal-700 bg-teal-700 text-white dark:border-teal-400 dark:bg-teal-400 dark:text-slate-950',
  now: 'scale-110 border-teal-700 bg-white text-teal-700 ring-4 ring-teal-700/15 dark:border-teal-400 dark:bg-slate-950 dark:text-teal-300 dark:ring-teal-400/20',
  todo: 'border-slate-300 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-500',
};

export default function Stepper() {
  const { pathname } = useLocation();
  const current = Math.max(STEPS.findIndex((s) => s.path === pathname), 0);
  const inset = 50 / STEPS.length;
  const progress = (current / (STEPS.length - 1)) * 100;

  return (
    <nav aria-label="Setup progress" className="relative">
      <div
        aria-hidden="true"
        className="absolute top-[18px] h-0.5 -translate-y-1/2 rounded-full bg-slate-200 dark:bg-slate-800"
        style={{ left: `${inset}%`, right: `${inset}%` }}
      >
        <div
          className="h-full rounded-full bg-teal-700 transition-[width] duration-700 ease-in-out motion-reduce:transition-none dark:bg-teal-400"
          style={{ width: `${progress}%` }}
        />
      </div>

      <ol className="relative grid" style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}>
        {STEPS.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'now' : 'todo';
          return (
            <li key={s.path} aria-current={state === 'now' ? 'step' : undefined} className="flex flex-col items-center">
              <span
                className={`relative z-10 grid size-9 place-items-center rounded-full border-2 text-sm font-semibold transition-all duration-500 ease-out motion-reduce:transition-none ${dotStyle[state]}`}
              >
                <span className={`transition-all duration-300 ${state === 'done' ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}`}>{i + 1}</span>
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={`absolute size-4 transition-all duration-300 ${state === 'done' ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}
                >
                  <path d="M3 8.5l3.2 3L13 4.5" />
                </svg>
              </span>
              <span
                className={`mt-2.5 text-[13px] font-medium transition-colors duration-500 sm:text-sm ${
                  state === 'now'
                    ? 'font-semibold text-slate-900 dark:text-white'
                    : state === 'done'
                      ? 'text-teal-700 dark:text-teal-400'
                      : muted
                }`}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}