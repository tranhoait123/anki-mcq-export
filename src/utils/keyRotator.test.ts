import { describe, expect, it } from 'vitest';
import { UserKeyRotator } from './keyRotator';

describe('UserKeyRotator safety patch', () => {
  it('skips keys marked failed by 403/invalid errors', () => {
    const rotator = new UserKeyRotator();
    rotator.init('key-one-valid,key-two-valid,key-three-valid');

    rotator.markKeyFailed('key-one-valid');

    expect(rotator.availableKeyCount).toBe(2);
    expect(rotator.hardFailedKeyCount).toBe(1);
    expect(rotator.getKeyForBatch()).toBe('key-two-valid');
    expect(rotator.getKeyForBatch()).toBe('key-three-valid');
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
    expect(rotator.getMaxKeysPerOperation()).toBe(3);
    expect(rotator.getRecommendedConcurrency()).toBe(1);
    expect(rotator.getNextCooldownDelayMs()).toBe(12_000);

    now += 12_001;
    expect(rotator.availableKeyCount).toBe(4);
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
    expect(rotator.getNextCooldownDelayMs()).toBe(4_000);
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

    now += 25_000;
    for (let i = 0; i < 4; i++) rotator.reportSuccess('key-three-valid');
    expect(rotator.getRecommendedConcurrency()).toBe(2);

    for (let i = 0; i < 6; i++) rotator.reportSuccess('key-three-valid');
    expect(rotator.getRecommendedConcurrency()).toBe(3);
  });
});
