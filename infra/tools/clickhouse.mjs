#!/usr/bin/env node
/**
 * ClickHouse tool (works with ClickHouse Cloud and a local server).
 *
 *   node tools/clickhouse.mjs check            connection, version, and the state of the `tailwatch` database
 *   node tools/clickhouse.mjs apply            apply infra/clickhouse/001_contract.sql to `tailwatch`
 *   node tools/clickhouse.mjs apply --reset    DROP DATABASE tailwatch first (old schema from the first attempt)
 *   node tools/clickhouse.mjs user             apply 002_insert_user.sql (needs TW_CH_INSERT_PASSWORD)
 *
 * Reads the repository-root .env: TW_CH_URL, TW_CH_USER, TW_CH_PASSWORD (an admin, e.g. `default` on Cloud).
 * Never prints a password.
 */
import { readFileSync } from 'node:fs';
import { loadRootEnv, required } from './env.mjs';

loadRootEnv();
const URL_ = required('TW_CH_URL').replace(/\/+$/, '');
const USER = required('TW_CH_USER');
const PASSWORD = process.env.TW_CH_PASSWORD ?? '';
const DATABASE = 'tailwatch';

const EXPECTED_TABLES = ['dropped_hits', 'events', 'rollup_15m_pages', 'rollup_15m_pages_mv', 'sessions'];

async function sql(statement) {
  let res;
  try {
    // select_sequential_consistency: read-your-writes on ClickHouse Cloud (ignored by a plain server).
    res = await fetch(`${URL_}/?select_sequential_consistency=1`, {
      method: 'POST',
      headers: { 'X-ClickHouse-User': USER, 'X-ClickHouse-Key': PASSWORD },
      body: statement,
    });
  } catch (error) {
    throw new Error(
      `cannot reach ${URL_} (${error.cause?.code ?? error.message}). ` +
        'Check TW_CH_URL (Cloud: https://<service>.clickhouse.cloud:8443) and the service IP access list.',
    );
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text.trim().slice(0, 400)}`);
  return text.trim();
}

/** Statements of a .sql file: full-line comments removed, split on `;`. */
function statements(file, replace = {}) {
  let text = readFileSync(new URL(`../clickhouse/${file}`, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  for (const [from, to] of Object.entries(replace)) text = text.replaceAll(from, to);
  return text.split(';').map((s) => s.trim()).filter(Boolean);
}

async function state() {
  const exists = (await sql(`SELECT count() FROM system.databases WHERE name = '${DATABASE}'`)) === '1';
  if (!exists) return { exists, tables: [], current: false, old: false };
  const tables = (await sql(`SELECT name FROM system.tables WHERE database = '${DATABASE}' ORDER BY name`))
    .split('\n')
    .filter(Boolean);
  const columns = (await sql(`SELECT name FROM system.columns WHERE database = '${DATABASE}' AND table = 'events'`))
    .split('\n')
    .filter(Boolean);
  const unknown = tables.filter((t) => !EXPECTED_TABLES.includes(t));
  const eventsLooksCurrent = columns.length === 0 || (columns.includes('route') && columns.includes('insert_id') && columns.includes('seq'));
  const old = unknown.length > 0 || !eventsLooksCurrent;
  const current = !old && EXPECTED_TABLES.every((t) => tables.includes(t));
  return { exists, tables, current, old, unknown };
}

async function check() {
  console.log(`ClickHouse ${await sql('SELECT version()')} at ${URL_} as ${USER}`);
  const s = await state();
  if (!s.exists) console.log(`database ${DATABASE}: does not exist yet -> run: pnpm db:clickhouse`);
  else if (s.current) console.log(`database ${DATABASE}: schema v1 present (${s.tables.join(', ')})`);
  else if (s.old) {
    console.log(`database ${DATABASE}: OLD schema from the first attempt (${s.tables.join(', ')})`);
    console.log('  -> the owner ordered it deleted (PROJECT-NOTES 17). Run: pnpm db:clickhouse:reset');
  } else console.log(`database ${DATABASE}: incomplete (${s.tables.join(', ')}) -> run: pnpm db:clickhouse`);
  return s;
}

async function apply(reset) {
  const s = await check();
  if (s.old && !reset) {
    console.error('Refusing to apply on top of the old schema: CREATE TABLE IF NOT EXISTS would silently keep the old tables.');
    process.exit(1);
  }
  if (reset && s.exists) {
    console.log(`DROP DATABASE ${DATABASE} ...`);
    await sql(`DROP DATABASE ${DATABASE}`);
  }
  for (const statement of statements('001_contract.sql')) await sql(statement);
  const after = await state();
  if (!after.current) throw new Error(`apply finished but the schema is not complete: ${after.tables.join(', ')}`);
  console.log(`OK: schema v1 applied to ${DATABASE} (${after.tables.join(', ')})`);
}

async function user() {
  const password = required('TW_CH_INSERT_PASSWORD');
  for (const statement of statements('002_insert_user.sql', { REPLACE_WITH_A_LONG_RANDOM_PASSWORD: password })) {
    await sql(statement);
  }
  console.log('OK: user tw_insert with least-privilege grants exists.');
  console.log('Next: cd apps/consumer && npx wrangler secret put CLICKHOUSE_PASSWORD   (paste the same password)');
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'check') await check();
  else if (command === 'apply') await apply(args.includes('--reset'));
  else if (command === 'user') await user();
  else {
    console.error('usage: clickhouse.mjs check | apply [--reset] | user');
    process.exit(2);
  }
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
}
