import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { SESSION_ENDED, api } from '../api/client';
import type { KvIssue, Me, Role, Setup, Site, User } from '../api/client';
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
  /** The TailWatch team: the sidebar shows "All accounts" (/admin). The API checks it on every call. */
  superAdmin: boolean;
  /** Retention choices of this deployment (days). */
  retention: Me['retention'];
  /** The workspace's sites. Every one is verified: a site is saved only after its install check (decision 25). */
  sites: Site[];
  /** Every stored site (the same list, plus any saved unverified before decision 25 until the nightly cleanup). */
  allSites: Site[];
  /** The site being set up: not a site yet, nothing stored for it (one at a time, expires by itself). */
  setup: Setup | null;
  setSetup: (setup: Setup | null) => void;
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
  const [me, setMe] = useState<Pick<Me, 'role' | 'retention'> & { superAdmin: boolean }>({ role: 'viewer', retention: { choices: [], max: 0, default: 0 }, superAdmin: false });
  const [sites, setSites] = useState<Site[]>([]);
  const [kvIssues, setKvIssues] = useState<KvIssue[]>([]);
  const [setup, setSetup] = useState<Setup | null>(null);
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
      .then(async ({ user, role, retention, superAdmin }) => {
        const [list, pending] = await Promise.all([reload(), api.setup().then((r) => r.setup).catch(() => null)]);
        setSetup(pending);
        if (!live) return;
        setUser(user);
        setMe({ role: role ?? 'viewer', retention: retention ?? { choices: [], max: 0, default: 0 }, superAdmin: superAdmin === true });
        const verified = list.filter((s) => !!s.verifiedAt);
        // A link from an e-mail (/dashboard?site=101) opens that site.
        const linked = Number(new URLSearchParams(window.location.search).get('site'));
        setCurrentId((id) =>
          verified.some((s) => s.id === linked) ? linked : id && verified.some((s) => s.id === id) ? id : (verified[0]?.id ?? null),
        );
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
    const verified = sites.filter((s) => !!s.verifiedAt);
    return {
      user,
      role: me.role,
      retention: me.retention,
      superAdmin: me.superAdmin,
      sites: verified,
      allSites: sites,
      setup,
      setSetup,
      kvIssues,
      retrySync: async () => {
        setKvIssues((await api.syncAll()).kvIssues);
      },
      current: verified.find((s) => s.id === currentId) ?? null,
      select,
      reload,
      upsert,
      signOut: async () => {
        await api.logout().catch(() => undefined);
        setUser(null);
        setState('out');
      },
    };
  }, [user, me, sites, kvIssues, setup, currentId, select, reload, upsert]);

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

/** Route guard of /admin: the TailWatch team only (the API refuses everyone else anyway). */
export function RequireSuperAdmin() {
  const { superAdmin } = useSession();
  return superAdmin ? <Outlet /> : <Navigate to="/dashboard" replace />;
}
