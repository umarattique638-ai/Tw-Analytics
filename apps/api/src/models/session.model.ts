import type { ObjectId } from 'mongodb';

export interface SessionDoc {
  /** SHA-256 hex of the token. */
  _id: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}
