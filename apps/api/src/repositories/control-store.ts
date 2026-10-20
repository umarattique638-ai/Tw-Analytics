import type { ObjectId } from 'mongodb';
import type { AuditDoc } from '../models/audit.model';
import type { PasswordResetDoc, EmailVerificationDoc } from '../models/auth-token.model';
import type { ErasureDoc, ErasurePatch } from '../models/erasure.model';
import type { ExportDoc } from '../models/export.model';
import type { KvIssueDoc } from '../models/kv-issue.model';
import type { SessionDoc } from '../models/session.model';
import type { SiteHealthDoc } from '../models/site-health.model';
import type { SiteDoc, SitePatch } from '../models/site.model';
import type { TenantDoc, MembershipDoc } from '../models/tenant.model';
import type { UserDoc } from '../models/user.model';

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

  // Super admin (/admin): every workspace at once.
  /** Every workspace, newest first. */
  allTenants(): Promise<TenantDoc[]>;
  /** Every membership (who is in which workspace, with which role). */
  allMemberships(): Promise<MembershipDoc[]>;
  /** These users (missing ids are left out). */
  usersByIds(ids: ObjectId[]): Promise<UserDoc[]>;
  /** Erasures not finished yet (the nightly job is still working on them). */
  countPendingErasures(): Promise<number>;
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
