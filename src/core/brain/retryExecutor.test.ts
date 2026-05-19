import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RetryProfile } from '../../utils/retryStrategy';
import { googleRequestRateLimiter } from './requestRateLimiter';
import { executeWithUserRotation, shouldRotateKey, userKeyRotator } from './retryExecutor';

vi.mock('../db', () => ({
  db: {
    saveKeyHealth: vi.fn().mockResolvedValue(undefined),
  },
}));

const tinyRetryProfile: RetryProfile = {
  name: 'normal',
  attemptBuffer: 0,
  minAttempts: 1,
  fallbackAfterAttempt: 3,
  formatFastFailAttempt: 2,
  serverBusyFastFailAttempt: 3,
  backoffCapMs: 1,
  singleKeyBackoffCapMs: 1,
  maxElapsedMs: 20,
  splitThresholdChars: 500,
  maxDepth: 1,
  targetSplitParts: 2,
  initialJitterMs: [1, 1],
};

describe('retry executor key conservation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    googleRequestRateLimiter.reset();
    userKeyRotator.init('', 1);
  });

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

  it('does not count Google RPM guard wait time toward provider attempt timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    userKeyRotator.init('key-one-valid', 1);
    googleRequestRateLimiter.reset();

    await googleRequestRateLimiter.waitForTurn({ enabled: true, limitPerMinute: 1, label: 'test' });

    let operationStartedAt = -1;
    const result = executeWithUserRotation(
      'gemini-test',
      async () => {
        operationStartedAt = Date.now();
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'ok';
      },
      'key-one-valid',
      'gemini-fallback',
      tinyRetryProfile,
      undefined,
      { enabled: true, limitPerMinute: 1, label: 'test' }
    );

    await vi.advanceTimersByTimeAsync(59_999);
    expect(operationStartedAt).toBe(-1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(10);

    await expect(result).resolves.toBe('ok');
    expect(operationStartedAt).toBe(60_000);
  });
});
