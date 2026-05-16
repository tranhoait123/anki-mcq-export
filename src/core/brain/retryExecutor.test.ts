import { describe, expect, it } from 'vitest';
import { shouldRotateKey } from './retryExecutor';

describe('retry executor key conservation', () => {
  it('rotates keys aggressively during soft rate limits but conserves during provider pressure', () => {
    // Rotation limit cho 30 keys thường là 8.
    const rotationLimit = 8;

    expect(shouldRotateKey({
      cause: 'softRateLimit',
      hadProviderPressure: false,
      distinctKeysTried: 1,
      availableKeyCount: 30,
      rotationLimit,
    })).toBe(true);

    // Xoay lên đến 2 key vẫn ok dù có áp lực.
    expect(shouldRotateKey({
      cause: 'softRateLimit',
      hadProviderPressure: true,
      distinctKeysTried: 1,
      availableKeyCount: 30,
      rotationLimit,
    })).toBe(true);

    // Nhưng vượt quá 4 (đến key thứ 5) khi có áp lực thì dừng.
    expect(shouldRotateKey({
      cause: 'softRateLimit',
      hadProviderPressure: true,
      distinctKeysTried: 4,
      availableKeyCount: 30,
      rotationLimit,
    })).toBe(false);

    // Nếu không có áp lực, cho phép xoay nhiều hơn.
    expect(shouldRotateKey({
      cause: 'softRateLimit',
      hadProviderPressure: false,
      distinctKeysTried: 3,
      availableKeyCount: 30,
      rotationLimit,
    })).toBe(true);
  });
});
