import type { PropValue } from './types';

/**
 * Frozen browser -> collector wire contract version.
 */
export const WIRE_VERSION = 1 as const;

/**
 * First pageview emitted by the tracker.
 */
export const FLAG_FIRST_PAGEVIEW = 1;

/**
 * Compact browser event payload.
 *
 * Required:
 *   s = site public key
 *   n = event name
 *   u = URL
 *   q = sequence number
 *   t = client-created timestamp
 *
 * Optional:
 *   v  = tracker version (required by PLAN §4 invariant 9)
 *   r  = referrer
 *   e  = engagement milliseconds
 *   rt = route template
 *   w  = viewport width
 *   i  = insert/idempotency ID
 *   x  = reserved numeric extension
 *   f  = flags
 *   p  = custom properties
 *
 * The index signature is intentional:
 * unknown future fields must not break older collectors.
 */
export interface WirePayload {
  s: string;
  n: string;
  u: string;
  q: number;
  t: number;

  v: number;
  r?: string;
  e?: number;
  rt?: string;
  w?: number;
  i?: string;
  x?: number;
  f?: number;
  p?: Record<string, PropValue>;

  [futureField: string]: unknown;
}

/**
 * Frozen list of known v1 fields.
 */
export const WIRE_FIELDS = [
  's',
  'n',
  'u',
  'q',
  't',
  'v',
  'r',
  'e',
  'rt',
  'w',
  'i',
  'x',
  'f',
  'p',
] as const;

export type WireField = (typeof WIRE_FIELDS)[number];

/**
 * Checks whether a field belongs to the currently known
 * v1 wire contract.
 *
 * Unknown fields are still allowed by WirePayload.
 */
export function isKnownWireField(field: string): field is WireField {
  return (WIRE_FIELDS as readonly string[]).includes(field);
}