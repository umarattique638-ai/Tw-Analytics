import type { ObjectId } from 'mongodb';

/** Documents exactly as stored in tailwatch_control (infra/mongodb/control-plane.schema.json). */
export interface UserDoc {
  _id: ObjectId;
  email: string;
  emailNormalized: string;
  name?: string;
  passwordHash?: string;
  /**
   * When the owner of the address opened the verification link. null = not verified yet: the account
   * cannot log in. Missing = an account made before e-mail verification existed (treated as verified).
   */
  emailVerifiedAt?: Date | null;
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

/** An e-mail verification link (same shape as a reset: only the SHA-256 of the token is stored, one use). */
export type EmailVerificationDoc = PasswordResetDoc;

/**
 * A site whose Cloudflare KV entries may not match MongoDB yet (a KV write failed). One per site; the
 * reconciler re-syncs the site from MongoDB and removes it. Shown to the customer until it is gone.
 */
export interface KvIssueDoc {
  _id: number;
  tenantId: ObjectId;
  error: string;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export type SitePatch = Partial<Pick<SiteDoc, 'domain' | 'timezone' | 'status' | 'verifiedAt' | 'keys' | 'allowedHosts' | 'identitySecret' | 'retentionDays'>>;

/**
 * Is a site still sending data (decision 28)? One per site, written by the health check (services/health.ts).
 *   healthy  data arrived recently (for this site's usual rhythm)
 *   quiet    no data for a while, but the install check passes: simply no visitors
 *   broken   no data for a while AND the install check fails (`failedCheck`, `reason`)
 * `alertedAt` is set once the "stopped sending data" e-mail went out (cleared by the recovery e-mail).
 */
export interface SiteHealthDoc {
  _id: number;
  tenantId: ObjectId;
  status: 'healthy' | 'quiet' | 'broken';
  reason: string | null;
  failedCheck: string | null;
  /** failedCheck "moved": the host the visits now come from (decision 29). */
  movedTo?: string | null;
  since: Date;
  checkedAt: Date;
  lastEventAt: Date | null;
  silentHours: number;
  alertedAt: Date | null;
  /** When the last "unusual traffic" e-mail went out (decision 31): at most one a day. */
  spikeAlertedAt?: Date | null;
}

/** Everything the activity log can say happened. `system` entries are made by the nightly jobs. */
export const AUDIT_ACTIONS = [
  'account.created',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_reset',
  'auth.email_verified',
  'site.created',
  'site.restored',
  'site.paused',
  'site.resumed',
  'site.domain_changed',
  'site.timezone_changed',
  'site.retention_changed',
  'site.deleted',
  'site.stopped_sending',
  'site.sending_again',
  'site.traffic_spike',
  'key.created',
  'key.revoked',
  'host.allowed',
  'report.created',
  'report.deleted',
  'account.exported',
  'data.pruned',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * One line of a workspace's activity log (Phase 3 "customer-facing audit log"): who did what, when.
 * No IP address and no user agent are stored (data minimisation, PLAN 10). Deleted after AUDIT_KEEP_DAYS
 * (TTL index), and with the account.
 */
export interface AuditDoc {
  _id: ObjectId;
  tenantId: ObjectId;
  at: Date;
  actorKind: 'user' | 'system';
  /** The user who did it; null for the nightly jobs. */
  actorId: ObjectId | null;
  /** Name at that moment (the log stays readable if the name changes later). */
  actorName: string;
  action: AuditAction;
  siteId: number | null;
  /** One human sentence, e.g. "Revoked key tw_pub_ab12… of shop.example.com". */
  summary: string;
  expiresAt: Date;
}

/**
 * An account deletion in progress (export-then-erase, PLAN 10.6). The account itself (user, workspace,
 * sites, reports, activity log) is removed from MongoDB at once; this record drives what is left:
 * Cloudflare KV keys, then the ClickHouse rows of the sites, until a count proves there is nothing left.
 * When done it is kept as the receipt, without the e-mail address.
 */
export interface ErasureDoc {
  /** The deleted workspace's id. */
  _id: ObjectId;
  siteIds: number[];
  publicKeys: string[];
  /** For the "erasure finished" e-mail only; removed when the erasure completes. */
  email: string | null;
  name: string | null;
  requestedAt: Date;
  status: 'pending' | 'completed';
  kvDoneAt: Date | null;
  /** Last time the ClickHouse delete was sent (it runs in the background on the server). */
  dataDeleteSentAt: Date | null;
  /** First check that found no rows left, after the settle time (late queue retries could still land). */
  dataVerifiedAt: Date | null;
  /** Rows found per table at the first check, for the receipt. */
  rowsFound: { events: number; sessions: number; dropped_hits: number; rollup_15m_pages: number } | null;
  /** Rows that came back after completion (late queue retries / replays) and were deleted by the watch. */
  rowsAfterCompletion: number;
  attempts: number;
  lastError: string | null;
  completedAt: Date | null;
  updatedAt: Date;
}
export type ErasurePatch = Partial<Omit<ErasureDoc, '_id'>>;

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
  /** Sites of a tenant that are not deleted (or all of them, for the account export). */
  sitesOf(tenantId: ObjectId, includeDeleted?: boolean): Promise<SiteDoc[]>;
  site(tenantId: ObjectId, id: number): Promise<SiteDoc | null>;
  /** A site of this tenant with this domain, deleted ones included (re-adding restores it). */
  siteByDomain(tenantId: ObjectId, domain: string): Promise<SiteDoc | null>;
  /** Optimistic update: applies only if the document still has `expectedUpdatedAt`. */
  updateSite(tenantId: ObjectId, id: number, expectedUpdatedAt: Date, patch: SitePatch, now: Date): Promise<SiteDoc | null>;
  /** Every site, any tenant (KV resync). */
  allSites(): Promise<SiteDoc[]>;
  /** One site by id, any tenant, deleted ones included (the KV reconciler). */
  siteById(id: number): Promise<SiteDoc | null>;
  /** Removes a site document for good (sites saved before decision 25 that never got verified). */
  removeSite(id: number): Promise<boolean>;

  /** Remembers that a site's KV entries may be wrong (upsert, keeps the first createdAt). */
  recordKvIssue(siteId: number, tenantId: ObjectId, error: string, now: Date): Promise<void>;
  /** Outstanding KV issues: of one tenant, or all (oldest first). */
  kvIssues(tenantId: ObjectId | null, limit: number): Promise<KvIssueDoc[]>;
  clearKvIssue(siteId: number): Promise<void>;

  /** Health of these sites (missing: never checked). */
  healthOf(siteIds: number[]): Promise<SiteHealthDoc[]>;
  /** Replaces a site's health document (upsert). */
  saveHealth(doc: SiteHealthDoc): Promise<void>;

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

  createEmailVerification(doc: EmailVerificationDoc): Promise<void>;
  /** Marks the link used and returns it; null if it was already used or has expired (one use only, race-safe). */
  useEmailVerification(id: string, now: Date): Promise<EmailVerificationDoc | null>;
  /** Every outstanding verification link of a user is cancelled (after verifying, or when a new one is sent). */
  deleteEmailVerificationsOf(userId: ObjectId): Promise<void>;
  /** The address is proven: the account can log in. */
  markEmailVerified(userId: ObjectId, now: Date): Promise<void>;

  insertExport(doc: ExportDoc): Promise<void>;
  /** Newest first, expired ones left out (the TTL monitor runs about once a minute). */
  /** The list only: without the CSV itself (download reads one report with exportById). */
  exportsOf(tenantId: ObjectId, siteId: number, now: Date, limit: number): Promise<Omit<ExportDoc, 'csv'>[]>;
  exportById(tenantId: ObjectId, siteId: number, id: ObjectId, now: Date): Promise<ExportDoc | null>;
  countExports(tenantId: ObjectId, siteId: number, now: Date): Promise<number>;
  /** True if it existed. */
  deleteExport(tenantId: ObjectId, siteId: number, id: ObjectId): Promise<boolean>;

  insertAudit(doc: AuditDoc): Promise<void>;
  /** Newest first. `before` continues a page: entries strictly older than that (at, _id). */
  auditOf(tenantId: ObjectId, options: { limit: number; siteId?: number; before?: { at: Date; id: ObjectId } }): Promise<AuditDoc[]>;

  /** Users of a workspace (deleting an account removes all of them that belong to no other workspace). */
  membersOf(tenantId: ObjectId): Promise<MembershipDoc[]>;
  /**
   * Account deletion, all or nothing (a MongoDB transaction): the workspace's sites are read INSIDE the
   * transaction and their ids and keys become the erasure record's siteIds / publicKeys (so a key added
   * in another tab meanwhile is either in the record or makes the transaction retry); the record is
   * written and the workspace's users (those without another workspace), memberships, login sessions,
   * reset links, sites, reports, activity log, KV outbox entries and the workspace itself are deleted.
   * Returns the record as written.
   */
  eraseAccount(erasure: Omit<ErasureDoc, 'siteIds' | 'publicKeys'>, userIds: ObjectId[]): Promise<ErasureDoc>;
  /**
   * Erasures to work on: every pending one, and completed ones still watched (completed after
   * `watchSince`: late rows and re-written KV keys are removed again). Least recently worked on first.
   */
  activeErasures(watchSince: Date, limit: number): Promise<ErasureDoc[]>;
  /**
   * "Delete the site and all its data now", all or nothing (a MongoDB transaction): the site (read inside
   * the transaction, so its keys are complete) becomes an erasure record that the nightly job finishes and
   * watches like an account erasure; the site document, its saved reports and its KV outbox entry are
   * deleted. Null if the site is not there (another tab deleted it).
   */
  eraseSite(erasure: Omit<ErasureDoc, 'siteIds' | 'publicKeys'>, tenantId: ObjectId, siteId: number): Promise<ErasureDoc | null>;
  /** Sites still stored for a workspace (a request that raced the deletion); deleted and returned. */
  deleteSitesOf(tenantId: ObjectId): Promise<SiteDoc[]>;
  erasureById(id: ObjectId): Promise<ErasureDoc | null>;
  /** Removes erasure records completed before `before` (their watch is over); returns how many. */
  deleteErasuresCompletedBefore(before: Date): Promise<number>;
  updateErasure(id: ObjectId, patch: ErasurePatch): Promise<void>;

  close(): Promise<void>;
}
