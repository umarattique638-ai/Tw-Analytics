import type { ArchivePort } from '../process';

/**
 * R2 raw archive (PLAN 3.1 a). R2 is on the Free plan: 10 GB-month, 1 M Class A writes a month,
 * and this costs exactly one PUT per consumer batch.
 *
 * The object key is derived from the batch itself (see processBatch), so a redelivered batch overwrites
 * its own archive object instead of creating a second copy.
 */
export interface R2BucketLike {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export function createR2Archive(bucket: R2BucketLike): ArchivePort {
  return {
    async put(key, body) {
      await bucket.put(key, body, { httpMetadata: { contentType: 'application/x-ndjson' } });
    },
  };
}
