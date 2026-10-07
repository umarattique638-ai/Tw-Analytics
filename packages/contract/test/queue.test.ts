import { describe, expect, it } from 'vitest';

import type {
  QueueMessage,
  EventQueueMessage,
  DropQueueMessage,
  VisitorHashes,
} from '../src/queue';

describe('queue contract', () => {
  it('visitor hashes contain only current and previous hashes', () => {
    const visitor: VisitorHashes = {
      hash: '123456789',
      prevHash: '987654321',
    };

    expect(visitor.hash).toBe('123456789');
    expect(visitor.prevHash).toBe('987654321');

    /**
     * Raw IP must never be represented by VisitorHashes.
     */
    expect('ip' in visitor).toBe(false);
  });

  it('event queue message has version 1 and event type', () => {
    const message: EventQueueMessage = {
      v: 1,
      type: 'event',

      event: {
        siteId: 123,
        name: 'pageview',
        url: 'https://example.com/',
        host: 'example.com',
        path: '/',
        seq: 1,
        createdAt: 1_760_000_000_000,
        occurredAt: 1_760_000_000_000,
        receivedAt: 1_760_000_000_100,
        backfill: false,
        trackerVersion: 1,
        flags: 0,
        props: {},
        warnings: [],
        extra: {},
      },

      visitor: {
        hash: '123456789',
        prevHash: '987654321',
      },
    };

    expect(message.v).toBe(1);
    expect(message.type).toBe('event');
    expect(message.event.siteId).toBe(123);
    expect(message.visitor.hash).toBe('123456789');
  });

  it('drop queue message has version 1 and drop type', () => {
    const message: DropQueueMessage = {
      v: 1,
      type: 'drop',
      at: 1_760_000_000_000,
      siteId: 123,
      reason: 'bot',
      detail: 'ua_denylist',
      country: 'PK',
      asn: 12345,
    };

    expect(message.v).toBe(1);
    expect(message.type).toBe('drop');
    expect(message.reason).toBe('bot');
    expect(message.detail).toBe('ua_denylist');
  });

  it('queue messages satisfy the QueueMessage union', () => {
    const messages: QueueMessage[] = [
      {
        v: 1,
        type: 'event',

        event: {
          siteId: 123,
          name: 'pageview',
          url: 'https://example.com/',
          host: 'example.com',
          path: '/',
          seq: 1,
          createdAt: 1_760_000_000_000,
          occurredAt: 1_760_000_000_000,
          receivedAt: 1_760_000_000_100,
          backfill: false,
          trackerVersion: 1,
          flags: 0,
          props: {},
          warnings: [],
          extra: {},
        },

        visitor: {
          hash: '123456789',
          prevHash: '987654321',
        },
      },

      {
        v: 1,
        type: 'drop',
        at: 1_760_000_000_000,
        siteId: 123,
        reason: 'hostname',
      },
    ];

    expect(messages).toHaveLength(2);
    expect(messages[0]!.type).toBe('event');
    expect(messages[1]!.type).toBe('drop');
  });

  it('drop message can contain no optional metadata', () => {
    const message: DropQueueMessage = {
      v: 1,
      type: 'drop',
      at: 1_760_000_000_000,
      siteId: 123,
      reason: 'gpc',
    };

    expect(message.detail).toBeUndefined();
    expect(message.country).toBeUndefined();
    expect(message.asn).toBeUndefined();
  });

  it('event queue message does not contain raw IP', () => {
    const message: EventQueueMessage = {
      v: 1,
      type: 'event',

      event: {
        siteId: 123,
        name: 'pageview',
        url: 'https://example.com/',
        host: 'example.com',
        path: '/',
        seq: 1,
        createdAt: 1_760_000_000_000,
        occurredAt: 1_760_000_000_000,
        receivedAt: 1_760_000_000_100,
        backfill: false,
        trackerVersion: 1,
        flags: 0,
        props: {},
        warnings: [],
        extra: {},
      },

      visitor: {
        hash: '123456789',
        prevHash: '987654321',
      },
    };

    const serialized = JSON.stringify(message);

    expect(serialized).not.toContain('"ip"');
  });
});
import { dedupeKey } from '../src';

describe('dedupeKey (STAGE-1 D5)', () => {
  it('uses the client insert id scoped to the site when present', () => {
    expect(dedupeKey(7, 'abc', 'msg-1')).toBe('i:7:abc');
    expect(dedupeKey(7, 'abc', 'msg-2')).toBe(dedupeKey(7, 'abc', 'msg-1'));
    expect(dedupeKey(8, 'abc', 'msg-1')).not.toBe(dedupeKey(7, 'abc', 'msg-1'));
  });
  it('falls back to the queue message id without one', () => {
    expect(dedupeKey(7, undefined, 'msg-1')).toBe('m:msg-1');
    expect(dedupeKey(7, '', 'msg-1')).toBe('m:msg-1');
  });
});
