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
  /**
   * Retention of a new site, and the longest a site can choose (Phase 3: enforced by the nightly pruning
   * job, in weekly batches). The ClickHouse table TTL (425 days) stays as a safety net above it.
   */
  retentionDays: number;
  sessionDays: number;
  scrypt: ScryptCost;
  /** Tests / local development only: the active verifier may fetch private addresses. */
  verifierAllowPrivate: boolean;
  /**
   * Refuse a setup when nothing answers at the domain (decision 25). On in production (configFromEnv);
   * off by default so tests do not reach the internet. TW_SKIP_DOMAIN_CHECK=1 turns it off.
   */
  checkDomainReachable: boolean;
  /**
   * Who may sign up. null = anyone (the default, decision 23). Optional TW_SIGNUP_ALLOWLIST limits it to
   * these e-mails, or e-mails of a listed domain written as "@example.com" (a private test server).
   */
  signupAllowlist: string[] | null;
  /**
   * New accounts must open an e-mailed link before they can log in. Needs a working mailer: without one
   * (TW_BREVO_API_KEY / TW_RESEND_API_KEY not set) new accounts are verified at once, or nobody could
   * sign up. On by default in production (configFromEnv); TW_EMAIL_VERIFICATION=off turns it off.
   */
  requireEmailVerification: boolean;
  /** Where the dashboard is reachable: links in e-mails (password reset) point here. */
  publicUrl: string;
  /** Shared secret for the scheduled KV reconcile call (Vercel Cron sends it as a Bearer token). Null: route off. */
  cronSecret: string | null;
}

/** Retention a customer can choose for a site, in days (never above ApiConfig.retentionDays). */
export const RETENTION_CHOICES = [30, 90, 180, 395] as const;

/** "a@x.com, @team.com" -> ['a@x.com', '@team.com']; empty or "*" -> null (open to everyone). */
export function parseAllowlist(raw: string | undefined): string[] | null {
  const list = (raw ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length && !list.includes('*') ? list : null;
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
  checkDomainReachable: false,
  signupAllowlist: null,
  requireEmailVerification: false,
  publicUrl: 'http://localhost:8788',
  cronSecret: null,
  ...over,
});
