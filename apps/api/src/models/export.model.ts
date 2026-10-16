import type { ObjectId } from 'mongodb';

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
