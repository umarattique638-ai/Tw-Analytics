import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { api } from './client';
import type { KvIssue, Site, User } from './client';

/**
 * Signed-in state for the dashboard: the user, their sites and the site being looked at.
 * Everything comes from the API; the only thing kept in the browser is which site was last selected.
 */
interface Session {
  user: User;
  sites: Site[];
  /** Sites whose changes have not reached Cloudflare yet (shown as a banner, retried by the server). */
  kvIssues: KvIssue[];
  retrySync: () => Promise<void>;
  current: Site | null;
  select: (id: number) => void;
  reload: () => Promise<Site[]>;
  upsert: (site: Site) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);
const LAST_SITE = 'tw_last_site';

const remembered = (): number | null => {
  try {
    const v = Number(localStorage.getItem(LAST_SITE));
    return Number.isSafeInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside RequireAuth');
  return s;
}

/** Route guard: loads /me and /sites, or sends the visitor to /login. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<'loading' | 'out' | 'in'>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [kvIssues, setKvIssues] = useState<KvIssue[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(remembered);

  const reload = useCallback(async () => {
    const { sites, kvIssues } = await api.sites();
    setSites(sites);
    setKvIssues(kvIssues ?? []);
    return sites;
  }, []);

  useEffect(() => {
    let live = true;
    api
      .me()
      .then(async ({ user }) => {
        const list = await reload();
        if (!live) return;
        setUser(user);
        setCurrentId((id) => (id && list.some((s) => s.id === id) ? id : (list[0]?.id ?? null)));
        setState('in');
      })
      .catch(() => live && setState('out'));
    return () => {
      live = false;
    };
  }, [reload]);

  const select = useCallback((id: number) => {
    setCurrentId(id);
    try {
      localStorage.setItem(LAST_SITE, String(id));
    } catch {
      // storage blocked: selection lasts for this tab only
    }
  }, []);

  const upsert = useCallback((site: Site) => {
    setSites((list) => (list.some((s) => s.id === site.id) ? list.map((s) => (s.id === site.id ? site : s)) : [...list, site]));
  }, []);

  const value = useMemo<Session | null>(() => {
    if (!user) return null;
    return {
      user,
      sites,
      kvIssues,
      retrySync: async () => {
        setKvIssues((await api.syncAll()).kvIssues);
      },
      current: sites.find((s) => s.id === currentId) ?? null,
      select,
      reload,
      upsert,
      signOut: async () => {
        await api.logout().catch(() => undefined);
        setUser(null);
        setState('out');
      },
    };
  }, [user, sites, kvIssues, currentId, select, reload, upsert]);

  if (state === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-50 dark:bg-slate-950">
        <span className="size-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" aria-label="Loading" />
      </div>
    );
  }
  if (state === 'out' || !value) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Ctx.Provider value={value}>{children ?? <Outlet />}</Ctx.Provider>;
}
