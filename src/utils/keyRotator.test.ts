import { describe, expect, it } from 'vitest';
import { UserKeyRotator } from './keyRotator';

describe('UserKeyRotator scheduler v2', () => {
  it('auth-blocks invalid keys temporarily and lets them recover', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now);
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

  it('puts rate-limited keys on cooldown and reuses them after cooldown expires', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now);
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
    const rotator = new UserKeyRotator(() => now);
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
    const rotator = new UserKeyRotator(() => now);
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
    const rotator = new UserKeyRotator(() => now);
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
    const rotator = new UserKeyRotator(() => now);
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

  it('caps per-operation key visits at eight healthy keys', () => {
    const rotator = new UserKeyRotator();
    const keys = Array.from({ length: 31 }, (_unused, index) => `key-${index + 1}-valid`);
    rotator.init(keys.join(','), 10);

    expect(rotator.availableKeyCount).toBe(31);
    expect(rotator.getMaxKeysPerOperation()).toBe(8);

    keys.slice(0, 25).forEach(key => rotator.markKeyFailed(key));
    expect(rotator.availableKeyCount).toBe(6);
    expect(rotator.getMaxKeysPerOperation()).toBe(8);
  });

  it('selects an available batch key outside excluded and cooling keys', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now);
    rotator.init('key-one-valid,key-two-valid,key-three-valid');

    expect(rotator.getKeyForBatch(new Set(['key-one-valid']))).toBe('key-two-valid');

    rotator.markKeyCooldown('key-two-valid', 'rateLimit', 5_000);
    expect(rotator.getKeyForBatch(new Set(['key-one-valid']))).toBe('key-three-valid');

    now += 45_001;
    expect(rotator.getKeyForBatch(new Set(['key-one-valid', 'key-three-valid']))).toBe('key-two-valid');
  });

  it('recovers quota and suspect key states after their block windows', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now);
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
    const rotator = new UserKeyRotator(() => now);
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
    const rotator = new UserKeyRotator(() => now);
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
    const rotator = new UserKeyRotator(() => now);
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
    const rotator = new UserKeyRotator(() => now);
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
});
