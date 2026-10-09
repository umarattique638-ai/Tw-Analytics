import { describe, expect, it, vi } from 'vitest';
import { MAX_REPLAYS, archiveDeadLetters, replayDeadLetters } from '../src/dlq';
import type { DeadLetterBucket } from '../src/dlq';
import { handleDeadLetters, handleScheduled } from '../src/index';

/** Dead letters survive the Free plan's 24 h queue retention (R2) and come back by themselves (cron). */
function bucket() {
  const files = new Map<string, string>();
  const b: DeadLetterBucket & { files: Map<string, string> } = {
    files,
    async put(key, value) {
      files.set(key, value);
    },
    async list({ prefix, limit }) {
      return { objects: [...files.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((key) => ({ key })) };
    },
    async get(key) {
      const v = files.get(key);
      return v === undefined ? null : { text: async () => v };
    },
    async delete(key) {
      files.delete(key);
    },
  };
  return b;
}
const T = Date.UTC(2026, 9, 9, 12, 0, 0);
const event = (n: number, replays?: number) => ({ id: `m${n}`, timestamp: T, body: { v: 1, type: 'event', event: { siteId: 7, insertId: `i${n}` }, ...(replays === undefined ? {} : { replays }) } });

describe('dead letters', () => {
  it('are kept in R2, replayed into the main queue with replays + 1, and the file is removed after sending', async () => {
    const b = bucket();
    expect(await archiveDeadLetters([event(1), event(2, 2)], b, T)).toEqual({ stored: 2, parked: 0 });
    expect([...b.files.keys()]).toEqual([expect.stringMatching(/^dlq\/2026-10-09\/[0-9a-f]{64}\.ndjson$/)]);
    const sent: unknown[] = [];
    const r = await replayDeadLetters(b, { sendBatch: async (m) => void sent.push(...m.map((x) => x.body)) });
    expect(r).toEqual({ files: 1, messages: 2 });
    expect(sent).toEqual([expect.objectContaining({ replays: 1 }), expect.objectContaining({ replays: 3 })]);
    expect(b.files.size).toBe(0);
  });

  it(`after ${MAX_REPLAYS} replays a letter is parked in dlq-dead/ instead of looping forever`, async () => {
    const b = bucket();
    expect(await archiveDeadLetters([event(1, MAX_REPLAYS), event(2, 1)], b, T)).toEqual({ stored: 1, parked: 1 });
    expect([...b.files.keys()].map((k) => k.split('/')[0]).sort()).toEqual(['dlq', 'dlq-dead']);
    await replayDeadLetters(b, { sendBatch: async () => undefined });
    expect([...b.files.keys()].map((k) => k.split('/')[0])).toEqual(['dlq-dead']);
  });

  it('if the queue refuses the replay, the file stays for the next run', async () => {
    const b = bucket();
    await archiveDeadLetters([event(1)], b, T);
    await expect(replayDeadLetters(b, { sendBatch: async () => { throw new Error('queue down'); } })).rejects.toThrow('queue down');
    expect(b.files.size).toBe(1);
  });

  it('the Worker: a DLQ batch goes to R2 (retried if R2 fails); the cron replays', async () => {
    const b = bucket();
    const retryAll = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const batch = { queue: 'tailwatch-events-dlq', messages: [{ id: 'm1', timestamp: new Date(T), body: event(1).body, attempts: 1 }], retryAll };
    await handleDeadLetters(batch, { ARCHIVE: b as never }, T);
    expect(b.files.size).toBe(1);
    expect(retryAll).not.toHaveBeenCalled();
    await handleDeadLetters(batch, {}, T);
    expect(retryAll).toHaveBeenCalledWith({ delaySeconds: 300 });
    const sendBatch = vi.fn(async () => undefined);
    await handleScheduled({ ARCHIVE: b as never, REPLAY: { sendBatch } });
    expect(sendBatch).toHaveBeenCalledTimes(1);
    expect(b.files.size).toBe(0);
  });
});
