import type { ObjectId } from 'mongodb';

/** Everything the activity log can say happened. `system` entries are made by the nightly jobs. */
export const AUDIT_ACTIONS = [
  'account.created',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_reset',
  'auth.email_verified',
  'site.created',
  'site.restored',
  'site.paused',
  'site.resumed',
  'site.domain_changed',
  'site.timezone_changed',
  'site.retention_changed',
  'site.deleted',
  'site.stopped_sending',
  'site.sending_again',
  'site.traffic_spike',
  'key.created',
  'key.revoked',
  'host.allowed',
  'report.created',
  'report.deleted',
  'account.exported',
  'data.pruned',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * One line of a workspace's activity log (Phase 3 "customer-facing audit log"): who did what, when.
 * No IP address and no user agent are stored (data minimisation, PLAN 10). Deleted after AUDIT_KEEP_DAYS
 * (TTL index), and with the account.
 */
export interface AuditDoc {
  _id: ObjectId;
  tenantId: ObjectId;
  at: Date;
  actorKind: 'user' | 'system';
  /** The user who did it; null for the nightly jobs. */
  actorId: ObjectId | null;
  /** Name at that moment (the log stays readable if the name changes later). */
  actorName: string;
  action: AuditAction;
  siteId: number | null;
  /** One human sentence, e.g. "Revoked key tw_pub_ab12… of shop.example.com". */
  summary: string;
  expiresAt: Date;
}
