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
export interface Sync { ok: boolean; pending?: boolean; message?: string }
/** A site whose Cloudflare KV entries do not match yet (decision 18). Retried automatically. */
export interface KvIssue { siteId: number; domain: string; deleted: boolean; error: string; since: string; attempts: number }
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
  sites: () => call<{ sites: Site[]; kvIssues?: KvIssue[] }>('GET', '/sites'),
  syncAll: () => call<{ kvIssues: KvIssue[] }>('POST', '/sites/sync-all'),
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
  /** Forgot password: always the same answer, whether the e-mail has an account or not. */
  forgot: (email: string) => call<{ ok: true; minutes: number }>('POST', '/auth/forgot', { email }),
  resetValid: (token: string) => call<{ valid: boolean }>('GET', `/auth/reset?token=${encodeURIComponent(token)}`),
  reset: (token: string, password: string) => call<{ user: User }>('POST', '/auth/reset', { token, password }),
};

// ------------------------------------------------------------------ Stage 6: Query API (/stats)

export type RangeKey = 'today' | '7d' | '30d';
export interface Range { key: RangeKey; tz: string; from: string; to: string; days: number; hourly: boolean; prev: { from: string; to: string } }
export interface Bar { label: string; value: number }
export interface Overview {
  range: Range;
  kpis: {
    visitors: number;
    visitorsEstimated: boolean;
    sessions: number;
    pageviews: number;
    bounceRate: number | null;
    previous: { visitors: number; sessions: number; pageviews: number; bounceRate: number | null };
  };
  series: { bucket: string; label: string; visitors: number; sessions: number; pageviews: number }[];
  sources: { name: string; sessions: number }[];
  referrers: Bar[];
  pages: Bar[];
  countries: Bar[];
  devices: Bar[];
  browsers: Bar[];
  capture: { received: number; expected: number; rate: number | null };
  drops: { reason: string; hits: number; detail: string; last: number }[];
}
export interface Live {
  now: number;
  active: number;
  minutes: { minute: number; visitors: number }[];
  events: { name: string; path: string; country: string; at: number }[];
}
export interface EventsReport {
  range: Range;
  events: { name: string; kind: 'automatic' | 'custom'; events: number; last: number; firstSeen: number; isNew: boolean }[];
  highCardinality: { name: string; key: string; distinctValues: number }[];
}
export interface DropsReport {
  range: Range;
  rows: { reason: string; detail: string; country: string; asn: number; hits: number; last: number }[];
}

/** A saved export (Reports page). Kept 90 days, then deleted automatically. */
export interface Report {
  id: string;
  range: RangeKey;
  from: string;
  to: string;
  timezone: string;
  filename: string;
  rows: number;
  bytes: number;
  createdAt: string;
  expiresAt: string;
}

export const reports = {
  list: (id: number) => call<{ keepDays: number; max: number; exports: Report[] }>('GET', `/sites/${id}/exports`),
  create: (id: number, range: RangeKey) => call<{ export: Report }>('POST', `/sites/${id}/exports`, { range }),
  remove: (id: number, reportId: string) => call<{ ok: true }>('DELETE', `/sites/${id}/exports/${reportId}`),
  downloadUrl: (id: number, reportId: string) => `/api/v1/sites/${id}/exports/${reportId}/download`,
};

/** Starts a browser download of a saved report (same-origin GET, the session cookie goes along). */
export function startDownload(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const stats = {
  overview: (id: number, range: RangeKey) => call<Overview>('GET', `/sites/${id}/stats/overview?range=${range}`),
  live: (id: number) => call<Live>('GET', `/sites/${id}/stats/live`),
  events: (id: number, range: RangeKey) => call<EventsReport>('GET', `/sites/${id}/stats/events?range=${range}`),
  drops: (id: number, range: RangeKey) => call<DropsReport>('GET', `/sites/${id}/stats/drops?range=${range}`),
  allowHost: (id: number, host: string) => call<{ site: Site; sync: Sync }>('POST', `/sites/${id}/allowed-hosts`, { host }),
  exportUrl: (id: number, range: RangeKey) => `/api/v1/sites/${id}/export.csv?range=${range}`,
};
