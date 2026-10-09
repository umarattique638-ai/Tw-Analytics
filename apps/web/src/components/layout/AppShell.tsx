import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart2, Check, ChevronsUpDown, Globe, LogOut, Menu, Plus, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import logo from '../../assets/lg.png';
import ConfirmDeleteModal from '../common/ConfirmDeleteModal';
import SyncBanner from './SyncBanner';
import { api } from '../../api/client';
import type { Site } from '../../api/client';
import { useSession } from '../../api/session';

const SETUP_PATHS = ['/sites/new', '/install', '/verify'];

type Item = { label: string; icon: LucideIcon; to?: string; dot?: boolean };

const items: Item[] = [
  { label: 'Live traffic', icon: Activity, to: '/dashboard', dot: true },
  { label: 'Events', icon: Sparkles, to: '/events' },
  { label: 'Suspicious activity', icon: ShieldAlert, to: '/suspicious' },
  { label: 'Reports', icon: BarChart2, to: '/reports' },
];

const itemCls = (active: boolean) =>
  `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium transition-colors ${
    active ? 'bg-white/10 text-white' : 'text-gray-300 hover:bg-white/10 hover:text-white'
  }`;

export default function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const { sites, current, select, reload, signOut } = useSession();
  const [open, setOpen] = useState(false); // mobile drawer
  const [wsOpen, setWsOpen] = useState(false); // domain dropdown
  const [toDelete, setToDelete] = useState<Site | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const wsRef = useRef<HTMLDivElement>(null);

  // route badle to drawer aur dropdown band
  useEffect(() => {
    setOpen(false);
    setWsOpen(false);
  }, [pathname]);

  // Domain dropdown: a click anywhere outside it (sidebar, page, anywhere) or Escape closes it.
  useEffect(() => {
    if (!wsOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (wsRef.current && !wsRef.current.contains(e.target as Node)) setWsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setWsOpen(false);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [wsOpen]);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteSite(toDelete.id);
      const remaining = await reload();
      if (current?.id === toDelete.id) {
        if (remaining.length) select(remaining[0]!.id);
        else navigate('/sites/new');
      }
      setToDelete(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  };

  const logout = async () => {
    await signOut();
    navigate('/login');
  };

  const isSetup = SETUP_PATHS.includes(pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* mobile overlay */}
      {open && <div onClick={() => setOpen(false)} className="fixed inset-0 z-[90] bg-black/50 lg:hidden" />}

      {/* SIDEBAR */}
      <aside
        className={`fixed inset-y-0 left-0 z-[100] flex w-64 flex-shrink-0 flex-col bg-[#111827] text-white shadow-xl transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4">
          <img src={logo} alt="Logo" className="!h-16 !w-52 !object-contain" />
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded-md p-1 text-gray-300 hover:text-white lg:hidden">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* domain selector */}
          <div ref={wsRef} className="relative mb-3 px-3">
            <button
              onClick={() => setWsOpen((o) => !o)}
              aria-expanded={wsOpen}
              aria-haspopup="listbox"
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm text-gray-200 transition hover:bg-white/10 ${
                wsOpen ? 'border-teal-400/40 bg-white/10' : 'border-white/10 bg-white/5'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Globe className="size-4 flex-none text-teal-300" />
                <span className="truncate">{current?.domain ?? 'Select domain'}</span>
              </span>
              <ChevronsUpDown className="size-4 flex-none text-gray-500" />
            </button>

            {wsOpen && (
              <div
                role="listbox"
                className="absolute left-3 right-3 top-full z-20 mt-1.5 origin-top animate-[tw-pop_120ms_ease-out] overflow-hidden rounded-xl border border-white/10 bg-[#1a2233] shadow-2xl shadow-black/40"
              >
                <p className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">Your sites</p>
                <div className="max-h-64 overflow-y-auto pb-1">
                  {sites.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">No domains yet</p>}
                  {sites.map((d) => {
                    const on = d.id === current?.id;
                    return (
                      <div key={d.id} className="group flex items-center gap-1 px-1.5">
                        <button
                          role="option"
                          aria-selected={on}
                          onClick={() => { select(d.id); setWsOpen(false); }}
                          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-white/10 ${on ? 'text-white' : 'text-gray-300 hover:text-white'}`}
                        >
                          <span className={`size-1.5 flex-none rounded-full ${d.status === 'paused' ? 'bg-amber-400' : d.verifiedAt ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                          <span className="truncate">{d.domain}</span>
                          {on && <Check className="ml-auto size-3.5 flex-none text-teal-300" />}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setWsOpen(false); setToDelete(d); }}
                          title="Delete domain"
                          aria-label={`Delete ${d.domain}`}
                          className="grid size-7 flex-none place-items-center rounded-md text-gray-500 opacity-70 transition hover:bg-rose-500/15 hover:text-rose-400 group-hover:opacity-100"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => { setWsOpen(false); navigate('/sites/new'); }}
                  className="flex w-full items-center gap-2 border-t border-white/10 px-4 py-2.5 text-left text-sm font-medium text-teal-300 transition hover:bg-white/10"
                >
                  <Plus className="size-3.5" /> Add a site
                </button>
              </div>
            )}
          </div>

          {/* nav */}
          <nav aria-label="Main" className="mb-4 grid gap-1 px-2">
            {items.map((it) =>
              it.to ? (
                <NavLink key={it.label} to={it.to} end className={({ isActive }) => itemCls(isActive)}>
                  <it.icon className="size-[18px]" />
                  <span className="flex-1 text-left">{it.label}</span>
                  {it.dot && <span className="size-2 rounded-full bg-emerald-500" />}
                </NavLink>
              ) : (
                <span key={it.label} aria-disabled="true" className="flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium text-slate-600">
                  <it.icon className="size-[18px]" />
                  <span className="flex-1 text-left">{it.label}</span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Soon</span>
                </span>
              ),
            )}
          </nav>
        </div>

        <div className="mx-3 mb-3 h-px bg-white/[0.06]" />
        <button
          onClick={logout}
          className="mx-3 mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 transition hover:bg-white/10 hover:text-white"
        >
          <LogOut className="size-4" />
          Logout
        </button>
      </aside>

      {/* CONTENT */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* mobile top bar: the sidebar is a drawer below lg */}
        <header className="flex items-center gap-3 border-b border-white/10 bg-[#111827] px-4 py-2.5 text-white lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="grid size-9 place-items-center rounded-lg text-gray-300 transition hover:bg-white/10 hover:text-white">
            <Menu className="size-5" />
          </button>
          <img src={logo} alt="TailWatch" className="h-8 w-auto object-contain" />
          <span className="ml-auto max-w-[45%] truncate text-xs text-gray-400">{current?.domain}</span>
        </header>
        <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-10 lg:px-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_50%_-20%,rgba(45,212,191,0.16),transparent_65%)] dark:bg-[radial-gradient(ellipse_at_50%_-20%,rgba(45,212,191,0.10),transparent_65%)]"
          />
          <div className={`relative mx-auto flex w-full flex-col ${isSetup ? 'my-auto shrink-0' : 'flex-1'}`}>
            <SyncBanner />
            <Outlet />
          </div>
        </main>
      </div>

      {toDelete && (
        <ConfirmDeleteModal
          title="Delete this domain?"
          message={
            <>
              <span className="font-medium text-slate-700 dark:text-slate-200">{toDelete.domain}</span> stops collecting and is removed from
              your account. Data already collected is kept: adding the domain again brings it back.
              {deleteError && <span className="mt-2 block text-red-600 dark:text-red-400">{deleteError}</span>}
            </>
          }
          deleting={deleting}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}