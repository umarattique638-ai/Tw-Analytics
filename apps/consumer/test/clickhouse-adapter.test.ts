import { describe, expect, it, vi } from 'vitest';
import { ClickHouseError, createClickHousePort } from '../src/adapters/clickhouse';
import type { FetchLike } from '../src/adapters/clickhouse';

const ok = { ok: true, status: 200, headers: { get: () => null }, text: async () => '' };
const fail = (status: number, body = '', header: string | null = null) => ({
  ok: false,
  status,
  headers: { get: (name: string) => (name === 'x-clickhouse-exception-code' ? header : null) },
  text: async () => body,
});

const TOKEN = 'a'.repeat(64);
const rows = [{ site_id: 1, name: 'pageview' }, { site_id: 1, name: 'scroll' }];

function make(responses: Array<ReturnType<typeof fail> | typeof ok | Error>, extra: Record<string, unknown> = {}) {
  const queue = [...responses];
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const next = queue.shift() ?? ok;
    if (next instanceof Error) throw next;
    return next;
  };
  const sleeps: number[] = [];
  const port = createClickHousePort({
    url: 'https://ch.example:8443/',
    user: 'tw_insert',
    password: 'pw-not-in-url',
    fetchImpl,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { port, calls, sleeps };
}

describe('ClickHouse HTTP adapter', () => {
  it('sends ONE insert: token in SETTINGS, NDJSON body, credentials in headers only', async () => {
    const { port, calls } = make([ok]);
    await port.insert('events', rows, TOKEN);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    const query = new URL(call.url).searchParams.get('query');
    expect(query).toBe(`INSERT INTO tailwatch.events SETTINGS insert_deduplication_token='${TOKEN}', deduplicate_blocks_in_dependent_materialized_views=1 FORMAT JSONEachRow`);
    expect(call.body).toBe(`${JSON.stringify(rows[0])}\n${JSON.stringify(rows[1])}\n`);
    expect(call.headers['X-ClickHouse-User']).toBe('tw_insert');
    expect(call.headers['X-ClickHouse-Key']).toBe('pw-not-in-url');
    expect(call.url).not.toContain('pw-not-in-url');
  });

  it('retries transient failures with the SAME query and body, backing off', async () => {
    const { port, calls, sleeps } = make([fail(503), fail(500), ok]);
    await port.insert('sessions', rows, TOKEN);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.url)).size).toBe(1);
    expect(new Set(calls.map((c) => c.body)).size).toBe(1);
    expect(sleeps).toEqual([250, 500]);
  });

  it('retries a network error, and gives up after maxAttempts with a retryable error', async () => {
    const { port, calls } = make([new Error('boom'), new Error('boom'), new Error('boom')]);
    const error = await port.insert('events', rows, TOKEN).catch((e: unknown) => e);
    expect(calls).toHaveLength(3);
    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).retryable).toBe(true);
  });

  it('does not retry a 4xx, keeps the error NUMBER and never the response text', async () => {
    const body = 'Code: 27. DB::Exception: Cannot parse input: https://example.com/secret-path';
    const { port, calls } = make([fail(400, body)]);
    const error = (await port.insert('events', rows, TOKEN).catch((e: unknown) => e)) as ClickHouseError;
    expect(calls).toHaveLength(1);
    expect(error.status).toBe(400);
    expect(error.code).toBe(27);
    expect(error.retryable).toBe(false);
    expect(error.message).not.toContain('secret-path');
  });

  it('reads the error number from the header when present', async () => {
    const { port } = make([fail(400, 'no code here', '62')]);
    const error = (await port.insert('events', rows, TOKEN).catch((e: unknown) => e)) as ClickHouseError;
    expect(error.code).toBe(62);
  });

  it('async inserts are opt-in and carry the dedup setting', async () => {
    const { port, calls } = make([ok], { asyncInsert: true });
    await port.insert('events', rows, TOKEN);
    const query = new URL(calls[0]!.url).searchParams.get('query')!;
    expect(query).toContain('async_insert=1');
    expect(query).toContain('wait_for_async_insert=1');
    expect(query).toContain('async_insert_deduplicate=1');
  });

  it('refuses an unknown table or an unsafe token without calling ClickHouse', async () => {
    const { port, calls } = make([ok]);
    await expect(port.insert('users' as never, rows, TOKEN)).rejects.toThrow('clickhouse_unknown_table');
    await expect(port.insert('events', rows, "x'; DROP TABLE events; --")).rejects.toThrow('clickhouse_bad_token');
    expect(calls).toHaveLength(0);
  });

  it('an empty batch sends nothing', async () => {
    const fetchSpy = vi.fn();
    const port = createClickHousePort({ url: 'https://ch.example', user: 'u', password: 'p', fetchImpl: fetchSpy as never });
    await port.insert('events', [], TOKEN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});