import { describe, expect, it } from 'vitest';
import { shouldTryBackupKeyAfterSoftRateLimit } from './retryExecutor';

describe('retry executor key conservation', () => {
  it('tries at most one fresh backup key before conserving keys during soft rate limits', () => {
    expect(shouldTryBackupKeyAfterSoftRateLimit({
      hadProviderPressure: false,
      attempts: 1,
      distinctKeysTried: 1,
      availableKeyCount: 30,
      maxKeysPerOperation: 8,
    })).toBe(true);

    expect(shouldTryBackupKeyAfterSoftRateLimit({
      hadProviderPressure: false,
      attempts: 2,
      distinctKeysTried: 2,
      availableKeyCount: 30,
      maxKeysPerOperation: 8,
    })).toBe(false);

    expect(shouldTryBackupKeyAfterSoftRateLimit({
      hadProviderPressure: true,
      attempts: 1,
      distinctKeysTried: 1,
      availableKeyCount: 30,
      maxKeysPerOperation: 8,
    })).toBe(false);
  });
});
