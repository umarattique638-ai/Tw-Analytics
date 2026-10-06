import { describe, expect, it } from 'vitest';

import {
  PREVIOUS_SALT_RETENTION_MS,
  deriveSalt,
  deriveVisitorHashes,
  previousUtcDate,
  utcDate,
  visitorHash,
} from '../src/identity';

describe('identity contract', () => {
  const NOW = Date.UTC(
    2026,
    9,
    5,
    12,
    0,
    0,
  );

  const SECRET = 'test-secret-for-tailwatch';
  const IP = '203.0.113.10';
  const USER_AGENT =
    'Mozilla/5.0 Chrome/154.0.0.0';
  const SITE_ID = 'site_123';

  it('converts timestamps to UTC dates', () => {
    expect(utcDate(NOW)).toBe('2026-10-05');
  });

  it('returns the previous UTC date', () => {
    expect(previousUtcDate(NOW)).toBe('2026-10-04');
  });

  it('handles midnight correctly', () => {
    const midnight = Date.UTC(
      2026,
      9,
      5,
      0,
      0,
      0,
    );

    expect(utcDate(midnight)).toBe('2026-10-05');
    expect(previousUtcDate(midnight)).toBe('2026-10-04');
  });

  it('defines a 48 hour previous-salt retention window', () => {
    expect(PREVIOUS_SALT_RETENTION_MS).toBe(
      48 * 60 * 60 * 1000,
    );
  });

  it('produces a deterministic visitor hash', async () => {
    const salt = await deriveSalt(
      SECRET,
      '2026-10-05',
    );

    const first = await visitorHash(
      salt,
      IP,
      USER_AGENT,
      SITE_ID,
    );

    const second = await visitorHash(
      salt,
      IP,
      USER_AGENT,
      SITE_ID,
    );

    expect(first).toBe(second);
  });

  it('produces a decimal 64-bit hash', async () => {
    const salt = await deriveSalt(
      SECRET,
      '2026-10-05',
    );

    const hash = await visitorHash(
      salt,
      IP,
      USER_AGENT,
      SITE_ID,
    );

    expect(hash).toMatch(/^\d+$/);

    const value = BigInt(hash);

    expect(value).toBeGreaterThanOrEqual(0n);
    expect(value).toBeLessThan(2n ** 64n);
  });

  it('changes when the IP changes', async () => {
    const salt = await deriveSalt(
      SECRET,
      '2026-10-05',
    );

    const first = await visitorHash(
      salt,
      IP,
      USER_AGENT,
      SITE_ID,
    );

    const second = await visitorHash(
      salt,
      '203.0.113.11',
      USER_AGENT,
      SITE_ID,
    );

    expect(first).not.toBe(second);
  });

  it('changes when the User-Agent changes', async () => {
    const salt = await deriveSalt(
      SECRET,
      '2026-10-05',
    );

    const first = await visitorHash(
      salt,
      IP,
      USER_AGENT,
      SITE_ID,
    );

    const second = await visitorHash(
      salt,
      IP,
      'Mozilla/5.0 Firefox/145.0',
      SITE_ID,
    );

    expect(first).not.toBe(second);
  });

  it('changes when the site changes', async () => {
    const salt = await deriveSalt(
      SECRET,
      '2026-10-05',
    );

    const first = await visitorHash(
      salt,
      IP,
      USER_AGENT,
      'site_123',
    );

    const second = await visitorHash(
      salt,
      IP,
      USER_AGENT,
      'site_456',
    );

    expect(first).not.toBe(second);
  });

  it('changes when the daily salt changes', async () => {
    const saltOne = await deriveSalt(
      SECRET,
      '2026-10-05',
    );

    const saltTwo = await deriveSalt(
      SECRET,
      '2026-10-06',
    );

    const first = await visitorHash(
      saltOne,
      IP,
      USER_AGENT,
      SITE_ID,
    );

    const second = await visitorHash(
      saltTwo,
      IP,
      USER_AGENT,
      SITE_ID,
    );

    expect(first).not.toBe(second);
  });

  it('changes when the secret changes', async () => {
    const saltOne = await deriveSalt(
      'secret-one',
      '2026-10-05',
    );

    const saltTwo = await deriveSalt(
      'secret-two',
      '2026-10-05',
    );

    expect(saltOne).not.toBe(saltTwo);
  });

  it('produces stable daily salts', async () => {
    const first = await deriveSalt(
      SECRET,
      '2026-10-05',
    );

    const second = await deriveSalt(
      SECRET,
      '2026-10-05',
    );

    expect(first).toBe(second);
  });

  it('produces different salts for different dates', async () => {
    const first = await deriveSalt(
      SECRET,
      '2026-10-05',
    );

    const second = await deriveSalt(
      SECRET,
      '2026-10-06',
    );

    expect(first).not.toBe(second);
  });

  it('derives current and previous visitor hashes', async () => {
    const result = await deriveVisitorHashes(
      SECRET,
      NOW,
      IP,
      USER_AGENT,
      SITE_ID,
    );

    expect(result.hash).toMatch(/^\d+$/);
    expect(result.prevHash).toMatch(/^\d+$/);
    expect(result.hash).not.toBe(result.prevHash);
  });

  it('does not expose the raw IP in the returned hashes', async () => {
    const result = await deriveVisitorHashes(
      SECRET,
      NOW,
      IP,
      USER_AGENT,
      SITE_ID,
    );

    expect(JSON.stringify(result)).not.toContain(IP);
  });
});