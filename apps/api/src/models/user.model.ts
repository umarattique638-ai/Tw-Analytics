import type { ObjectId } from 'mongodb';

/** A person who can sign in (users collection). */
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
