import { batchToken } from '../core/batch';
import type { BatchResult, InboundMessage, Options, Ports } from './ports';

/** raw/{YYYY-MM-DD}/{HH}/{token}.ndjson, from the batch itself: a redelivery overwrites the same object. */
export async function archiveKey(messages: readonly InboundMessage[]): Promise<string> {
  const first = Math.min(...messages.map((m) => (Number.isFinite(m.timestamp) ? m.timestamp : 0)));
  const iso = new Date(Number.isFinite(first) && first > 0 ? first : 0).toISOString();
  return `raw/${iso.slice(0, 10)}/${iso.slice(11, 13)}/${await batchToken(messages.map((m) => m.id), 'archive')}.ndjson`;
}

/**
 * Step (a), FIRST: the untransformed batch goes to R2. If it fails the whole batch is retried; nothing
 * else has happened yet. Without an archive the batch fails, unless the deployment allows that.
 */
export async function archiveBatch(messages: readonly InboundMessage[], ports: Ports, options: Options, result: BatchResult): Promise<void> {
  if (ports.archive) {
    const key = await archiveKey(messages);
    const body = messages.map((m) => JSON.stringify({ id: m.id, timestamp: m.timestamp, body: m.body })).join('\n') + '\n';
    await ports.archive.put(key, body);
    result.archiveKey = key;
  } else if (options.requireArchive) {
    throw new Error('archive_required_but_missing');
  } else {
    ports.log('archive_skipped');
  }
}
