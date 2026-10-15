import { Long, MongoClient, MongoServerError } from 'mongodb';
import type { Collection, Db, ObjectId } from 'mongodb';
import { DuplicateError } from './types';
import type { AuditDoc, ControlStore, EmailVerificationDoc, ErasureDoc, ErasurePatch, ExportDoc, KvIssueDoc, MembershipDoc, PasswordResetDoc, SessionDoc, SiteDoc, SitePatch, TenantDoc, UserDoc } from './types';

/** Maps a duplicate-key error (11000) to the rule it broke. */
function duplicate(error: unknown): never {
  if (error instanceof MongoServerError && error.code === 11000) {
    const keys = Object.keys((error.keyPattern as Record<string, unknown>) ?? {});
    if (keys.includes('emailNormalized')) throw new DuplicateError('email');
    if (keys.includes('domain')) throw new DuplicateError('domain');
    if (keys.includes('keys.publicKey')) throw new DuplicateError('publicKey');
    throw new DuplicateError('other');
  }
  throw error;
}

/** Site ids are stored as int (ClickHouse UInt64 on the other side); the driver hands numbers back. */
const notDeleted = { status: { $ne: 'deleted' } } as const;

export class MongoStore implements ControlStore {
  private constructor(
    private readonly client: MongoClient,
    private readonly db: Db,
  ) {}

  static async connect(url: string, database = 'tailwatch_control'): Promise<MongoStore> {
    const client = new MongoClient(url, { serverSelectionTimeoutMS: 5_000, appName: 'tailwatch-api' });
    await client.connect();
    const store = new MongoStore(client, client.db(database));
    await store.ensureIndexes();
    return store;
  }

  /**
   * The indexes the newer collections need (exports, password_resets, email_verifications), created by the API itself so a
   * deployment works with an app user that has readWrite only (MongoDB Atlas). createIndex is idempotent
   * and cheap when the index exists. Validators come from `pnpm db:mongo` (needs an admin user).
   */
  private async ensureIndexes() {
    await Promise.all([
      this.exports.createIndex({ tenantId: 1, siteId: 1, createdAt: -1 }),
      this.exports.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.resets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.resets.createIndex({ userId: 1 }),
      this.verifications.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.verifications.createIndex({ userId: 1 }),
      this.outbox.createIndex({ tenantId: 1 }),
      this.audit.createIndex({ tenantId: 1, at: -1, _id: -1 }),
      this.audit.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.erasures.createIndex({ status: 1, updatedAt: 1 }),
    ]);
  }

  private get users(): Collection<UserDoc> {
    return this.db.collection('users');
  }
  private get tenants(): Collection<TenantDoc> {
    return this.db.collection('tenants');
  }
  private get memberships(): Collection<MembershipDoc> {
    return this.db.collection('memberships');
  }
  private get sessions(): Collection<SessionDoc> {
    return this.db.collection('sessions');
  }
  private get sites(): Collection<SiteDoc> {
    return this.db.collection('sites');
  }
  private get exports(): Collection<ExportDoc> {
    return this.db.collection('exports');
  }
  private get resets(): Collection<PasswordResetDoc> {
    return this.db.collection('password_resets');
  }
  private get verifications(): Collection<EmailVerificationDoc> {
    return this.db.collection('email_verifications');
  }
  private get outbox(): Collection<KvIssueDoc> {
    return this.db.collection('kv_outbox');
  }
  private get audit(): Collection<AuditDoc> {
    return this.db.collection('audit_log');
  }
  private get erasures(): Collection<ErasureDoc> {
    return this.db.collection('erasures');
  }

