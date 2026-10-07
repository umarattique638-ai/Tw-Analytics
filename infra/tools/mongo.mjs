#!/usr/bin/env node
/**
 * MongoDB control-plane tool (works with a local MongoDB you open in Compass, or Atlas).
 *
 *   node tools/mongo.mjs apply    create/update tailwatch_control: validators, indexes, site-id counter
 *   node tools/mongo.mjs verify   prove every rule on the REAL server in a scratch database, then drop it
 *
 * Source of truth: infra/mongodb/control-plane.schema.json. A test keeps it identical to the mongosh script
 * infra/mongodb/001_control_plane.js, so both ways of applying give the same result.
 *
 * Reads TW_MONGO_URL from the repository-root .env (default mongodb://127.0.0.1:27017).
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Int32, Long, MongoClient, ObjectId } from 'mongodb';
import { loadRootEnv } from './env.mjs';

loadRootEnv();
const MONGO_URL = process.env.TW_MONGO_URL || 'mongodb://127.0.0.1:27017';
const schema = JSON.parse(readFileSync(new URL('../mongodb/control-plane.schema.json', import.meta.url), 'utf8'));

/** Same as the mongosh script: create with a validator, or collMod an existing collection. */
async function applySchema(db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, { document }] of Object.entries(schema.collections)) {
    const options = { validator: { $jsonSchema: document }, validationLevel: 'strict', validationAction: 'error' };
    if (existing.has(name)) await db.command({ collMod: name, ...options });
    else await db.createCollection(name, options);
  }
  for (const index of schema.indexes) await db.collection(index.collection).createIndex(index.keys, index.options ?? {});
  await db
    .collection('counters')
    .updateOne({ _id: 'site_id' }, { $setOnInsert: { value: Long.fromNumber(0) } }, { upsert: true, writeConcern: { w: 'majority' } });
}

async function topology(client) {
  const hello = await client.db('admin').command({ hello: 1 });
  return { replicaSet: hello.setName ?? null };
}

function printReplicaSetAdvice(replicaSet) {
  if (replicaSet) {
    console.log(`replica set "${replicaSet}": transactions available (needed from Stage 5).`);
    return;
  }
  console.log('NOTE: this MongoDB is a standalone server. Stages 1-4 do not need more.');
  console.log('      Stage 5 (signup) uses transactions, which need a single-node replica set:');
  console.log('      start mongod with --replSet rs0 (or replication.replSetName: rs0 in mongod.cfg),');
  console.log('      run rs.initiate() once in mongosh, and use mongodb://127.0.0.1:27017/?replicaSet=rs0');
}

async function apply() {
  const client = await connect();
  try {
    const db = client.db(schema.database);
    await applySchema(db);
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    console.log(`OK: ${schema.database} ready on ${redact(MONGO_URL)} (${names.join(', ')})`);
    console.log('Open it in MongoDB Compass: database "tailwatch_control" -> each collection -> Validation / Indexes tabs.');
    printReplicaSetAdvice((await topology(client)).replicaSet);
  } finally {
    await client.close();
  }
}

