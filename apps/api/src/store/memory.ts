import { readFileSync } from 'node:fs';
import { Long, ObjectId } from 'mongodb';
import { violation } from './validate';
import { DuplicateError } from './types';
import type { ControlStore, ExportDoc, KvIssueDoc, MembershipDoc, PasswordResetDoc, SessionDoc, SiteDoc, SitePatch, TenantDoc, UserDoc } from './types';

/**
 * In-memory ControlStore for tests. It enforces the same rules the real MongoDB enforces:
 * the collection validators from control-plane.schema.json, the unique indexes, and
 * all-or-nothing account creation. Not used by the server.
 */
const schema = JSON.parse(
  readFileSync(new URL('../../../../infra/mongodb/control-plane.schema.json', import.meta.url), 'utf8'),
) as { collections: Record<string, { document: never }> };

function clone<T>(v: T): T {
  if (v instanceof ObjectId || v instanceof Long) return v;
  if (v instanceof Date) return new Date(v.getTime()) as T;
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = clone(x);
    return out as T;
  }
  return v;
}

function check(collection: string, doc: unknown): void {
  const err = violation(schema.collections[collection]!.document, doc);
  if (err) throw new Error(`Document failed validation (${collection}): ${err}`);
}

const same = (a: ObjectId, b: ObjectId) => a.equals(b);
const lower = (s: string) => s.toLowerCase(); // strength-2 collation on users.emailNormalized

export class MemoryStore implements ControlStore {
  users: UserDoc[] = [];
  tenants: TenantDoc[] = [];
  memberships: MembershipDoc[] = [];
  sessions: SessionDoc[] = [];
  sites: SiteDoc[] = [];
  exports: ExportDoc[] = [];
  resets: PasswordResetDoc[] = [];
  outbox: KvIssueDoc[] = [];
  counter = Long.fromNumber(0);

  async createAccount({ user, tenant, membership }: { user: UserDoc; tenant: TenantDoc; membership: MembershipDoc }) {
    check('users', user);
    check('tenants', tenant);
    check('memberships', membership);
    if (this.users.some((u) => lower(u.emailNormalized) === lower(user.emailNormalized))) throw new DuplicateError('email');
    this.users.push(clone(user));
    this.tenants.push(clone(tenant));
    this.memberships.push(clone(membership));
  }
  async userByEmail(e: string) {
    return clone(this.users.find((u) => lower(u.emailNormalized) === lower(e)) ?? null);
  }
  async userById(id: ObjectId) {
    return clone(this.users.find((u) => same(u._id, id)) ?? null);
  }
  async membershipsOf(userId: ObjectId) {
    return clone(this.memberships.filter((m) => same(m.userId, userId)));
  }
  async tenantById(id: ObjectId) {
    return clone(this.tenants.find((t) => same(t._id, id)) ?? null);
  }

  async createSession(s: SessionDoc) {
    check('sessions', s);
    this.sessions.push(clone(s));
  }
  async sessionById(id: string) {
    const s = this.sessions.find((x) => x._id === id);
    return s && s.expiresAt.getTime() > Date.now() ? clone(s) : null;
  }
  async deleteSession(id: string) {
    this.sessions = this.sessions.filter((s) => s._id !== id);
  }

  async nextSiteId(floor: number) {
    const next = Math.max(this.counter.toNumber(), floor) + 1;
    this.counter = Long.fromNumber(next);
    check('counters', { _id: 'site_id', value: this.counter });
    return next;
  }
  private unique(site: SiteDoc, ignoreId?: number) {
    for (const other of this.sites) {
      if (other._id === ignoreId) continue;
      if (same(other.tenantId, site.tenantId) && other.domain === site.domain) throw new DuplicateError('domain');
      const keys = new Set(other.keys.map((k) => k.publicKey));
      if (site.keys.some((k) => keys.has(k.publicKey))) throw new DuplicateError('publicKey');
    }
  }
  async insertSite(site: SiteDoc) {
    check('sites', site);
    if (this.sites.some((s) => s._id === site._id)) throw new DuplicateError('other');
    this.unique(site);
    this.sites.push(clone(site));
  }
  async sitesOf(tenantId: ObjectId) {
    return clone(this.sites.filter((s) => same(s.tenantId, tenantId) && s.status !== 'deleted').sort((a, b) => a._id - b._id));
  }
  async site(tenantId: ObjectId, id: number) {
    return clone(this.sites.find((s) => s._id === id && same(s.tenantId, tenantId) && s.status !== 'deleted') ?? null);
  }
  async siteByDomain(tenantId: ObjectId, domain: string) {
    return clone(this.sites.find((s) => same(s.tenantId, tenantId) && s.domain === domain) ?? null);
  }
  async updateSite(tenantId: ObjectId, id: number, expected: Date, patch: SitePatch, now: Date) {
    const i = this.sites.findIndex((s) => s._id === id && same(s.tenantId, tenantId) && s.updatedAt.getTime() === expected.getTime());
    if (i < 0) return null;
    const next = { ...this.sites[i]!, ...clone(patch), updatedAt: now };
    check('sites', next);
    this.unique(next, id);
    this.sites[i] = next;
    return clone(next);
  }
  async allSites() {
    return clone(this.sites);
  }
  async siteById(id: number) {
    return clone(this.sites.find((s) => s._id === id) ?? null);
  }

