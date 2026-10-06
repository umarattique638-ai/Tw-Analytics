import { describe, expect, it } from 'vitest';
import { CONTRACT_VERSION } from '../src';

describe('contract package', () => {
  it('is importable (Stage 0 wiring only; real tests arrive with the contract in Stage 1)', () => {
    expect(CONTRACT_VERSION).toBe(1);
  });
});
