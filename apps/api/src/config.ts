import type { ScryptCost } from './passwords';
import { PRODUCTION_COST } from './passwords';

export interface ApiConfig {
  /** Public base URL of the collector (serves /tw.js and /e). Goes into every snippet. */
  collectorUrl: string;
  /** Region of this deployment; new tenants and sites get it. Must match the collector's REGION. */
  region: 'in' | 'in-eu';
  /** Secure cookies (https). Off only for http://localhost development. */
  secureCookies: boolean;
  /** Site ids up to this number are reserved for hand-made sites (the owner's test sites 1 and 2). */
  siteIdFloor: number;
  /** Raw-event retention promised to a new site (PLAN 10: a Phase 3 deliverable enforces it per plan). */
  retentionDays: number;
  sessionDays: number;
  scrypt: ScryptCost;
  /** Tests / local development only: the active verifier may fetch private addresses. */
  verifierAllowPrivate: boolean;
  /**
   * Who may sign up. null = anyone (local development). On a public server (TW_SIGNUP_ALLOWLIST) only
   * these e-mails, or e-mails of a listed domain written as "@example.com". Until Phase 3 (teams,
   * invites, quotas) a public dashboard must not be open to everyone.
   */
  signupAllowlist: string[] | null;
}

/** "a@x.com, @team.com" -> ['a@x.com', '@team.com']; empty -> null (open). */
export function parseAllowlist(raw: string | undefined): string[] | null {
  const list = (raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : null;
}

export function signupAllowed(allowlist: string[] | null, email: string): boolean {
  if (!allowlist) return true;
  const e = email.trim().toLowerCase();
  return allowlist.some((entry) => (entry.startsWith('@') ? e.endsWith(entry) : e === entry));
}

export const defaultConfig = (over: Partial<ApiConfig> = {}): ApiConfig => ({
  collectorUrl: 'https://tailwatch-collector.example.workers.dev',
  region: 'in',
  secureCookies: true,
  siteIdFloor: 100,
  retentionDays: 395,
  sessionDays: 30,
  scrypt: PRODUCTION_COST,
  verifierAllowPrivate: false,
  signupAllowlist: null,
  ...over,
});
