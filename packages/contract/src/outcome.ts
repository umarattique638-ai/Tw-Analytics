import type { PropValue } from './types';

export interface SiteConfig {
  id: number;
  publicKey: string;
  allowedHosts: string[];
  live: boolean;
  region: 'in' | 'in-eu';
}

export interface EdgeMeta {
  receivedAt: number;
  site: SiteConfig | null;
  country?: string;
  asn?: number;
  asOrganization?: string;
}

export interface HeaderReader {
  get(name: string): string | null;
}

export type DropReason =
  | 'not_found'
  | 'hostname'
  | 'bot'
  | 'verification_agent'
  | 'gpc';

export type NoopReason = 'duplicate';

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