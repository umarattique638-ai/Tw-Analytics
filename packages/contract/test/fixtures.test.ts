import { describe, expect, it } from 'vitest';
import { contractFixtures, malformedFixtureCount } from '../fixtures/payloads';

describe('Stage 1 fixture corpus', () => {
  it('contains exactly 50 hand-written contract fixtures', () => {
    expect(contractFixtures).toHaveLength(50);
    expect(malformedFixtureCount).toBeGreaterThanOrEqual(20);
  });
});
