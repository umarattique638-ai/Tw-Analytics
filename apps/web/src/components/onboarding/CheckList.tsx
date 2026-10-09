import { Check as CheckIcon, Minus, X } from 'lucide-react';

/** One row of the install check: waiting -> running -> pass / fail / skip. */
export type StepState = 'waiting' | 'running' | 'pass' | 'fail' | 'skip';
export interface Step {
  id: string;
  label: string;
  state: StepState;
  message?: string;
}

function Mark({ state }: { state: StepState }) {
  if (state === 'running') {
    return <span className="size-6 flex-none animate-spin rounded-full border-2 border-teal-600 border-t-transparent dark:border-teal-400 dark:border-t-transparent" aria-label="checking" />;
  }
  if (state === 'waiting') {
    return <span className="size-6 flex-none rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600" aria-label="not checked yet" />;
  }
  const look = {
    pass: { cls: 'bg-emerald-600 text-white dark:bg-emerald-500', icon: <CheckIcon className="size-3.5" strokeWidth={3} />, label: 'passed' },
    fail: { cls: 'bg-red-600 text-white dark:bg-red-500', icon: <X className="size-3.5" strokeWidth={3} />, label: 'failed' },
    skip: { cls: 'bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-300', icon: <Minus className="size-3.5" strokeWidth={3} />, label: 'not checked' },
  }[state];
  return (
    <span aria-label={look.label} className={`grid size-6 flex-none animate-[tw-check_320ms_ease-out] place-items-center rounded-full ${look.cls}`}>
      {look.icon}
    </span>
  );
}

/** The install check, one step at a time, each with the server's own message. */
export default function CheckList({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative grid gap-0" data-testid="install-steps">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const done = s.state === 'pass' || s.state === 'fail' || s.state === 'skip';
        return (
          <li key={s.id} data-check={s.id} data-status={s.state} className="relative flex gap-3.5 pb-4 last:pb-0">
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute left-[11px] top-7 h-[calc(100%-1.5rem)] w-0.5 rounded-full transition-colors duration-500 ${
                  s.state === 'pass' ? 'bg-emerald-500/60' : s.state === 'fail' ? 'bg-red-400/60' : 'bg-slate-200 dark:bg-slate-700'
                }`}
              />
            )}
            <Mark state={s.state} />
            <div className={`min-w-0 pt-0.5 ${done ? 'animate-[tw-rise_260ms_ease-out]' : ''}`}>
              <p
                className={`text-[15px] font-semibold ${
                  s.state === 'waiting' ? 'text-slate-400 dark:text-slate-500' : s.state === 'fail' ? 'text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-white'
                }`}
              >
                {s.label}
              </p>
              {s.message && (
                <p className={`mt-0.5 text-[13px] leading-relaxed ${s.state === 'fail' ? 'text-red-700/90 dark:text-red-300/90' : 'text-slate-500 dark:text-slate-400'}`}>
                  {s.message}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
