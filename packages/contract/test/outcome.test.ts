import { describe, expect, it } from 'vitest';

import type {
  Outcome,
  AcceptOutcome,
  DropOutcome,
  DuplicateOutcome,
  MalformedOutcome,
  OversizedOutcome,
  RateLimitOutcome,
  QuotaLimitedOutcome,
} from '../src/outcome';

describe('collector outcomes', () => {
  it('accept outcome is HTTP 204', () => {
    const outcome: AcceptOutcome = {
      kind: 'accept',
      status: 204,
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
    };

    expect(outcome.kind).toBe('accept');
    expect(outcome.status).toBe(204);
  });

  it('drop outcome is also HTTP 204', () => {
    const outcome: DropOutcome = {
      kind: 'drop',
      status: 204,
      reason: 'bot',
      detail: 'ua_denylist',
      headers: {
        'x-tw-dropped': 'bot',
      },
    };

    expect(outcome.kind).toBe('drop');
    expect(outcome.status).toBe(204);
    expect(outcome.headers['x-tw-dropped']).toBe('bot');
  });

  it('verification agent has its own drop reason', () => {
    const outcome: DropOutcome = {
      kind: 'drop',
      status: 204,
      reason: 'verification_agent',
      detail: 'install_check',
      headers: {
        'x-tw-dropped': 'verification_agent',
      },
    };

    expect(outcome.reason).toBe('verification_agent');
  });

  it('GPC drop has HTTP 204', () => {
    const outcome: DropOutcome = {
      kind: 'drop',
      status: 204,
      reason: 'gpc',
      headers: {
        'x-tw-dropped': 'gpc',
      },
    };

    expect(outcome.status).toBe(204);
  });

  it('duplicate outcome is HTTP 204 but is not a drop', () => {
    const outcome: DuplicateOutcome = {
      kind: 'duplicate',
      status: 204,
      reason: 'duplicate',
      siteId: 123,
      insertId: 'evt_123',
    };

    expect(outcome.kind).toBe('duplicate');
    expect(outcome.status).toBe(204);
    expect(outcome.reason).toBe('duplicate');
  });

  it('malformed request is HTTP 400', () => {
    const outcome: MalformedOutcome = {
      kind: 'reject',
      status: 400,
      reason: 'malformed',
      error: 'invalid_json',
    };

    expect(outcome.status).toBe(400);
    expect(outcome.reason).toBe('malformed');
  });

  it('oversized request is HTTP 413', () => {
    const outcome: OversizedOutcome = {
      kind: 'reject',
      status: 413,
      reason: 'oversized',
      error: 'body_too_large',
    };

    expect(outcome.status).toBe(413);
    expect(outcome.reason).toBe('oversized');
  });

  it('rate limit is HTTP 429 and requires Retry-After', () => {
    const outcome: RateLimitOutcome = {
      kind: 'rate_limit',
      status: 429,
      reason: 'rate_limited',
      error: 'too_many_requests',
      headers: {
        'Retry-After': '60',
      },
    };

    expect(outcome.status).toBe(429);
    expect(outcome.headers['Retry-After']).toBe('60');
  });

  it('quota limited is HTTP 200', () => {
    const outcome: QuotaLimitedOutcome = {
      kind: 'quota_limited',
      status: 200,
      reason: 'quota_limited',
      quotaLimited: ['pageview'],
    };

    expect(outcome.status).toBe(200);
    expect(outcome.reason).toBe('quota_limited');
    expect(outcome.quotaLimited).toEqual(['pageview']);
  });

  it('all outcome variants belong to the Outcome union', () => {
    const outcomes: Outcome[] = [
      {
        kind: 'duplicate',
        status: 204,
        reason: 'duplicate',
      },
      {
        kind: 'reject',
        status: 400,
        reason: 'malformed',
        error: 'invalid_json',
      },
      {
        kind: 'reject',
        status: 413,
        reason: 'oversized',
        error: 'body_too_large',
      },
      {
        kind: 'rate_limit',
        status: 429,
        reason: 'rate_limited',
        error: 'too_many_requests',
        headers: {
          'Retry-After': '60',
        },
      },
      {
        kind: 'quota_limited',
        status: 200,
        reason: 'quota_limited',
        quotaLimited: ['pageview'],
      },
    ];

    expect(outcomes).toHaveLength(5);
  });
});