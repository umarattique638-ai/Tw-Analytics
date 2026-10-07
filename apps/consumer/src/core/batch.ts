/**
 * Deterministic idempotency token for one ClickHouse insert (insert_deduplication_token).
 * Built from the queue message ids only, never from time, so a redelivered batch
 * produces the same token and ClickHouse drops the duplicate block.
 */
export async function batchToken(messageIds: readonly string[], salt = ''): Promise<string> {
  const input = `${salt}\n${[...messageIds].sort().join('\n')}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}