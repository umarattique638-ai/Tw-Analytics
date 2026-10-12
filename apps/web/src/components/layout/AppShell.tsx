import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, FileText, History, LayoutDashboard, LogOut, Menu, Settings, ShieldAlert, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import logo from '../../assets/lg.png';
import PageLoading from '../common/PageLoading';
import SiteSwitcher from './SiteSwitcher';
import SyncBanner from './SyncBanner';
import { useSession } from '../../hooks/useSession';

const SETUP_PATHS = ['/sites/new', '/install', '/verify'];

type Item = { label: string; icon: LucideIcon; to: string };
const groups: { label: string; items: Item[] }[] = [
  {
    label: 'Analytics',
    items: [
      { label: 'Overview', icon: LayoutDashboard, to: '/dashboard' },
      { label: 'Events', icon: Sparkles, to: '/events' },
      { label: 'Suspicious activity', icon: ShieldAlert, to: '/suspicious' },
      { label: 'Reports', icon: FileText, to: '/reports' },
    ],
  },
  {
    label: 'Account',
    items: [
      { label: 'Activity', icon: History, to: '/activity' },
      { label: 'Settings', icon: Settings, to: '/settings' },
    ],
  },
];

const initials = (name: string) =>
  name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';

/** The signed-in frame: sidebar (a drawer on phones), the sync banner, and the page. */
export default function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, current, signOut } = useSession();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawer]);

  const logout = async () => {
    await signOut();
    navigate('/login');
  };

  const isSetup = SETUP_PATHS.includes(pathname);
  const name = user.name?.trim() || user.email;

  return (
    <div className="flex h-dvh overflow-hidden bg-slate-50 dark:bg-slate-950">
      {drawer && <div onClick={() => setDrawer(false)} aria-hidden="true" className="fixed inset-0 z-[90] animate-[tw-fade_150ms_ease-out] bg-slate-950/60 lg:hidden" />}

      <aside
        aria-label="Sidebar"
        className={`fixed inset-y-0 left-0 z-[100] flex w-[17rem] flex-none flex-col bg-slate-950 text-white ring-1 ring-white/5 transition-transform duration-200 lg:static lg:translate-x-0 ${
          drawer ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <img src={logo} alt="TailWatch" className="h-11 w-auto object-contain" draggable={false} />
          <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="grid size-9 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white lg:hidden">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          <SiteSwitcher />

          <nav aria-label="Main" className="mt-6 grid gap-6">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="mb-1.5 px-3 text-xs font-medium text-slate-500">{g.label}</p>
                <ul className="grid gap-0.5">
                  {g.items.map((it) => (
                    <li key={it.to}>
                      <NavLink
                        to={it.to}
                        end
                        className={({ isActive }) =>
                          `relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40 ${
                            isActive ? 'bg-white/[0.08] text-white before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-teal-400' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'
                          }`
                        }
                      >
                        <it.icon className="size-[18px] flex-none" aria-hidden="true" />
                        {it.label}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="border-t border-white/[0.06] p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span aria-hidden="true" className="grid size-9 flex-none place-items-center rounded-full bg-gradient-to-br from-teal-300 to-teal-600 text-[13px] font-semibold text-slate-950">
              {initials(name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{name}</p>
              {user.name && <p className="truncate text-xs text-slate-500">{user.email}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/40"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-none items-center gap-3 border-b border-white/10 bg-slate-950 px-4 py-2.5 text-white lg:hidden">
          <button type="button" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer} className="grid size-9 place-items-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white">
            <Menu className="size-5" />
          </button>
          <img src={logo} alt="TailWatch" className="h-8 w-auto object-contain" />
          <span className="ml-auto max-w-[45%] truncate text-xs text-slate-400">{current?.domain}</span>
        </header>

        <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(ellipse_at_50%_-30%,rgba(45,212,191,0.13),transparent_65%)] dark:bg-[radial-gradient(ellipse_at_50%_-30%,rgba(45,212,191,0.08),transparent_65%)]"
          />
          <div className={`relative mx-auto flex w-full max-w-[1400px] flex-col ${isSetup ? 'my-auto shrink-0' : 'flex-1'}`}>
            <SyncBanner />
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
