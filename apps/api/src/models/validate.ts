import { Long, ObjectId } from 'mongodb';

/**
 * The subset of MongoDB's $jsonSchema used by control-plane.schema.json, so the in-memory store
 * refuses exactly what the real server's validators refuse. Returns the first violation, or null.
 */
type Schema = {
  bsonType?: string | string[];
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  pattern?: string;
  items?: Schema;
  minItems?: number;
};

function bsonTypeOf(v: unknown): string {
  if (v === null) return 'null';
  if (v instanceof ObjectId) return 'objectId';
  if (v instanceof Date) return 'date';
  if (v instanceof Long) return 'long';
  if (typeof v === 'bigint') return 'long';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 2 ** 31 ? 'int' : 'double';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'object') return 'object';
  return 'undefined';
}

export function violation(schema: Schema, value: unknown, path = '$'): string | null {
  if (schema.bsonType) {
    const allowed = Array.isArray(schema.bsonType) ? schema.bsonType : [schema.bsonType];
    const actual = bsonTypeOf(value);
    if (!allowed.includes(actual)) return `${path}: ${actual} is not ${allowed.join('|')}`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path}: ${String(value)} not in enum`;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path}: too short`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path}: too long`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path}: pattern`;
  }
  if (schema.minimum !== undefined) {
    const n = value instanceof Long ? value.toNumber() : (value as number);
    if (typeof n === 'number' && n < schema.minimum) return `${path}: below minimum`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path}: too few items`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const v = violation(schema.items, value[i], `${path}[${i}]`);
        if (v) return v;
      }
    }
  }
  if (bsonTypeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (obj[key] === undefined) return `${path}.${key}: required`;
    for (const [key, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const sub = schema.properties?.[key];
      if (!sub) {
        if (schema.additionalProperties === false) return `${path}.${key}: additional property`;
        continue;
      }
      const err = violation(sub, v, `${path}.${key}`);
      if (err) return err;
    }
  }
  return null;
}
