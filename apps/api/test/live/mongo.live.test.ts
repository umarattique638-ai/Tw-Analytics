import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Long, MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import { createApp, SESSION_COOKIE } from '../../src/app';
import { defaultConfig } from '../../src/config';
import { MemoryKv } from '../../src/kv';
import { MongoStore } from '../../src/store/mongo';

/**
 * Stage 5 on the REAL MongoDB (the owner's local replica set rs0): the same API flow as the unit
 * tests, but every write goes through the real validators, unique indexes and a real transaction.
 * Works in a scratch database that is dropped afterwards; tailwatch_control is never touched.
 *
 * Run: pnpm --filter @tailwatch/api live     (reads TW_MONGO_URL from the root .env)
 */
const env = fileURLToPath(new URL('../../../../.env', import.meta.url));
if (existsSync(env)) process.loadEnvFile(env);
const URL_ = process.env.TW_MONGO_URL;
const schema = JSON.parse(readFileSync(new URL('../../../../infra/mongodb/control-plane.schema.json', import.meta.url), 'utf8'));
const DB = `tailwatch_control_live_${Date.now()}`;

let client: MongoClient;
let db: Db;
let store: MongoStore;

beforeAll(async () => {
  if (!URL_) return;
  client = await MongoClient.connect(URL_, { serverSelectionTimeoutMS: 5_000 });
  db = client.db(DB);
  // Same as `pnpm db:mongo` (infra/tools/mongo.mjs): validators, indexes, counter.
  for (const [name, { document }] of Object.entries(schema.collections as Record<string, { document: object }>)) {
    await db.createCollection(name, { validator: { $jsonSchema: document }, validationLevel: 'strict', validationAction: 'error' });
  }
  for (const index of schema.indexes) await db.collection(index.collection).createIndex(index.keys, index.options ?? {});
  await db.collection<{ _id: string; value: Long }>('counters').insertOne({ _id: 'site_id', value: Long.fromNumber(0) });
  store = await MongoStore.connect(URL_, DB);
}, 30_000);

afterAll(async () => {
  if (!URL_) return;
  await store?.close();
  if (process.env.TW_KEEP_TEST_DB !== '1') await db?.dropDatabase();
  await client?.close();
});

describe.skipIf(!URL_)('control plane on the real MongoDB', () => {
  const kv = new MemoryKv();
  let app: ReturnType<typeof createApp>;
  let cookie = '';
  const call = async (method: string, path: string, json?: unknown) => {
    const res = await app.request(`http://app.test/api/v1${path}`, {
      method,
      headers: { host: 'app.test', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const set = res.headers.get('set-cookie');
    if (set?.startsWith(`${SESSION_COOKIE}=`)) cookie = set.split(';')[0]!;
    return { status: res.status, body: await res.json() };
  };

  beforeAll(() => {
    app = createApp({
      store,
      kv,
      analytics: { recent: async () => ({ events: 0, pageviews: 0, last: null, drops: [] }) },
      config: defaultConfig({ collectorUrl: 'https://collector.test', secureCookies: false, scrypt: { N: 1024, r: 8, p: 1 } }),
    });
  });

  it('the server is a replica set (transactions)', async () => {
    const hello = await client.db('admin').command({ hello: 1 });
    expect(hello.setName, 'MongoDB must be a replica set: docs/TESTING.md section 8').toBeTruthy();
  });

  it('signup writes user + tenant + membership in one transaction, passing the validators', async () => {
    const r = await call('POST', '/auth/signup', { name: 'Live', email: 'Live@Example.com', password: 'correct horse' });
    expect(r.status).toBe(201);
    expect(await db.collection('users').countDocuments()).toBe(1);
    expect(await db.collection('tenants').countDocuments()).toBe(1);
    expect(await db.collection('memberships').countDocuments()).toBe(1);
    expect(await db.collection('sessions').countDocuments()).toBe(1);
  });

  it('the strength-2 collation index refuses the same e-mail in other letter case', async () => {
    const saved = cookie;
    const r = await call('POST', '/auth/signup', { name: 'Dup', email: 'live@EXAMPLE.com', password: 'correct horse' });
    cookie = saved;
    expect(r.status).toBe(409);
    expect(await db.collection('tenants').countDocuments()).toBe(1); // no orphan tenant
  });

  it('a site: id from the counter above the reserved range, validators pass, KV written', async () => {
    const r = await call('POST', '/sites', { domain: 'live-shop.example', timezone: 'Asia/Karachi' });
    expect(r.status).toBe(201);
    expect(r.body.site.id).toBe(101);
    const doc = await db.collection('sites').findOne({ _id: 101 as never });
    expect(doc?.domain).toBe('live-shop.example');
    expect((await db.collection('counters').findOne({ _id: 'site_id' as never }))?.value.toString()).toBe('101');
    expect(kv.entries.size).toBe(1);
  });

  it('rotate + revoke go through the validator; the unique key index holds', async () => {
    const site = (await call('GET', '/sites')).body.sites[0];
    const rotated = (await call('POST', `/sites/${site.id}/keys`, {})).body.site;
    expect(rotated.keys).toHaveLength(2);
    const r = await call('POST', `/sites/${site.id}/keys/${site.keys[0].id}/revoke`, {});
    expect(r.status).toBe(200);
    expect(kv.entries.size).toBe(1);
  });

  it('delete + re-add restores the same id; duplicate domain is refused', async () => {
    const site = (await call('GET', '/sites')).body.sites[0];
    expect((await call('POST', '/sites', { domain: 'www.live-shop.example', timezone: 'UTC' })).body.error).toBe('domain_taken');
    expect((await call('DELETE', `/sites/${site.id}`, {})).status).toBe(200);
    const again = await call('POST', '/sites', { domain: 'live-shop.example', timezone: 'UTC' });
    expect(again.body.site.id).toBe(site.id);
  });

  it('logout deletes the session document', async () => {
    await call('POST', '/auth/logout', {});
    expect(await db.collection('sessions').countDocuments()).toBe(0);
    expect((await call('GET', '/me')).status).toBe(401);
  });
});