async function verify() {
  const client = await connect();
  const name = `tailwatch_control_verify_${Date.now()}`;
  const db = client.db(name);
  let failed = 0;
  const check = async (label, fn) => {
    try {
      await fn();
      console.log(`  PASS  ${label}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  ${label}: ${error.message}`);
    }
  };
  /** Runs a write that MUST be refused with the given server error code. */
  const refused = async (code, write) => {
    try {
      await write();
    } catch (error) {
      if (error.code === code) return;
      throw new Error(`refused with code ${error.code}, expected ${code}`);
    }
    throw new Error('was accepted, but must be refused');
  };
  const VALIDATION = 121; // DocumentValidationFailure
  const DUPLICATE = 11000;

  try {
    console.log(`MongoDB ${(await client.db('admin').command({ buildInfo: 1 })).version} at ${redact(MONGO_URL)}; scratch database ${name}`);
    await applySchema(db);
    await applySchema(db); // twice: applying must be repeatable

    const now = new Date();
    const tenantId = new ObjectId();
    const userId = new ObjectId();
    const key = (c) => `tw_pub_${c.repeat(32)}`;
    const site = (over = {}) => ({
      _id: Long.fromNumber(1),
      tenantId,
      domain: 'example.com',
      timezone: 'Asia/Karachi',
      allowedHosts: ['example.com', '*.example.com'],
      retentionDays: new Int32(395),
      status: 'active',
      region: 'in',
      keys: [{ id: 'k1', publicKey: key('A'), createdAt: now, status: 'active' }],
      identitySecret: randomBytes(24).toString('hex'),
      createdAt: now,
      ...over,
    });

    await check('a valid tenant is accepted', () =>
      db.collection('tenants').insertOne({ _id: tenantId, createdAt: now, status: 'active', plan: 'free', region: 'in' }));
    await check('a tenant with an unknown region is refused', () =>
      refused(VALIDATION, () => db.collection('tenants').insertOne({ _id: new ObjectId(), createdAt: now, status: 'active', plan: 'free', region: 'mars' })));
    await check('an unknown field is refused (additionalProperties: false)', () =>
      refused(VALIDATION, () => db.collection('tenants').insertOne({ _id: new ObjectId(), createdAt: now, status: 'active', plan: 'free', region: 'in', hack: 1 })));

    await check('a valid user is accepted', () =>
      db.collection('users').insertOne({ _id: userId, email: 'Owner@Example.com', emailNormalized: 'owner@example.com', createdAt: now, status: 'active' }));
    await check('the same e-mail in other letter case is refused (collation strength 2)', () =>
      refused(DUPLICATE, () => db.collection('users').insertOne({ _id: new ObjectId(), email: 'OWNER@EXAMPLE.COM', emailNormalized: 'OWNER@EXAMPLE.COM', createdAt: now, status: 'active' })));

    await check('a membership is accepted, the same tenant+user twice is refused', async () => {
      await db.collection('memberships').insertOne({ _id: new ObjectId(), tenantId, userId, role: 'owner', createdAt: now });
      await refused(DUPLICATE, () => db.collection('memberships').insertOne({ _id: new ObjectId(), tenantId, userId, role: 'viewer', createdAt: now }));
    });

    await check('the site-id counter hands out 1, then 2 (numeric ids shared with ClickHouse)', async () => {
      const next = async () =>
        (await db.collection('counters').findOneAndUpdate({ _id: 'site_id' }, { $inc: { value: Long.fromNumber(1) } }, { returnDocument: 'after' }))?.value;
      // The driver returns small longs as plain numbers (promoteLongs); accept a Long too.
      const n = (v) => (v instanceof Long ? v.toNumber() : Number(v));
      const a = n(await next());
      const b = n(await next());
      if (a !== 1 || b !== 2) throw new Error(`got ${a}, ${b}`);
    });

    await check('a valid site is accepted', () => db.collection('sites').insertOne(site()));
    await check('a malformed public key is refused', () =>
      refused(VALIDATION, () => db.collection('sites').insertOne(site({ _id: Long.fromNumber(2), domain: 'b.com', keys: [{ id: 'k', publicKey: 'tw_pub_short', createdAt: now, status: 'active' }] }))));
    await check('a site without an identity secret is refused', () =>
      refused(VALIDATION, () => {
        const doc = site({ _id: Long.fromNumber(3), domain: 'c.com', keys: [{ id: 'k', publicKey: key('C'), createdAt: now, status: 'active' }] });
        delete doc.identitySecret;
        return db.collection('sites').insertOne(doc);
      }));
    await check('a site with no key at all is refused', () =>
      refused(VALIDATION, () => db.collection('sites').insertOne(site({ _id: Long.fromNumber(4), domain: 'd.com', keys: [] }))));
    await check('a public key already used by another site is refused', () =>
      refused(DUPLICATE, () => db.collection('sites').insertOne(site({ _id: Long.fromNumber(5), domain: 'e.com' }))));
    await check('the same domain twice for one tenant is refused', () =>
      refused(DUPLICATE, () => db.collection('sites').insertOne(site({ _id: Long.fromNumber(6), keys: [{ id: 'k', publicKey: key('F'), createdAt: now, status: 'active' }] }))));
    await check('key rotation is one atomic update: add a second active key, then revoke the first', async () => {
      const sites = db.collection('sites');
      await sites.updateOne({ _id: Long.fromNumber(1) }, { $push: { keys: { id: 'k2', publicKey: key('B'), createdAt: now, status: 'active' } } });
      await sites.updateOne({ _id: Long.fromNumber(1), 'keys.id': 'k1' }, { $set: { 'keys.$.status': 'revoked', 'keys.$.revokedAt': now } });
      const doc = await sites.findOne({ 'keys.publicKey': key('B') });
      if (doc?.keys.find((k) => k.id === 'k1')?.status !== 'revoked') throw new Error('rotation did not stick');
    });

    printReplicaSetAdvice((await topology(client)).replicaSet);
  } finally {
    await db.dropDatabase().catch(() => undefined);
    await client.close();
  }

  if (failed > 0) {
    console.log(`\nFAILED: ${failed} check(s). The MongoDB schema is NOT verified.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nOK: every control-plane rule holds on this MongoDB server (scratch database dropped).');
}

function redact(url) {
  return url.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}

async function connect() {
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    return client;
  } catch (error) {
    console.error(`FAILED: cannot connect to ${redact(MONGO_URL)} (${error.message}).`);
    console.error('Is MongoDB running? In Compass, the connection string you use there goes into TW_MONGO_URL in .env.');
    process.exit(1);
  }
}

const command = process.argv[2];
if (command === 'apply') await apply();
else if (command === 'verify') await verify();
else {
  console.error('usage: mongo.mjs apply | verify');
  process.exit(2);
}
