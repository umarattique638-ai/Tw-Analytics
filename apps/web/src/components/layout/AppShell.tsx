import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart2, ChevronsUpDown, LogOut, Plus, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import logo from '../../assets/lg.png';
import ConfirmDeleteModal from '../common/ConfirmDeleteModal';
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

  // route badle to drawer aur dropdown band
  useEffect(() => {
    setOpen(false);
    setWsOpen(false);
  }, [pathname]);

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
          <div className="relative mb-3 px-3">
            <button
              onClick={() => setWsOpen((o) => !o)}
              aria-expanded={wsOpen}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-gray-200 transition hover:bg-white/10"
            >
              <span className="truncate">{current?.domain ?? 'Select domain'}</span>
              <ChevronsUpDown className="size-4 flex-none text-gray-500" />
            </button>

            {wsOpen && (
              <div className="absolute left-3 right-3 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-[#1a2233] shadow-lg">
                {sites.length === 0 && <p className="px-3 py-2 text-xs text-gray-500">No domains yet</p>}
                {sites.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-3 py-2 hover:bg-white/10">
                    <button
                      onClick={() => { select(d.id); setWsOpen(false); }}
                      className={`flex-1 truncate text-left text-sm hover:text-white ${d.id === current?.id ? 'text-white' : 'text-gray-300'}`}
                    >
                      {d.domain}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setToDelete(d); }}
                      title="Delete domain"
                      aria-label={`Delete ${d.domain}`}
                      className="ml-2 text-rose-500 transition-colors hover:text-rose-400"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => navigate('/sites/new')}
                  className="flex w-full items-center gap-2 border-t border-white/10 px-3 py-2 text-left text-sm text-teal-300 hover:bg-white/10"
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
        <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-10 lg:px-5">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_50%_-20%,rgba(45,212,191,0.16),transparent_65%)] dark:bg-[radial-gradient(ellipse_at_50%_-20%,rgba(45,212,191,0.10),transparent_65%)]"
          />
          <div className={`relative mx-auto flex w-full flex-col ${isSetup ? 'my-auto shrink-0' : 'flex-1'}`}>
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