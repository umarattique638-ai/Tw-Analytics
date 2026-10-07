import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClickHouseError } from '../src/adapters/clickhouse';
import { handleQueue, retryDelaySeconds } from '../src/index';
import { createMemoryState } from '../src/state/memory';

const T = Date.UTC(2026, 9, 6, 12, 0, 0);

const eventBody = (seq = 1) => ({
  v: 1,
  type: 'event',
  event: {
    siteId: 1,
    name: 'pageview',
    url: 'https://example.com/private-path',
    host: 'example.com',
    path: '/private-path',
    seq,
    createdAt: T,
    occurredAt: T,
    receivedAt: T,
    backfill: false,
    trackerVersion: 1,
    flags: 0,
    props: {},
    warnings: [],
    extra: {},
    userAgent: 'Mozilla/5.0 Chrome/126.0',
    country: 'DE',
  },
  visitor: { hash: '111', prevHash: '222' },
});

function batchOf(bodies: unknown[], attempts = 1) {
  const retryAll = vi.fn();
  const batch = {
    messages: bodies.map((body, i) => ({ id: `msg-${i}`, timestamp: new Date(T), body, attempts })),
    retryAll,
  };
  return { batch, retryAll };
}

const okInsert = () => vi.fn(async (_table: string, _rows: readonly object[], _token: string): Promise<void> => undefined);

const lines: string[] = [];
beforeEach(() => {
  lines.length = 0;
  const capture = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

describe('consumer queue handler', () => {
  it('processes a batch: events then sessions are inserted, nothing is retried', async () => {
    const insert = okInsert();
    const { batch, retryAll } = batchOf([eventBody()]);
    await handleQueue(batch, { REQUIRE_ARCHIVE: 'false' }, { clickhouse: { insert }, state: createMemoryState() });
    expect(insert.mock.calls.map((c) => c[0])).toEqual(['events', 'sessions']);
    expect(retryAll).not.toHaveBeenCalled();
  });

  it('a ClickHouse outage retries the whole batch with a delay and does not throw', async () => {
    const insert = vi.fn(async (_t: string, _r: readonly object[], _k: string): Promise<void> => {
      throw new ClickHouseError('clickhouse_http_503', 503, null, true);
    });
    const { batch, retryAll } = batchOf([eventBody()]);
    await expect(handleQueue(batch, { REQUIRE_ARCHIVE: 'false' }, { clickhouse: { insert }, state: createMemoryState() })).resolves.toBeUndefined();
    expect(retryAll).toHaveBeenCalledWith({ delaySeconds: 15 });
  });

  it('backs off with the attempt number and is capped at 15 minutes', () => {
    expect(retryDelaySeconds(1)).toBe(15);
    expect(retryDelaySeconds(2)).toBe(30);
    expect(retryDelaySeconds(3)).toBe(60);
    expect(retryDelaySeconds(50)).toBe(900);
    expect(retryDelaySeconds(Number.NaN)).toBe(15);
  });

  it('uses the highest attempt number in the batch for the delay', async () => {
    const insert = vi.fn(async (_t: string, _r: readonly object[], _k: string): Promise<void> => {
      throw new ClickHouseError('clickhouse_network', null, null, true);
    });
    const { batch, retryAll } = batchOf([eventBody()], 3);
    await handleQueue(batch, { REQUIRE_ARCHIVE: 'false' }, { clickhouse: { insert }, state: createMemoryState() });
    expect(retryAll).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it('missing ClickHouse configuration retries instead of crashing or dropping data', async () => {
    const { batch, retryAll } = batchOf([eventBody()]);
    await handleQueue(batch, { REQUIRE_ARCHIVE: 'false' });
    expect(retryAll).toHaveBeenCalledWith({ delaySeconds: 15 });
    expect(lines.join('\n')).toContain('consumer_not_configured');
  });

  it('fails closed without an archive unless REQUIRE_ARCHIVE is exactly "false"', async () => {
    const insert = okInsert();
    const { batch, retryAll } = batchOf([eventBody()]);
    await handleQueue(batch, {}, { clickhouse: { insert }, state: createMemoryState() });
    expect(insert).not.toHaveBeenCalled();
    expect(retryAll).toHaveBeenCalledTimes(1);
  });

  it('logs counts and codes only: no URL, path, host or user agent (invariant 12)', async () => {
    const insert = okInsert();
    await handleQueue(batchOf([eventBody()]).batch, { REQUIRE_ARCHIVE: 'false' }, { clickhouse: { insert }, state: createMemoryState() });
    const failing = vi.fn(async (_t: string, _r: readonly object[], _k: string): Promise<void> => {
      throw new ClickHouseError('clickhouse_http_400', 400, 27, false);
    });
    await handleQueue(batchOf([eventBody()]).batch, { REQUIRE_ARCHIVE: 'false' }, { clickhouse: { insert: failing }, state: createMemoryState() });
    const output = lines.join('\n');
    expect(output).toContain('consumer_batch');
    expect(output).toContain('code_27');
    for (const secret of ['private-path', 'example.com', 'Mozilla']) expect(output).not.toContain(secret);
  });

  it('without the Durable Object binding the batch is retried, never processed with throwaway memory', async () => {
    const insert = okInsert();
    const { batch, retryAll } = batchOf([eventBody()]);
    await handleQueue(batch, { REQUIRE_ARCHIVE: 'false' }, { clickhouse: { insert } });
    expect(insert).not.toHaveBeenCalled();
    expect(retryAll).toHaveBeenCalledWith({ delaySeconds: 15 });
    expect(lines.join('\n')).toContain('state_not_configured');
  });

  it('uses the R2 binding for the archive when it is present (REQUIRE_ARCHIVE left at its safe default)', async () => {
    const insert = okInsert();
    const puts: { key: string; contentType?: string }[] = [];
    const ARCHIVE = {
      async put(key: string, _value: string, options?: { httpMetadata?: { contentType?: string } }) {
        puts.push({ key, contentType: options?.httpMetadata?.contentType });
      },
    };
    const { batch, retryAll } = batchOf([eventBody()]);
    await handleQueue(batch, { ARCHIVE }, { clickhouse: { insert }, state: createMemoryState() });
    expect(retryAll).not.toHaveBeenCalled();
    expect(puts).toHaveLength(1);
    expect(puts[0]!.key).toMatch(/^raw\/2026-10-06\/12\/[0-9a-f]{64}\.ndjson$/);
    expect(puts[0]!.contentType).toBe('application/x-ndjson');
  });
});
