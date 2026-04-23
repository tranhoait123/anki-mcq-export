import { describe, expect, it } from 'vitest';
import { UserKeyRotator } from './keyRotator';

describe('UserKeyRotator safety patch', () => {
  it('skips keys marked failed by 403/invalid errors', () => {
    const rotator = new UserKeyRotator();
    rotator.init('key-one-valid,key-two-valid,key-three-valid');

    rotator.markKeyFailed('key-one-valid');

    expect(rotator.availableKeyCount).toBe(2);
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

  it('returns no key when every non-failed key is cooling down', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now);
    rotator.init('key-one-valid,key-two-valid');
    rotator.markKeyFailed('key-one-valid');
    rotator.markKeyCooldown('key-two-valid', 'serverBusy');

    expect(rotator.availableKeyCount).toBe(0);
    expect(rotator.getKeyForBatch()).toBe('');
    expect(rotator.rotate()).toBe('');
    expect(rotator.getNextCooldownDelayMs()).toBeGreaterThan(0);
  });

  it('uses shorter cooldowns for server busy than rate limits', () => {
    let now = 1_000;
    const rotator = new UserKeyRotator(() => now);
    rotator.init('key-one-valid,key-two-valid');

    rotator.markKeyCooldown('key-one-valid', 'serverBusy');
    const serverBusyWait = rotator.getNextCooldownDelayMs();
    rotator.markKeyCooldown('key-two-valid', 'rateLimit');
    const shortestWait = rotator.getNextCooldownDelayMs();

    expect(serverBusyWait).toBeLessThan(3 * 60 * 1000);
    expect(shortestWait).toBeLessThanOrEqual(serverBusyWait);
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
    rotator.reportSuccess('key-three-valid');
    rotator.reportSuccess('key-three-valid');
    expect(rotator.getRecommendedConcurrency()).toBe(2);

    rotator.reportSuccess('key-three-valid');
    rotator.reportSuccess('key-three-valid');
    rotator.reportSuccess('key-three-valid');
    rotator.reportSuccess('key-three-valid');
    expect(rotator.getRecommendedConcurrency()).toBe(3);
  });
});
