import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/**
 * Static checks of the Stage 1 storage artefacts that do not need a database server.
 *
 * MongoDB: the mongosh script is executed against a recording fake `db`. This proves the script
 * runs, that its runtime validators are exactly the reviewable JSON Schema, and that it avoids
 * index options the server rejects. It does NOT replace one run on a real replica set (Atlas or a
 * local single-node replica set): that run is the remaining VERIFY item in STAGE-1.md.
 *
 * ClickHouse: the DDL is applied to a real server by apps/consumer/test/live.
 */

const root = new URL('../../../infra/', import.meta.url);
const mongoScript = readFileSync(new URL('mongodb/001_control_plane.js', root), 'utf8');
const mongoSchema = JSON.parse(readFileSync(new URL('mongodb/control-plane.schema.json', root), 'utf8')) as {
  database: string;
  collections: Record<string, { document: unknown }>;
};

interface Recorded {
  database: string | null;
  validators: Map<string, unknown>;
  indexes: { collection: string; keys: Record<string, number>; options?: Record<string, unknown> }[];
  upserts: { collection: string; filter: unknown }[];
}

function runMongoScript(): Recorded {
  const rec: Recorded = { database: null, validators: new Map(), indexes: [], upserts: [] };
  const existing = new Set<string>();

  const collection = (name: string) => ({
    createIndex(keys: Record<string, number>, options?: Record<string, unknown>) {
      // Mirrors the server: the _id index is implicit and refuses a "unique" option.
      if (Object.keys(keys).length === 1 && '_id' in keys && options && 'unique' in options) {
        throw new Error("The field 'unique' is not valid for an _id index specification");
      }
      rec.indexes.push({ collection: name, keys, options });
    },
    updateOne(filter: unknown) {
      rec.upserts.push({ collection: name, filter });
    },
  });

  const database = new Proxy(
    {
      getCollectionNames: () => [...existing],
      createCollection(name: string, options: { validator: { $jsonSchema: unknown } }) {
        existing.add(name);
        rec.validators.set(name, options.validator.$jsonSchema);
      },
      runCommand(command: { collMod: string; validator: { $jsonSchema: unknown } }) {
        rec.validators.set(command.collMod, command.validator.$jsonSchema);
      },
    } as Record<string, unknown>,
    {
      get(target, prop: string) {
        return prop in target ? target[prop] : collection(prop);
      },
    },
  );

  runInNewContext(mongoScript, {
    db: {
      getSiblingDB(name: string) {
        rec.database = name;
        return database;
      },
    },
    NumberLong: (v: number) => v,
    print: () => undefined,
  });
  return rec;
}

describe('MongoDB control-plane script (Stage 1 artefact)', () => {
  const rec = runMongoScript();

  it('targets the documented database', () => {
    expect(rec.database).toBe(mongoSchema.database);
  });

  it('creates exactly the collections of the reviewable JSON Schema', () => {
    expect([...rec.validators.keys()].sort()).toEqual(Object.keys(mongoSchema.collections).sort());
  });

  for (const name of Object.keys(mongoSchema.collections)) {
    it(`runtime validator for ${name} equals control-plane.schema.json`, () => {
      expect(JSON.parse(JSON.stringify(rec.validators.get(name)))).toEqual(mongoSchema.collections[name]!.document);
    });
  }

  it('has the uniqueness guarantees the control plane relies on', () => {
    const unique = rec.indexes.filter((i) => i.options?.unique).map((i) => `${i.collection}:${Object.keys(i.keys).join(',')}`);
    expect(unique.sort()).toEqual(
      ['memberships:tenantId,userId', 'sites:keys.publicKey', 'sites:tenantId,domain', 'users:emailNormalized'].sort(),
    );
  });

  it('case-insensitive e-mail uniqueness uses a strength-2 collation', () => {
    const email = rec.indexes.find((i) => i.collection === 'users' && 'emailNormalized' in i.keys);
    expect(email?.options?.collation).toEqual({ locale: 'en', strength: 2 });
  });

  it('seeds the numeric site id counter idempotently', () => {
    expect(rec.upserts).toEqual([{ collection: 'counters', filter: { _id: 'site_id' } }]);
  });

  it('every site carries a server-only identity secret and at least one key', () => {
    const site = mongoSchema.collections.sites!.document as { required: string[]; properties: Record<string, { minItems?: number; minLength?: number }> };
    expect(site.required).toContain('identitySecret');
    expect(site.properties.identitySecret?.minLength).toBeGreaterThanOrEqual(32);
    expect(site.properties.keys?.minItems).toBe(1);
  });
});

describe('ClickHouse DDL (Stage 1 artefact): static rules', () => {
  const ddl = readFileSync(new URL('clickhouse/001_contract.sql', root), 'utf8');
  const code = ddl
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('never uses DEFAULT now() (it defeats block de-duplication)', () => {
    expect(code).not.toMatch(/DEFAULT\s+now/i);
  });

  it('keeps an insert de-duplication window on every table the consumer writes', () => {
    for (const table of ['events', 'sessions', 'dropped_hits']) {
      const block = code.slice(code.indexOf(`tailwatch.${table}\n`));
      const end = block.indexOf(';');
      expect(block.slice(0, end), table).toContain('non_replicated_deduplication_window');
    }
  });

  it('rolls up in 15-minute buckets (STAGE-1 D3), never hourly or daily', () => {
    expect(code).toContain('toStartOfFifteenMinutes(timestamp)');
    expect(code).not.toMatch(/toStartOfHour|toStartOfDay/);
  });

  it('has no column that could hold an IP address', () => {
    expect(code).not.toMatch(/\bip\b|ip_address|client_ip/i);
  });
});
