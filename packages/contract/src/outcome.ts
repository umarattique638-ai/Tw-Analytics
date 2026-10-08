import type { PropValue } from './types';

export interface SiteConfig {
  id: number;
  publicKey: string;
  allowedHosts: string[];
  live: boolean;
  region: 'in' | 'in-eu';
  /** Server-only secret used to derive daily visitor salts. Never expose to the browser. */
  identitySecret?: string;
}

export interface EdgeMeta {
  receivedAt: number;
  site: SiteConfig | null;
  country?: string;
  asn?: number;
  asOrganization?: string;
  /** The request arrived over HTTPS (Stage 7: client hints only exist on secure connections). */
  https?: boolean;
}

export interface HeaderReader {
  get(name: string): string | null;
}

export type DropReason =
  | 'not_found'
  | 'hostname'
  | 'bot'
  | 'verification_agent'
  | 'gpc'
  | 'identity_unavailable';

export type NoopReason = 'duplicate';

/**
 * Request headers the consumer's headless scoring needs (STAGE-1 A6). Low-entropy only, used for the
 * verdict and never stored as a column. Present on every event from a Stage 7+ collector; absent on
 * older queued messages (the consumer then skips the header-based signals).
 */
export interface ClientHints {
  /** Sec-CH-UA, e.g. `"Chromium";v="141", "Google Chrome";v="141"`. */
  chUa?: string;
  /** Sec-CH-UA-Platform, e.g. `"Windows"`. */
  chPlatform?: string;
  /** Sec-CH-UA-Mobile: `?0` / `?1`. */
  chMobile?: string;
  /** An Accept-Language header was sent (every real browser sends one). */
  lang: boolean;
  /** The hit reached us over HTTPS (browsers send Sec-CH-UA only on secure connections). */
  https: boolean;
}

export interface ValidatedEvent {
  siteId: number;
  name: string;
  url: string;
  host: string;
  path: string;
  route?: string;
  referrer?: string;
  seq: number;
  createdAt: number;
  occurredAt: number;
  receivedAt: number;
  backfill: boolean;
  trackerVersion: number;
  engagementMs?: number;
  width?: number;
  insertId?: string;
  flags: number;
  props: Record<string, PropValue>;
  warnings: string[];
  extra: Record<string, unknown>;
  userAgent?: string;
  country?: string;
  asn?: number;
  asOrganization?: string;
  hints?: ClientHints;
}

export interface AcceptOutcome {
  kind: 'accept';
  status: 204;
  event: ValidatedEvent;
}

export interface DropOutcome {
  kind: 'drop';
  status: 204;
  reason: DropReason;
  detail?: string;
  headers: {
    'x-tw-dropped': DropReason;
  };
  siteId?: number;
  country?: string;
  asn?: number;
}

export interface DuplicateOutcome {
  kind: 'duplicate';
  status: 204;
  reason: 'duplicate';
  siteId?: number;
  insertId?: string;
}

export interface MalformedOutcome {
  kind: 'reject';
  status: 400;
  reason: 'malformed';
  error: string;
}

export interface OversizedOutcome {
  kind: 'reject';
  status: 413;
  reason: 'oversized';
  error: string;
}

export interface RateLimitOutcome {
  kind: 'rate_limit';
  status: 429;
  reason: 'rate_limited';
  error: string;
  headers: {
    'Retry-After': string;
  };
}

export interface QuotaLimitedOutcome {
  kind: 'quota_limited';
  status: 200;
  reason: 'quota_limited';
  quotaLimited: string[];
}

export type Outcome =
  | AcceptOutcome
  | DropOutcome
  | DuplicateOutcome
  | MalformedOutcome
  | OversizedOutcome
  | RateLimitOutcome
  | QuotaLimitedOutcome;