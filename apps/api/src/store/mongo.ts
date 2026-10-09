import { Long, MongoClient, MongoServerError } from 'mongodb';
import type { Collection, Db, ObjectId } from 'mongodb';
import { DuplicateError } from './types';
import type { ControlStore, ExportDoc, MembershipDoc, PasswordResetDoc, SessionDoc, SiteDoc, SitePatch, TenantDoc, UserDoc } from './types';

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
   * The indexes the newer collections need (exports, password_resets), created by the API itself so a
   * deployment works with an app user that has readWrite only (MongoDB Atlas). createIndex is idempotent
   * and cheap when the index exists. Validators come from `pnpm db:mongo` (needs an admin user).
   */
  private async ensureIndexes() {
    await Promise.all([
      this.exports.createIndex({ tenantId: 1, siteId: 1, createdAt: -1 }),
      this.exports.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.resets.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.resets.createIndex({ userId: 1 }),
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
  sitesOf(tenantId: ObjectId) {
    return this.sites.find({ tenantId, ...notDeleted }).sort({ _id: 1 }).toArray();
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

  async insertExport(doc: ExportDoc) {
    await this.exports.insertOne(doc);
  }
  exportsOf(tenantId: ObjectId, siteId: number, now: Date, limit: number) {
    return this.exports.find({ tenantId, siteId, expiresAt: { $gt: now } }).sort({ createdAt: -1 }).limit(limit).toArray();
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
  async close() {
    await this.client.close();
  }
}
