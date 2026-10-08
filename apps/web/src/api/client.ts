/**
 * The dashboard's only way to the backend: the TailWatch API, /api/v1 (one backend for every client).
 * Same origin, session cookie, JSON. The dashboard holds no business rules: it shows what this returns.
 */
export interface User { id: string; email: string; name: string | null }
export interface Key { id: string; publicKey: string; status: 'active' | 'revoked'; createdAt: string; revokedAt: string | null }
export interface Site {
  id: number;
  domain: string;
  timezone: string;
  allowedHosts: string[];
  status: 'active' | 'paused';
  region: string;
  verifiedAt: string | null;
  createdAt: string;
  publicKey: string | null;
  keys: Key[];
}
export interface Sync { ok: boolean; message?: string }
export interface Snippet {
  id: string;
  group: 'script-tag' | 'npm' | 'framework' | 'wordpress';
  label: string;
  language: string;
  code: string;
  note?: string;
  availability: 'now' | 'soon';
}
export interface Status {
  windowMinutes: number;
  verifiedAt: string | null;
  events: number;
  pageviews: number;
  last: { at: string; name: string; path: string } | null;
  drops: { reason: string; hits: number; detail: string }[];
}
export interface Check { id: string; label: string; status: 'pass' | 'fail' | 'skip'; message: string }
export interface VerifyResult { url: string; ok: boolean; checks: Check[] }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: method === 'GET' ? {} : { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the TailWatch API. Is it running?');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Request failed (${res.status}).`);
  return data as T;
}

export const api = {
  me: () => call<{ user: User }>('GET', '/me'),
  signup: (name: string, email: string, password: string) => call<{ user: User }>('POST', '/auth/signup', { name, email, password }),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),
  sites: () => call<{ sites: Site[] }>('GET', '/sites'),
  preview: (domain: string) => call<{ domain: string; allowedHosts: string[] }>('GET', `/sites/preview?domain=${encodeURIComponent(domain)}`),
  addSite: (domain: string, timezone: string) => call<{ site: Site; sync: Sync }>('POST', '/sites', { domain, timezone }),
  site: (id: number) => call<{ site: Site; snippets: Snippet[] }>('GET', `/sites/${id}`),
  updateSite: (id: number, patch: { timezone?: string; status?: 'active' | 'paused' }) => call<{ site: Site; sync: Sync }>('PATCH', `/sites/${id}`, patch),
  deleteSite: (id: number) => call<{ ok: true; sync: Sync }>('DELETE', `/sites/${id}`),
  rotateKey: (id: number) => call<{ site: Site; sync: Sync }>('POST', `/sites/${id}/keys`),
  revokeKey: (id: number, keyId: string) => call<{ site: Site; sync: Sync }>('POST', `/sites/${id}/keys/${keyId}/revoke`),
  sync: (id: number) => call<{ sync: Sync }>('POST', `/sites/${id}/sync`),
  status: (id: number) => call<Status>('GET', `/sites/${id}/status`),
  verify: (id: number, url?: string) => call<VerifyResult>('POST', `/sites/${id}/verify`, { url }),
};
