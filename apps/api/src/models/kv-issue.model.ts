import type { ObjectId } from 'mongodb';

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
