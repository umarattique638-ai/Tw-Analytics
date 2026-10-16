import type { ObjectId } from 'mongodb';

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
