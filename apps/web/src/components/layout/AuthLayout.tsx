import { Link, Outlet } from 'react-router-dom';
import Logo from './Logo';
import { muted } from '../ui/styles';

const points = [
  'Bots and spam filtered, every drop itemised',
  'Shows its own margin of error, not just a number',
  'No IP address stored, EU-only region available',
];

const bars = [38, 52, 44, 61, 57, 72, 66, 84, 78, 92];

// diagonal edge: top full width, bottom 96px narrower
const SLANT = 'polygon(0 0, 100% 0, calc(100% - 96px) 100%, 0 100%)';
// same shape but 3px narrower, so the layer underneath shows as a glowing edge line
const SLANT_INNER = 'polygon(0 0, calc(100% - 3px) 0, calc(100% - 99px) 100%, 0 100%)';

export default function AuthLayout() {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(540px,1.05fr)_minmax(0,1fr)]">
      {/* LEFT: diagonal brand panel */}
      <aside className="relative z-10 hidden lg:sticky lg:top-0 lg:block lg:h-screen">
        {/* teal edge line layer */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-teal-300 via-teal-500 to-teal-700"
          style={{ clipPath: SLANT }}
        />
        {/* dark panel layer */}
        <div
          className="absolute inset-0 overflow-hidden bg-slate-950 text-white"
          style={{ clipPath: SLANT_INNER }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(45,212,191,0.24),transparent_50%),radial-gradient(circle_at_90%_100%,rgba(15,118,110,0.40),transparent_55%)]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_30%_30%,black,transparent_70%)]"
          />
          {/* decorative rings */}
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 top-1/4 size-[420px] rounded-full border border-white/[0.06]" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-8 top-[32%] size-[260px] rounded-full border border-teal-400/10" />

          <div className="relative flex h-full flex-col p-12 pr-32 xl:p-16 xl:pr-36">
            <Logo light />

            <div className="my-auto max-w-lg py-12">
              <span className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-xs font-medium text-teal-300">
                <span className="size-1.5 rounded-full bg-teal-400" /> Privacy-first web analytics
              </span>
              <h2 className="mt-5 text-4xl font-bold leading-[1.12] tracking-tight text-balance xl:text-[46px]">
                The truth about how many <span className="bg-gradient-to-r from-teal-200 to-teal-400 bg-clip-text text-transparent">humans</span> visited.
              </h2>
              <p className="mt-4 max-w-md text-base leading-relaxed text-slate-400">
                Real visitors, real numbers, and an honest margin of error.
              </p>
              <ul className="mt-8 grid gap-3.5">
                {points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-[15px] leading-snug text-slate-300">
                    <span className="mt-px grid size-5 flex-none place-items-center rounded-full bg-teal-400/15 text-teal-300 ring-1 ring-teal-400/30">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden="true">
                        <path d="M3 8.5l3.2 3L13 4.5" />
                      </svg>
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
              <div className="flex items-end justify-between gap-6">
                <div>
                  <p className="text-sm font-medium text-slate-400">Capture rate</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums">91.4%</p>
                </div>
                <div className="flex h-12 items-end gap-1.5" aria-hidden="true">
                  {bars.map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }} className="w-2 rounded-sm bg-gradient-to-t from-teal-600 to-teal-300 opacity-90" />
                  ))}
                </div>
              </div>
              <p className="mt-4 border-t border-white/10 pt-3 text-[13px] leading-relaxed text-slate-400">
                1,284 of 1,405 expected beacons received. We show you what we can't see.
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* RIGHT: slides under the diagonal edge */}
<div className="relative flex min-h-screen min-w-0 flex-col overflow-hidden bg-slate-50 lg:-ml-24 lg:min-h-0 lg:pl-24 dark:bg-slate-950">     
<div
  aria-hidden="true"
  className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_at_50%_-20%,rgba(45,212,191,0.22),transparent_65%)] dark:bg-[radial-gradient(ellipse_at_50%_-20%,rgba(45,212,191,0.14),transparent_65%)]"
/>
  

        <main className="relative flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
          <div className="w-full max-w-[500px] rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-16px_rgba(15,23,42,0.18)] sm:p-10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <Outlet />
          </div>
        </main>

        <footer className={`relative px-6 py-6 text-center text-xs ${muted}`}>
          © 2026 TailWatch · <a href="#" className="hover:underline">Privacy</a> · <a href="#" className="hover:underline">Terms</a>
        </footer>
      </div>
    </div>
  );
}