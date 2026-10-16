import type { ObjectId } from 'mongodb';

export interface KeyDoc {
  id: string;
  publicKey: string;
  createdAt: Date;
  revokedAt?: Date | null;
  status: 'active' | 'revoked';
}

export interface SiteDoc {
  /** Numeric site id, shared with ClickHouse events.site_id. */
  _id: number;
  tenantId: ObjectId;
  domain: string;
  timezone: string;
  allowedHosts: string[];
  retentionDays: number;
  status: 'active' | 'paused' | 'deleted';
  region: 'in' | 'in-eu';
  verifiedAt: Date | null;
  identitySecret: string;
  keys: KeyDoc[];
  createdAt: Date;
  updatedAt: Date;
}

export type SitePatch = Partial<Pick<SiteDoc, 'domain' | 'timezone' | 'status' | 'verifiedAt' | 'keys' | 'allowedHosts' | 'identitySecret' | 'retentionDays'>>;
