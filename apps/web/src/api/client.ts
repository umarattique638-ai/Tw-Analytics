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
  /** Days collected data is kept; older data is deleted by the nightly clean-up, in weekly batches (Settings). */
  retentionDays: number;
  publicKey: string | null;
  keys: Key[];
  /** Is it still sending data (decision 28); only in the site list. */
  health?: HealthStatus;
}
export type HealthStatus = 'healthy' | 'quiet' | 'broken' | 'unknown' | 'paused';
/** GET /sites/:id/health. `reason` and `failedCheck` only when broken. */
export interface SiteHealth {
  status: HealthStatus;
  reason: string | null;
  failedCheck: string | null;
  failedLabel: string | null;
  since: string | null;
  checkedAt: string | null;
  lastEventAt: string | null;
  /** Hours without data when it was last checked. */
  silentForHours: number | null;
  /** How long this site may stay silent before it is checked (its habit). */
  silentHours: number | null;
}
export type Role = 'owner' | 'admin' | 'viewer';
export interface Me {
  user: User;
  tenant: { id: string; plan: string; region: string };
  role: Role;
  retention: { choices: number[]; max: number; default: number };
}
export interface Sync { ok: boolean; pending?: boolean; message?: string }
/** A site whose Cloudflare KV entries do not match yet (decision 18). Retried automatically. */
export interface KvIssue { siteId: number; domain: string; deleted: boolean; error: string; since: string; attempts: number }
export interface Snippet {
  id: string;
  group: 'script-tag' | 'custom-event';
  label: string;
  language: string;
  code: string;
  note?: string;
  availability: 'now';
}
/**
 * A site being set up (decision 25). It is NOT a site yet: nothing is stored for it until every install check
 * passed. One at a time per workspace; it expires by itself at `expiresAt`.
 */
export interface Setup {
  domain: string;
  timezone: string;
  allowedHosts: string[];
  publicKey: string;
  startedAt: string;
  expiresAt: string;
  snippets: Snippet[];
}
export interface Check { id: string; label: string; status: 'pass' | 'fail' | 'skip'; message: string }
/** The install check. `site` is the saved site, present once every step passed. */
export interface VerifyResult { url: string; ok: boolean; checks: Check[]; verifiedAt: string | null; site: Site | null }

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

/** Fired when the server says the session is gone (expired, signed out elsewhere): the app goes to Log in. */
export const SESSION_ENDED = 'tw:session-ended';

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
  if (!res.ok) {
    // Only a lost session, not "wrong password" (also 401) on Log in or Delete account.
    if (res.status === 401 && data.error === 'unauthorized') window.dispatchEvent(new Event(SESSION_ENDED));
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export const api = {
  /** Public server facts (no login): the collector address and the password rule. */
  meta: () => call<{ collector: string; region: string; passwordMin: number }>('GET', '/meta'),
  me: () => call<Me>('GET', '/me'),
  /** `verificationRequired`: no session yet, the account logs in after the e-mailed link is opened. */
  signup: (name: string, email: string, password: string) =>
    call<{ user: User; verificationRequired?: boolean; email?: string; sent?: boolean; hours?: number }>('POST', '/auth/signup', { name, email, password }),
  /** The link from the sign-up e-mail: proves the address. It does not sign in (the user logs in next). */
  verifyEmail: (token: string) => call<{ ok: true; email: string }>('POST', '/auth/verify-email', { token }),
  resendVerification: (email: string, password: string) =>
    call<{ ok: true; alreadyVerified?: boolean; email?: string; hours?: number }>('POST', '/auth/resend-verification', { email, password }),
  login: (email: string, password: string) => call<{ user: User }>('POST', '/auth/login', { email, password }),
  logout: () => call<{ ok: true }>('POST', '/auth/logout'),
  sites: () => call<{ sites: Site[]; kvIssues?: KvIssue[] }>('GET', '/sites'),
  syncAll: () => call<{ kvIssues: KvIssue[] }>('POST', '/sites/sync-all'),
  preview: (domain: string) => call<{ domain: string; allowedHosts: string[] }>('GET', `/sites/preview?domain=${encodeURIComponent(domain)}`),
  setup: () => call<{ setup: Setup | null }>('GET', '/setup'),
  startSetup: (domain: string, timezone: string) => call<{ setup: Setup; resumed?: boolean }>('POST', '/setup', { domain, timezone }),
  verifySetup: (url?: string) => call<VerifyResult>('POST', '/setup/verify', { url }),
  cancelSetup: () => call<{ ok: true }>('DELETE', '/setup'),
  site: (id: number) => call<{ site: Site; snippets: Snippet[] }>('GET', `/sites/${id}`),
  updateSite: (id: number, patch: { timezone?: string; status?: 'active' | 'paused'; retentionDays?: number }) => call<{ site: Site; sync: Sync }>('PATCH', `/sites/${id}`, patch),
  /** `eraseData`: delete everything collected for the site too, for good (owners and admins). */
  deleteSite: (id: number, eraseData = false) => call<{ ok: true; sync: Sync; erased: boolean }>('DELETE', `/sites/${id}`, { eraseData }),
  sync: (id: number) => call<{ sync: Sync }>('POST', `/sites/${id}/sync`),
  health: (id: number) => call<{ health: SiteHealth }>('GET', `/sites/${id}/health`),
  checkHealth: (id: number) => call<{ health: SiteHealth }>('POST', `/sites/${id}/health/check`),
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
};

// ------------------------------------------------------------------ Phase 3: activity log, export, delete

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actor: { kind: 'user' | 'system'; name: string; you: boolean };
  siteId: number | null;
  domain: string | null;
  summary: string;
}

export interface Erasure {
  id: string;
  sites: number;
  trackingStopped: boolean;
  dataDeleteSent: boolean;
  finishesWithinDays: number;
}

export const account = {
  activity: (options: { before?: string | null; site?: number | null } = {}) => {
    const q = new URLSearchParams({ limit: '50' });
    if (options.before) q.set('before', options.before);
    if (options.site) q.set('site', String(options.site));
    return call<{ keepDays: number; entries: AuditEntry[]; next: string | null }>('GET', `/audit?${q}`);
  },
  /** Fetches the export first, so an error is shown as a message instead of being saved as the file. */
  async download(): Promise<void> {
    let res: Response;
    try {
      res = await fetch('/api/v1/account/export', { credentials: 'same-origin' });
    } catch {
      throw new ApiError(0, 'network', 'Cannot reach the TailWatch API. Is it running?');
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new ApiError(res.status, data.error ?? 'error', data.message ?? `Download failed (${res.status}).`);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'tailwatch-export.json';
    const url = URL.createObjectURL(await res.blob());
    try {
      startDownload(url, name);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  },
  remove: (password: string, confirm: string) => call<{ ok: true; erasure: Erasure }>('POST', '/account/delete', { password, confirm }),
};
