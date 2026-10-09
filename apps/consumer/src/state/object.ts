import { StateStore } from './store';
import type { CommitRequest, IntendRequest, LoadRequest, SqlLike } from './store';

/**
 * The Durable Object class that hosts StateStore (STAGE-1 D4).
 *
 * wrangler.toml declares it with `new_sqlite_classes`: the SQLite storage backend is the only Durable
 * Object backend on the Workers Free plan. It is reachable only through the consumer's binding, never
 * from the internet.
 *
 * Protocol (JSON over the stub's fetch, so no RPC base class and no Cloudflare import is needed):
 *   POST /load    LoadRequest   -> LoadResponse
 *   POST /intend  IntendRequest -> 204   (before the ClickHouse inserts)
 *   POST /commit  CommitRequest -> 204
 *
 * An alarm sweeps expired rows once a day so a shard that goes quiet still releases its storage.
 */

export interface DurableObjectStateLike {
  storage: {
    sql: SqlLike;
    transactionSync<T>(fn: () => T): T;
    getAlarm(): Promise<number | null>;
    setAlarm(scheduledTime: number): Promise<void>;
  };
}

const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

export class SessionStateObject {
  private readonly store: StateStore;

  constructor(
    private readonly state: DurableObjectStateLike,
    _env?: unknown,
  ) {
    this.store = new StateStore({
      sql: state.storage.sql,
      transaction: (fn) => state.storage.transactionSync(fn),
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
    const path = new URL(request.url).pathname;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return new Response('bad_json', { status: 400 });
    }

    if (path === '/load') {
      return Response.json(this.store.load(body as LoadRequest));
    }
    if (path === '/intend') {
      this.store.intend(body as IntendRequest);
      return new Response(null, { status: 204 });
    }
    if (path === '/commit') {
      this.store.commit(body as CommitRequest);
      if ((await this.state.storage.getAlarm()) === null) {
        await this.state.storage.setAlarm(Date.now() + SWEEP_EVERY_MS);
      }
      return new Response(null, { status: 204 });
    }
    return new Response('not_found', { status: 404 });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (let round = 0; round < 50 && this.store.sweepSome(now, 1000) > 0; round += 1) {
      // keep sweeping in bounded rounds
    }
    const left = this.store.counts();
    if (left.sessions + left.dedupe + left.intents > 0) await this.state.storage.setAlarm(now + SWEEP_EVERY_MS);
  }
}
