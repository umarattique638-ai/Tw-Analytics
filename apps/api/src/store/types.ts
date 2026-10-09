import type { ObjectId } from 'mongodb';

/** Documents exactly as stored in tailwatch_control (infra/mongodb/control-plane.schema.json). */
export interface UserDoc {
  _id: ObjectId;
  email: string;
  emailNormalized: string;
  name?: string;
  passwordHash?: string;
  createdAt: Date;
  updatedAt?: Date;
  status: 'active' | 'disabled' | 'deleted';
}

export interface TenantDoc {
  _id: ObjectId;
  createdAt: Date;
  updatedAt?: Date;
  status: 'active' | 'suspended' | 'deleted';
  plan: string;
  region: 'in' | 'in-eu';
}

export interface MembershipDoc {
  _id: ObjectId;
  tenantId: ObjectId;
  userId: ObjectId;
  role: 'owner' | 'admin' | 'viewer';
  createdAt: Date;
}

export interface SessionDoc {
  /** SHA-256 hex of the token. */
  _id: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

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

/** A CSV the user exported from Reports, kept so it can be downloaded again. Deleted 90 days after creation (TTL). */
export interface ExportDoc {
  _id: ObjectId;
  tenantId: ObjectId;
  siteId: number;
  range: 'today' | '7d' | '30d';
  /** The local dates (or hours for Today) the report covers, as the Query API resolved them. */
  from: string;
  to: string;
  timezone: string;
  filename: string;
  rows: number;
  bytes: number;
  csv: string;
  createdBy: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

/** A "forgot password" link. Only the SHA-256 of the token is stored; the token is in the e-mail. */
export interface PasswordResetDoc {
  _id: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

export type SitePatch = Partial<Pick<SiteDoc, 'timezone' | 'status' | 'verifiedAt' | 'keys' | 'allowedHosts' | 'identitySecret'>>;

/** Thrown for a unique-index violation. `field` says which rule: shown to the user as a 409. */
export class DuplicateError extends Error {
  constructor(readonly field: 'email' | 'domain' | 'publicKey' | 'other') {
    super(`duplicate ${field}`);
  }
}

/**
 * The control plane's persistence port. MongoStore is the real one; MemoryStore mirrors its rules
 * (validators, unique indexes, transactions) for fast tests. The API never talks to MongoDB directly.
 */
export interface ControlStore {
  /** user + tenant + owner membership, all or nothing (a MongoDB transaction). */
  createAccount(input: { user: UserDoc; tenant: TenantDoc; membership: MembershipDoc }): Promise<void>;
  userByEmail(emailNormalized: string): Promise<UserDoc | null>;
  userById(id: ObjectId): Promise<UserDoc | null>;
  membershipsOf(userId: ObjectId): Promise<MembershipDoc[]>;
  tenantById(id: ObjectId): Promise<TenantDoc | null>;

  createSession(session: SessionDoc): Promise<void>;
  sessionById(id: string): Promise<SessionDoc | null>;
  deleteSession(id: string): Promise<void>;

  /** Next numeric site id, never below `floor` (ids up to the floor are reserved for manual sites). */
  nextSiteId(floor: number): Promise<number>;
  insertSite(site: SiteDoc): Promise<void>;
  /** Sites of a tenant that are not deleted. */
  sitesOf(tenantId: ObjectId): Promise<SiteDoc[]>;
  site(tenantId: ObjectId, id: number): Promise<SiteDoc | null>;
  /** A site of this tenant with this domain, deleted ones included (re-adding restores it). */
  siteByDomain(tenantId: ObjectId, domain: string): Promise<SiteDoc | null>;
  /** Optimistic update: applies only if the document still has `expectedUpdatedAt`. */
  updateSite(tenantId: ObjectId, id: number, expectedUpdatedAt: Date, patch: SitePatch, now: Date): Promise<SiteDoc | null>;
  /** Every site, any tenant (KV resync). */
  allSites(): Promise<SiteDoc[]>;

  /** New password: replaces the hash and ends every session of the user (all devices). */
  setPassword(userId: ObjectId, passwordHash: string, now: Date): Promise<void>;
  deleteSessionsOf(userId: ObjectId): Promise<void>;
  createPasswordReset(reset: PasswordResetDoc): Promise<void>;
  /** A reset that is unused and not expired at `now`, or null. */
  passwordReset(id: string, now: Date): Promise<PasswordResetDoc | null>;
  /** Marks the reset used; null if it was already used or has expired (one use only, race-safe). */
  usePasswordReset(id: string, now: Date): Promise<PasswordResetDoc | null>;
  /** Every outstanding reset of a user is cancelled (after a successful reset). */
  deletePasswordResetsOf(userId: ObjectId): Promise<void>;

  insertExport(doc: ExportDoc): Promise<void>;
  /** Newest first, expired ones left out (the TTL monitor runs about once a minute). */
  exportsOf(tenantId: ObjectId, siteId: number, now: Date, limit: number): Promise<ExportDoc[]>;
  exportById(tenantId: ObjectId, siteId: number, id: ObjectId, now: Date): Promise<ExportDoc | null>;
  countExports(tenantId: ObjectId, siteId: number, now: Date): Promise<number>;
  /** True if it existed. */
  deleteExport(tenantId: ObjectId, siteId: number, id: ObjectId): Promise<boolean>;

  close(): Promise<void>;
}
