import type { DropReason, ValidatedEvent } from './outcome';

/**
 * Visitor identity hashes generated during event processing.
 *
 * The current and previous hash are both required because
 * the visitor salt rotates daily.
 *
 * The previous day's hash is retained for 48 hours so a
 * session crossing UTC midnight does not create an artificial
 * visitor split.
 *
 * IMPORTANT:
 * Raw IP is intentionally NOT part of this interface.
 */
export interface VisitorHashes {
  /** Hash generated with the current UTC-day salt. */
  hash: string;

  /** Hash generated with the previous UTC-day salt. */
  prevHash: string;
}

/**
 * Queue message containing a validated analytics event.
 *
 * Versioning is mandatory because Queue messages may remain
 * in flight while the consumer code is deployed.
 */
export interface EventQueueMessage {
  v: 1;
  type: 'event';

  /** Fully validated event. */
  event: ValidatedEvent;

  /** Current + previous visitor identity hashes. */
  visitor: VisitorHashes;
}

/**
 * Queue message recording an event/request that was dropped
 * at the edge.
 *
 * Drop messages allow the system to produce an auditable
 * capture/drop reason instead of silently losing the information.
 */
export interface DropQueueMessage {
  v: 1;
  type: 'drop';

  /** Time the drop happened at the collector edge. */
  at: number;

  /** Internal TailWatch site identifier. */
  siteId: number;

  /** Why the event was dropped. */
  reason: DropReason;

  /** Optional machine-readable detail. */
  detail?: string;

  /** Country known at the edge, if available. */
  country?: string;

  /** ASN known at the edge, if available. */
  asn?: number;
}

/**
 * Complete Queue contract.
 *
 * Every message must have an explicit version and type.
 */
export type QueueMessage =
  | EventQueueMessage
  | DropQueueMessage;