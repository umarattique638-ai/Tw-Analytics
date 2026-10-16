import type { ObjectId } from 'mongodb';

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
