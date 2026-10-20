/**
 * A site being set up (decision 25): lives only in Cloudflare KV (repositories/setup-store.ts) until every
 * install check passed. One per workspace.
 */
export interface Setup {
  domain: string;
  timezone: string;
  publicKey: string;
  startedAt: string;
}