  async recordKvIssue(siteId: number, tenantId: ObjectId, error: string, now: Date) {
    const i = this.outbox.findIndex((o) => o._id === siteId);
    const prev = i >= 0 ? this.outbox[i]! : null;
    const doc: KvIssueDoc = { _id: siteId, tenantId, error: error.slice(0, 500), attempts: (prev?.attempts ?? 0) + 1, createdAt: prev?.createdAt ?? now, updatedAt: now };
    check('kv_outbox', doc);
    if (i >= 0) this.outbox[i] = doc;
    else this.outbox.push(doc);
  }
  async kvIssues(tenantId: ObjectId | null, limit: number) {
    return clone(this.outbox.filter((o) => !tenantId || same(o.tenantId, tenantId)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, limit));
  }
  async clearKvIssue(siteId: number) {
    this.outbox = this.outbox.filter((o) => o._id !== siteId);
  }

  async setPassword(userId: ObjectId, passwordHash: string, now: Date) {
    const i = this.users.findIndex((u) => same(u._id, userId));
    if (i < 0) return;
    const next = { ...this.users[i]!, passwordHash, updatedAt: now };
    check('users', next);
    this.users[i] = next;
  }
  async deleteSessionsOf(userId: ObjectId) {
    this.sessions = this.sessions.filter((s) => !same(s.userId, userId));
  }
  async createPasswordReset(reset: PasswordResetDoc) {
    check('password_resets', reset);
    if (this.resets.some((r) => r._id === reset._id)) throw new DuplicateError('other');
    this.resets.push(clone(reset));
  }
  private liveReset(id: string, now: Date) {
    return this.resets.find((r) => r._id === id && r.usedAt === null && r.expiresAt.getTime() > now.getTime());
  }
  async passwordReset(id: string, now: Date) {
    return clone(this.liveReset(id, now) ?? null);
  }
  async usePasswordReset(id: string, now: Date) {
    const r = this.liveReset(id, now);
    if (!r) return null;
    r.usedAt = now;
    return clone(r);
  }
  async deletePasswordResetsOf(userId: ObjectId) {
    this.resets = this.resets.filter((r) => !same(r.userId, userId));
  }

  async insertExport(doc: ExportDoc) {
    check('exports', doc);
    this.exports.push(clone(doc));
  }
  private liveExports(tenantId: ObjectId, siteId: number, now: Date) {
    return this.exports.filter((e) => same(e.tenantId, tenantId) && e.siteId === siteId && e.expiresAt.getTime() > now.getTime());
  }
  async exportsOf(tenantId: ObjectId, siteId: number, now: Date, limit: number) {
    return clone(this.liveExports(tenantId, siteId, now).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit));
  }
  async exportById(tenantId: ObjectId, siteId: number, id: ObjectId, now: Date) {
    return clone(this.liveExports(tenantId, siteId, now).find((e) => same(e._id, id)) ?? null);
  }
  async countExports(tenantId: ObjectId, siteId: number, now: Date) {
    return this.liveExports(tenantId, siteId, now).length;
  }
  async deleteExport(tenantId: ObjectId, siteId: number, id: ObjectId) {
    const before = this.exports.length;
    this.exports = this.exports.filter((e) => !(same(e._id, id) && same(e.tenantId, tenantId) && e.siteId === siteId));
    return this.exports.length < before;
  }
  async close() {}
}