  async createAccount({ user, tenant, membership }: { user: UserDoc; tenant: TenantDoc; membership: MembershipDoc }) {
    // All or nothing: a crash between the writes must never leave a user without a tenant.
    // Transactions need a replica set (docs/TESTING.md, the single-node rs0 setup).
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        await this.users.insertOne(user, { session });
        await this.tenants.insertOne(tenant, { session });
        await this.memberships.insertOne(membership, { session });
      });
    } catch (error) {
      duplicate(error);
    } finally {
      await session.endSession();
    }
  }
  userByEmail(emailNormalized: string) {
    return this.users.findOne({ emailNormalized }, { collation: { locale: 'en', strength: 2 } });
  }
  userById(id: ObjectId) {
    return this.users.findOne({ _id: id });
  }
  membershipsOf(userId: ObjectId) {
    return this.memberships.find({ userId }).sort({ createdAt: 1 }).toArray();
  }
  tenantById(id: ObjectId) {
    return this.tenants.findOne({ _id: id });
  }

  async createSession(s: SessionDoc) {
    await this.sessions.insertOne(s);
  }
  sessionById(id: string) {
    // The TTL monitor runs about once a minute: never trust an expired document that is still there.
    return this.sessions.findOne({ _id: id, expiresAt: { $gt: new Date() } });
  }
  async deleteSession(id: string) {
    await this.sessions.deleteOne({ _id: id });
  }

  async nextSiteId(floor: number) {
    // One atomic step: value = max(value, floor) + 1, kept as a 64-bit long (the validator demands it).
    const doc = await this.db.collection<{ _id: string; value: Long }>('counters').findOneAndUpdate(
      { _id: 'site_id' },
      [{ $set: { value: { $add: [{ $max: [{ $ifNull: ['$value', Long.fromNumber(0)] }, Long.fromNumber(floor)] }, Long.fromNumber(1)] } } }],
      { upsert: true, returnDocument: 'after', writeConcern: { w: 'majority' } },
    );
    const value = doc?.value;
    if (value === undefined) throw new Error('site id counter missing');
    return typeof value === 'number' ? value : Number(value);
  }
  async insertSite(site: SiteDoc) {
    try {
      await this.sites.insertOne(site);
    } catch (error) {
      duplicate(error);
    }
  }
  sitesOf(tenantId: ObjectId, includeDeleted = false) {
    return this.sites.find(includeDeleted ? { tenantId } : { tenantId, ...notDeleted }).sort({ _id: 1 }).toArray();
  }
  site(tenantId: ObjectId, id: number) {
    return this.sites.findOne({ _id: id, tenantId, ...notDeleted });
  }
  siteByDomain(tenantId: ObjectId, domain: string) {
    return this.sites.findOne({ tenantId, domain });
  }
  async updateSite(tenantId: ObjectId, id: number, expected: Date, patch: SitePatch, now: Date) {
    try {
      return await this.sites.findOneAndUpdate(
        { _id: id, tenantId, updatedAt: expected },
        { $set: { ...patch, updatedAt: now } },
        { returnDocument: 'after' },
      );
    } catch (error) {
      return duplicate(error);
    }
  }
  allSites() {
    return this.sites.find({}).toArray();
  }
  siteById(id: number) {
    return this.sites.findOne({ _id: id });
  }

  async recordKvIssue(siteId: number, tenantId: ObjectId, error: string, now: Date) {
    await this.outbox.updateOne(
      { _id: siteId },
      { $set: { tenantId, error: error.slice(0, 500), updatedAt: now }, $inc: { attempts: 1 }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
  }
  kvIssues(tenantId: ObjectId | null, limit: number) {
    return this.outbox.find(tenantId ? { tenantId } : {}).sort({ createdAt: 1 }).limit(limit).toArray();
  }
  async clearKvIssue(siteId: number) {
    await this.outbox.deleteOne({ _id: siteId });
  }

  async setPassword(userId: ObjectId, passwordHash: string, now: Date) {
    await this.users.updateOne({ _id: userId }, { $set: { passwordHash, updatedAt: now } });
  }
  async deleteSessionsOf(userId: ObjectId) {
    await this.sessions.deleteMany({ userId });
  }
  async createPasswordReset(reset: PasswordResetDoc) {
    await this.resets.insertOne(reset);
  }
  passwordReset(id: string, now: Date) {
    return this.resets.findOne({ _id: id, usedAt: null, expiresAt: { $gt: now } });
  }
  usePasswordReset(id: string, now: Date) {
    return this.resets.findOneAndUpdate({ _id: id, usedAt: null, expiresAt: { $gt: now } }, { $set: { usedAt: now } }, { returnDocument: 'after' });
  }
  async deletePasswordResetsOf(userId: ObjectId) {
    await this.resets.deleteMany({ userId });
  }
  async createEmailVerification(doc: EmailVerificationDoc) {
    await this.verifications.insertOne(doc);
  }
  useEmailVerification(id: string, now: Date) {
    return this.verifications.findOneAndUpdate({ _id: id, usedAt: null, expiresAt: { $gt: now } }, { $set: { usedAt: now } }, { returnDocument: 'after' });
  }
  async deleteEmailVerificationsOf(userId: ObjectId) {
    await this.verifications.deleteMany({ userId });
  }
  async markEmailVerified(userId: ObjectId, now: Date) {
    await this.users.updateOne({ _id: userId }, { $set: { emailVerifiedAt: now, updatedAt: now } });
  }

  async insertExport(doc: ExportDoc) {
    await this.exports.insertOne(doc);
  }
  exportsOf(tenantId: ObjectId, siteId: number, now: Date, limit: number) {
    return this.exports
      .find({ tenantId, siteId, expiresAt: { $gt: now } }, { projection: { csv: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray() as Promise<Omit<ExportDoc, 'csv'>[]>;
  }
  exportById(tenantId: ObjectId, siteId: number, id: ObjectId, now: Date) {
    return this.exports.findOne({ _id: id, tenantId, siteId, expiresAt: { $gt: now } });
  }
  countExports(tenantId: ObjectId, siteId: number, now: Date) {
    return this.exports.countDocuments({ tenantId, siteId, expiresAt: { $gt: now } });
  }
  async deleteExport(tenantId: ObjectId, siteId: number, id: ObjectId) {
    return (await this.exports.deleteOne({ _id: id, tenantId, siteId })).deletedCount === 1;
  }
  async insertAudit(doc: AuditDoc) {
    await this.audit.insertOne(doc);
  }
  auditOf(tenantId: ObjectId, o: { limit: number; siteId?: number; before?: { at: Date; id: ObjectId } }) {
    const filter: Record<string, unknown> = { tenantId };
    if (o.siteId !== undefined) filter.siteId = o.siteId;
    if (o.before) filter.$or = [{ at: { $lt: o.before.at } }, { at: o.before.at, _id: { $lt: o.before.id } }];
    return this.audit.find(filter).sort({ at: -1, _id: -1 }).limit(o.limit).toArray();
  }

  membersOf(tenantId: ObjectId) {
    return this.memberships.find({ tenantId }).toArray();
  }
  async eraseAccount(input: Omit<ErasureDoc, 'siteIds' | 'publicKeys'>, userIds: ObjectId[]) {
    const session = this.client.startSession();
    let erasure = null as ErasureDoc | null;
    try {
      await session.withTransaction(async () => {
        const t = input._id;
        // Read inside the transaction: a site or key changed by another request meanwhile either is in this
        // snapshot or conflicts with the deleteMany below (the transaction is then retried).
        const sites = await this.sites.find({ tenantId: t }, { session }).toArray();
        erasure = { ...input, siteIds: sites.map((s) => s._id), publicKeys: sites.flatMap((s) => s.keys.map((k) => k.publicKey)) };
        await this.erasures.insertOne(erasure, { session });
        // A user who also belongs to another workspace keeps the account (only this membership goes).
        const elsewhere = await this.memberships.distinct('userId', { userId: { $in: userIds }, tenantId: { $ne: t } }, { session });
        const gone = userIds.filter((u) => !elsewhere.some((e) => e.equals(u)));
        await this.memberships.deleteMany({ tenantId: t }, { session });
        await this.users.deleteMany({ _id: { $in: gone } }, { session });
        await this.sessions.deleteMany({ userId: { $in: gone } }, { session });
        await this.resets.deleteMany({ userId: { $in: gone } }, { session });
        await this.verifications.deleteMany({ userId: { $in: gone } }, { session });
        await this.sites.deleteMany({ tenantId: t, _id: { $in: sites.map((s) => s._id) } }, { session });
        await this.exports.deleteMany({ tenantId: t }, { session });
        await this.audit.deleteMany({ tenantId: t }, { session });
        await this.outbox.deleteMany({ tenantId: t }, { session });
        await this.tenants.deleteOne({ _id: t }, { session });
      });
    } catch (error) {
      duplicate(error);
    } finally {
      await session.endSession();
    }
    if (!erasure) throw new Error('account deletion did not commit');
    return erasure;
  }
  async eraseSite(input: Omit<ErasureDoc, 'siteIds' | 'publicKeys'>, tenantId: ObjectId, siteId: number) {
    const session = this.client.startSession();
    let erasure = null as ErasureDoc | null;
    try {
      await session.withTransaction(async () => {
        erasure = null;
        const site = await this.sites.findOne({ _id: siteId, tenantId, ...notDeleted }, { session });
        if (!site) return;
        erasure = { ...input, siteIds: [site._id], publicKeys: site.keys.map((k) => k.publicKey) };
        await this.erasures.insertOne(erasure, { session });
        await this.sites.deleteOne({ _id: siteId, tenantId }, { session });
        await this.exports.deleteMany({ tenantId, siteId }, { session });
        await this.outbox.deleteOne({ _id: siteId }, { session });
      });
    } catch (error) {
      duplicate(error);
    } finally {
      await session.endSession();
    }
    return erasure;
  }
  activeErasures(watchSince: Date, limit: number) {
    return this.erasures
      .find({ $or: [{ status: 'pending' }, { status: 'completed', completedAt: { $gt: watchSince } }] })
      .sort({ status: -1, updatedAt: 1 }) // 'pending' before 'completed', then least recently worked on
      .limit(limit)
      .toArray();
  }
  async removeSite(id: number) {
    return (await this.sites.deleteOne({ _id: id })).deletedCount === 1;
  }
  async deleteSitesOf(tenantId: ObjectId) {
    const found = await this.sites.find({ tenantId }).toArray();
    if (found.length) await this.sites.deleteMany({ tenantId, _id: { $in: found.map((s) => s._id) } });
    return found;
  }
  async deleteErasuresCompletedBefore(before: Date) {
    return (await this.erasures.deleteMany({ status: 'completed', completedAt: { $lt: before } })).deletedCount;
  }
  erasureById(id: ObjectId) {
    return this.erasures.findOne({ _id: id });
  }
  async updateErasure(id: ObjectId, patch: ErasurePatch) {
    await this.erasures.updateOne({ _id: id }, { $set: patch });
  }

  async close() {
    await this.client.close();
  }
}
