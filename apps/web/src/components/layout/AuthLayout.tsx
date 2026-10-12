import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Check } from 'lucide-react';
import Logo from './Logo';
import PageLoading from '../common/PageLoading';
import { muted } from '../ui/styles';

const points = ['Bots and spam filtered, every drop itemised', 'Shows its own margin of error, not just a number', 'No IP address stored'];

/** Decorative bars of the example card (not data). */
const bars = [38, 52, 44, 61, 57, 72, 66, 84, 78, 92];

// The brand panel ends in a diagonal edge; the inner layer is 3px narrower so the teal layer shows as a line.
const SLANT = 'polygon(0 0, 100% 0, calc(100% - 96px) 100%, 0 100%)';
const SLANT_INNER = 'polygon(0 0, calc(100% - 3px) 0, calc(100% - 99px) 100%, 0 100%)';

/** Log in, sign up and password screens: brand panel on the left (large screens), the form card on the right. */
export default function AuthLayout() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[minmax(540px,1.05fr)_minmax(0,1fr)]">
      <aside className="relative z-10 hidden lg:sticky lg:top-0 lg:block lg:h-dvh" aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-b from-teal-300 via-teal-500 to-teal-700" style={{ clipPath: SLANT }} />
        <div className="absolute inset-0 overflow-hidden bg-slate-950 text-white" style={{ clipPath: SLANT_INNER }}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(45,212,191,0.22),transparent_50%),radial-gradient(circle_at_90%_100%,rgba(15,118,110,0.38),transparent_55%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_30%_30%,black,transparent_70%)]" />

          <div className="relative flex h-full flex-col p-12 pr-32 xl:p-16 xl:pr-36">
            <Logo light className="flex-none self-start" />

            <div className="my-auto max-w-lg py-10">
              <h2 className="text-4xl leading-[1.12] font-bold tracking-tight text-balance xl:text-[46px]">The truth about how many humans visited.</h2>
              <p className="mt-4 max-w-md text-base leading-relaxed text-slate-400">Privacy-first web analytics: real visitors, real numbers, and an honest margin of error.</p>
              <ul className="mt-8 grid gap-3.5">
                {points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-[15px] leading-snug text-slate-300">
                    <span className="mt-px grid size-5 flex-none place-items-center rounded-full bg-teal-400/15 text-teal-300 ring-1 ring-teal-400/30">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>

            <figure className="flex-none rounded-2xl [@media(max-height:760px)]:hidden border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
              <div className="flex items-end justify-between gap-6">
                <div>
                  <p className="text-sm font-medium text-slate-400">Capture rate</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums">91.4%</p>
                </div>
                <div className="flex h-12 items-end gap-1.5">
                  {bars.map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }} className="w-2 rounded-sm bg-gradient-to-t from-teal-600 to-teal-300 opacity-90" />
                  ))}
                </div>
              </div>
              <figcaption className="mt-4 border-t border-white/10 pt-3 text-[13px] leading-relaxed text-slate-400">
                An example: 1,284 of 1,405 expected beacons received. The dashboard shows what it could not see, too.
              </figcaption>
            </figure>
          </div>
        </div>
      </aside>

      <div className="relative flex min-h-dvh min-w-0 flex-col overflow-hidden bg-slate-50 lg:-ml-24 lg:min-h-0 lg:pl-24 dark:bg-slate-950">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_at_50%_-20%,rgba(45,212,191,0.2),transparent_65%)] dark:bg-[radial-gradient(ellipse_at_50%_-20%,rgba(45,212,191,0.12),transparent_65%)]"
        />
        <div className="relative px-6 pt-6 lg:hidden">
          <Logo />
        </div>
        <main className="relative flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
          <div className="w-full max-w-[480px] rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-16px_rgba(15,23,42,0.18)] sm:p-10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none">
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
        <footer className={`relative px-6 py-6 text-center text-xs ${muted}`}>© {new Date().getFullYear()} TailWatch</footer>
      </div>
    </div>
  );
}
