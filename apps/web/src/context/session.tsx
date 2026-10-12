import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SESSION_ENDED, api } from '../api/client';
import type { KvIssue, Me, Role, Site, User } from '../api/client';
import { notify } from '../lib/notify';

/**
 * Signed-in state for the dashboard: the user, their sites and the site being looked at.
 * Everything comes from the API; the only thing kept in the browser is which site was last selected.
 * When any request finds the session gone (expired, signed out elsewhere), the app returns to Log in and
 * comes back to the same page after signing in.
 */
interface Session {
  user: User;
  role: Role;
  /** Retention choices of this deployment (days). */
  retention: Me['retention'];
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
  const [me, setMe] = useState<Pick<Me, 'role' | 'retention'>>({ role: 'viewer', retention: { choices: [], max: 0, default: 0 } });
  const [sites, setSites] = useState<Site[]>([]);
  const [kvIssues, setKvIssues] = useState<KvIssue[]>([]);
  const [currentId, setCurrentId] = useState<number | null>(remembered);
  const signedIn = useRef(false);
  signedIn.current = state === 'in';

  const reload = useCallback(async () => {
    const { sites, kvIssues } = await api.sites();
    setSites(sites);
    setKvIssues(kvIssues ?? []);
    return sites;
  }, []);

  // A request anywhere found the session gone: back to Log in.
  useEffect(() => {
    const ended = () => {
      if (signedIn.current) notify.info('Your session ended', { description: 'Log in again to continue.' });
      setUser(null);
      setState('out');
    };
    window.addEventListener(SESSION_ENDED, ended);
    return () => window.removeEventListener(SESSION_ENDED, ended);
  }, []);

  useEffect(() => {
    let live = true;
    api
      .me()
      .then(async ({ user, role, retention }) => {
        const list = await reload();
        if (!live) return;
        setUser(user);
        setMe({ role: role ?? 'viewer', retention: retention ?? { choices: [], max: 0, default: 0 } });
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
      role: me.role,
      retention: me.retention,
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
  }, [user, me, sites, kvIssues, currentId, select, reload, upsert]);

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
