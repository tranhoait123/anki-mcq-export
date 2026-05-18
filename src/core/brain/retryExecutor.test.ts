import { describe, expect, it } from 'vitest';
import { shouldRotateKey } from './retryExecutor';

describe('retry executor key conservation', () => {
  it('caps soft rate-limit rotation to one backup key for free-tier safety', () => {
    // Rotation limit cho 30 keys thường là 8.
    const rotationLimit = 8;

    expect(shouldRotateKey({
      cause: 'softRateLimit',
      hadProviderPressure: false,
      distinctKeysTried: 1,
      availableKeyCount: 30,
      rotationLimit,
    })).toBe(true);

    expect(shouldRotateKey({
      cause: 'softRateLimit',
      hadProviderPressure: true,
      distinctKeysTried: 1,
      availableKeyCount: 30,
      rotationLimit,
    })).toBe(true);

    expect(shouldRotateKey({
      cause: 'softRateLimit',
      hadProviderPressure: true,
      distinctKeysTried: 2,
      availableKeyCount: 30,
      rotationLimit,
    })).toBe(false);

    expect(shouldRotateKey({
      cause: 'softRateLimit',
      hadProviderPressure: false,
      distinctKeysTried: 2,
      availableKeyCount: 30,
      rotationLimit,
    })).toBe(false);
  });
});
