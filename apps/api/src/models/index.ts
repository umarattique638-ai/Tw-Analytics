/**
 * Models: what the data looks like, nothing else. MongoDB documents exactly as stored in tailwatch_control
 * (infra/mongodb/control-plane.schema.json, which creates the collections), and the shapes read from
 * ClickHouse. Reading and writing them is repositories/; deciding what to do with them is services/.
 *
 *   user.model.ts         users
 *   tenant.model.ts       tenants (workspaces) and memberships (who is in which, with which role)
 *   session.model.ts      login sessions
 *   auth-token.model.ts   password-reset and e-mail-verification links
 *   site.model.ts         sites and their public keys
 *   site-health.model.ts  is a site still sending data (decisions 28, 29, 31)
 *   export.model.ts       saved CSV reports
 *   audit.model.ts        the activity log and every action it can record
 *   erasure.model.ts      account / site data being erased
 *   kv-issue.model.ts     sites whose Cloudflare KV copy may be out of date
 *   analytics.model.ts    what the health check reads from ClickHouse
 *   stats.model.ts        what the dashboard's Query API answers
 */
export * from './user.model';
export * from './tenant.model';
export * from './session.model';
export * from './auth-token.model';
export * from './site.model';
export * from './site-health.model';
export * from './export.model';
export * from './audit.model';
export * from './erasure.model';
export * from './kv-issue.model';
export * from './analytics.model';
export * from './stats.model';
