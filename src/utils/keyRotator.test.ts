import { describe, expect, it } from 'vitest';
import { UserKeyRotator } from './keyRotator';

describe('UserKeyRotator scheduler v2', () => {
  it('dedupes pasted keys before computing availability and concurrency', () => {
    const rotator = new UserKeyRotator();

    rotator.init('key-one-valid,key-two-valid\nkey-one-valid; key-two-valid', 4);

    expect(rotator.keyCount).toBe(2);
    expect(rotator.availableKeyCount).toBe(2);
    expect(rotator.getMaxKeysPerOperation()).toBe(2);
    expect(rotator.getRecommendedConcurrency()).toBe(2);
  });

  it('auth-blocks invalid keys temporarily and lets them recover', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid,key-three-valid');

    rotator.markKeyFailed('key-one-valid');

    expect(rotator.availableKeyCount).toBe(2);
    expect(rotator.hardFailedKeyCount).toBe(1);
    expect(rotator.getKeyForBatch()).toBe('key-two-valid');
    expect(rotator.getKeyForBatch()).toBe('key-three-valid');

    now += 15 * 60 * 1000 + 1;
    expect(rotator.hardFailedKeyCount).toBe(0);
    expect(rotator.availableKeyCount).toBe(3);
    expect(rotator.getKeyForBatch(new Set(['key-two-valid', 'key-three-valid']))).toBe('key-one-valid');
  });

  it('keeps explicit invalid or leaked keys auth-blocked until replaced', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid');

    rotator.markKeyResult('key-one-valid', {
      kind: 'auth',
      error: new Error('403 permission denied: API key not valid'),
    });

    expect(rotator.availableKeyCount).toBe(1);
    expect(rotator.hardFailedKeyCount).toBe(1);

    now += 61 * 60 * 1000;
    expect(rotator.availableKeyCount).toBe(1);
    expect(rotator.hardFailedKeyCount).toBe(1);
    expect(rotator.getNextCooldownDelayMs()).toBe(0);
  });

  it('temporary 403 auth blocks recover when the message is ambiguous', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid');

    rotator.markKeyResult('key-one-valid', {
      kind: 'auth',
      error: new Error('403 permission denied'),
    });

    expect(rotator.availableKeyCount).toBe(1);
    now += 15 * 60 * 1000 + 1;
    expect(rotator.availableKeyCount).toBe(2);
    expect(rotator.hardFailedKeyCount).toBe(0);
  });

  it('puts rate-limited keys on cooldown and reuses them after cooldown expires', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid');

    rotator.markKeyCooldown('key-one-valid', 'rateLimit');

    expect(rotator.availableKeyCount).toBe(1);
    expect(rotator.getKeyForBatch()).toBe('key-two-valid');

    now += 3 * 60 * 1000 + 1;
    expect(rotator.availableKeyCount).toBe(2);
    expect([rotator.getKeyForBatch(), rotator.getKeyForBatch()]).toContain('key-one-valid');
  });

  it('keeps soft cooldown separate from hard-failed keys and caps provider retry-after', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid');

    rotator.markKeyCooldown('key-one-valid', 'rateLimit', 10 * 60 * 1000);

    expect(rotator.hardFailedKeyCount).toBe(0);
    expect(rotator.availableKeyCount).toBe(1);
    expect(rotator.getNextCooldownDelayMs()).toBeLessThanOrEqual(5 * 60 * 1000);

    now += 5 * 60 * 1000 + 1;
    expect(rotator.availableKeyCount).toBe(2);
  });

  it('returns no key when every non-failed key is cooling down', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid');
    rotator.markKeyFailed('key-one-valid');
    rotator.markKeyCooldown('key-two-valid', 'rateLimit');

    expect(rotator.availableKeyCount).toBe(0);
    expect(rotator.getKeyForBatch()).toBe('');
    expect(rotator.rotate()).toBe('');
    expect(rotator.getNextCooldownDelayMs()).toBeGreaterThan(0);
  });

  it('treats server busy as provider pressure without cooling down individual keys', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid', 2);

    rotator.markKeyCooldown('key-one-valid', 'serverBusy');
    const serverBusyWait = rotator.getNextCooldownDelayMs();

    expect(rotator.availableKeyCount).toBe(2);
    expect(rotator.getKeyForBatch()).toBe('key-one-valid');
    expect(rotator.hasRecentProviderPressure()).toBe(true);
    expect(serverBusyWait).toBeGreaterThanOrEqual(1000);
    expect(serverBusyWait).toBeLessThanOrEqual(30 * 1000);

    now += serverBusyWait + 1;
    expect(rotator.hasRecentProviderPressure()).toBe(true);
  });

  it('treats soft 429 as provider pressure without cooling down or sweeping keys', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid,key-three-valid,key-four-valid', 4);

    rotator.markSoftRateLimit(12_000);

    expect(rotator.availableKeyCount).toBe(4);
    expect(rotator.hardFailedKeyCount).toBe(0);
    expect(rotator.getMaxKeysPerOperation()).toBe(4);
    expect(rotator.getRecommendedConcurrency()).toBe(1);
    expect(rotator.getNextCooldownDelayMs()).toBe(12_000);

    now += 12_001;
    expect(rotator.availableKeyCount).toBe(4);
  });

  it('caps per-operation key visits at ten healthy keys', () => {
    const rotator = new UserKeyRotator();
    const keys = Array.from({ length: 31 }, (_unused, index) => `key-${index + 1}-valid`);
    rotator.init(keys.join(','), 10);

    expect(rotator.availableKeyCount).toBe(31);
    expect(rotator.getMaxKeysPerOperation()).toBe(10);

    keys.slice(0, 25).forEach(key => rotator.markKeyFailed(key));
    expect(rotator.availableKeyCount).toBe(6);
    expect(rotator.getMaxKeysPerOperation()).toBe(10);
  });

  it('selects an available batch key outside excluded and cooling keys', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid,key-three-valid');

    expect(rotator.getKeyForBatch(new Set(['key-one-valid']))).toBe('key-two-valid');

    rotator.markKeyCooldown('key-two-valid', 'rateLimit', 5_000);
    expect(rotator.getKeyForBatch(new Set(['key-one-valid']))).toBe('key-three-valid');

    now += 45_001;
    expect(rotator.getKeyForBatch(new Set(['key-one-valid', 'key-three-valid']))).toBe('key-two-valid');
  });

  it('recovers quota and suspect key states after their block windows', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid,key-three-valid');

    rotator.markKeyResult('key-one-valid', { kind: 'quota' });
    rotator.markKeyResult('key-two-valid', { kind: 'suspect' });

    expect(rotator.getKeyHealthSnapshot().map(item => item.status)).toEqual(['quotaBlocked', 'suspect', 'healthy']);
    expect(rotator.getKeyForBatch()).toBe('key-three-valid');

    now += 30_001;
    expect(rotator.getKeyForBatch(new Set(['key-three-valid']))).toBe('key-two-valid');

    now += 30 * 60 * 1000;
    expect(rotator.availableKeyCount).toBe(3);
    expect(rotator.getKeyForBatch(new Set(['key-two-valid', 'key-three-valid']))).toBe('key-one-valid');
  });

  it('prefers keys with less recent error history', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid');

    rotator.markKeyResult('key-one-valid', { kind: 'suspect' });
    now += 30_001;

    expect(rotator.availableKeyCount).toBe(2);
    expect(rotator.selectBestKey()).toBe('key-two-valid');
  });

  it('tracks in-flight count and always allows release back to zero', () => {
    const rotator = new UserKeyRotator();
    rotator.init('key-one-valid,key-two-valid');

    rotator.markKeyInFlight('key-one-valid');
    expect(rotator.getKeyHealthSnapshot()[0].inFlightCount).toBe(1);

    rotator.releaseKeyInFlight('key-one-valid');
    rotator.releaseKeyInFlight('key-one-valid');
    expect(rotator.getKeyHealthSnapshot()[0].inFlightCount).toBe(0);
  });

  it('keeps rate limits key-specific even after provider pressure', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid');

    rotator.markProviderPressure(3_000);
    expect(rotator.availableKeyCount).toBe(2);

    rotator.markKeyCooldown('key-two-valid', 'rateLimit');
    const shortestWait = rotator.getNextCooldownDelayMs();

    expect(rotator.availableKeyCount).toBe(1);
    expect(rotator.getKeyForBatch()).toBe('key-one-valid');
    expect(shortestWait).toBeLessThanOrEqual(3 * 60 * 1000);
  });

  it('caps recommended concurrency to the number of healthy keys after permanent failures', () => {
    const rotator = new UserKeyRotator();
    rotator.init('key-one-valid,key-two-valid,key-three-valid', 3);

    expect(rotator.getRecommendedConcurrency()).toBe(3);

    rotator.markKeyFailed('key-one-valid');
    expect(rotator.getRecommendedConcurrency()).toBe(2);

    rotator.markKeyFailed('key-two-valid');
    expect(rotator.getRecommendedConcurrency()).toBe(1);
  });

  it('does not block healthy keys with pool cooldown while another key is still available', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid,key-three-valid', 3);

    rotator.markKeyCooldown('key-one-valid', 'rateLimit', 5_000);
    now += 1_000;
    rotator.markKeyCooldown('key-two-valid', 'rateLimit', 5_000);

    expect(rotator.availableKeyCount).toBe(1);
    expect(rotator.getNextCooldownDelayMs()).toBe(44_000);
    expect(rotator.getKeyForBatch()).toBe('key-three-valid');
  });

  it('reduces concurrency on repeated rate limits and recovers after stable successes', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now, () => 0);
    rotator.init('key-one-valid,key-two-valid,key-three-valid', 3);

    expect(rotator.getRecommendedConcurrency()).toBe(3);

    rotator.markKeyCooldown('key-one-valid', 'rateLimit', 5_000);
    expect(rotator.getRecommendedConcurrency()).toBe(2);

    now += 1_000;
    rotator.markKeyCooldown('key-two-valid', 'rateLimit', 5_000);
    expect(rotator.getRecommendedConcurrency()).toBe(1);

    now += 45_001;
    for (let i = 0; i < 4; i++) rotator.reportSuccess('key-three-valid');
    expect(rotator.getRecommendedConcurrency()).toBe(2);

    for (let i = 0; i < 6; i++) rotator.reportSuccess('key-three-valid');
    expect(rotator.getRecommendedConcurrency()).toBe(3);
  });

  it('can export and import health state across sessions', () => {
    let now = 1_000;
    const rotator1 = new UserKeyRotator(() => now, () => 0.5);
    rotator1.init('key-1-valid,key-2-valid', 1);
    
    // Simulate some usage and a failure
    rotator1.markKeyResult('key-1-valid', { kind: 'success' });
    rotator1.markKeyResult('key-2-valid', { kind: 'rateLimit', durationMs: 60000 });
    
    const exportedState = rotator1.exportHealthState();
    expect(exportedState['key-1-valid']).toBeDefined();
    expect(exportedState['key-1-valid'].successCount).toBe(1);
    expect(exportedState['key-2-valid'].status).toBe('cooldown');
    
    const rotator2 = new UserKeyRotator(() => now, () => 0.5);
    rotator2.init('key-1-valid,key-2-valid', 1);
    
    // Before import, key-2 should be healthy (due to init resetting state)
    expect(rotator2.isKeyAvailable('key-2-valid')).toBe(true);
    
    rotator2.importHealthState(exportedState);
    
    // After import, key-2 should be in cooldown (inherited from exportedState)
    expect(rotator2.isKeyAvailable('key-2-valid')).toBe(false);
    expect(rotator2.getKeyHealthSnapshot().find(s => s.keyNumber === 1)?.successCount).toBe(1);
  });

  it('does not apply quota penalty when only one key is present', () => {
    const rotator = new UserKeyRotator(() => 1000, () => 0);
    rotator.init('only-one-key', 1);
    
    // Fill usage history with more than 3 entries
    for (let i = 0; i < 5; i++) {
      rotator.markKeyResult('only-one-key', { kind: 'success' });
    }
    
    // The key should still be selected (no 2000 penalty making it impossible)
    expect(rotator.selectBestKey()).toBe('only-one-key');
  });

  it('scales recommended rotation limit and circuit breaker threshold based on key count', () => {
    const rotator = new UserKeyRotator(() => 1000, () => 0);

    // 1. Check with a small pool (3 keys)
    rotator.init('key-1-valid,key-2-valid,key-3-valid', 3);
    expect(rotator.getRecommendedRotationLimit()).toBe(2); // total <= 6 is 2
    expect(rotator.getCircuitBreakerThreshold()).toBe(3);

    // 2. Check with a medium pool (6 keys)
    rotator.init('key-1-valid,key-2-valid,key-3-valid,key-4-valid,key-5-valid,key-6-valid', 6);
    expect(rotator.getRecommendedRotationLimit()).toBe(2); // total <= 6 is 2
    expect(rotator.getCircuitBreakerThreshold()).toBe(4); // total <= 6 is 4

    // 3. Check with a large pool (31 keys)
    const largeKeys = Array.from({ length: 31 }, (_, i) => `key-${i + 1}-valid`).join(',');
    rotator.init(largeKeys, 31);
    expect(rotator.getRecommendedRotationLimit()).toBe(8); // Math.max(3, Math.min(10, Math.ceil(31 * 0.25))) = 8
    expect(rotator.getCircuitBreakerThreshold()).toBe(8); // Math.max(5, Math.min(10, Math.ceil(31 * 0.25))) = 8
  });
});
