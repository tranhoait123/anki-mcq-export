import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RollingWindowRequestRateLimiter } from './requestRateLimiter';

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('RollingWindowRequestRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the next request until the rolling minute window opens', async () => {
    const limiter = new RollingWindowRequestRateLimiter();
    const options = { enabled: true, limitPerMinute: 14, label: 'test' };

    await Promise.all(Array.from({ length: 14 }, () => limiter.waitForTurn(options)));

    let resolved = false;
    const fifteenth = limiter.waitForTurn(options).then(() => {
      resolved = true;
    });
    await flushPromises();

    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(59_999);
    await flushPromises();
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await fifteenth;
    expect(resolved).toBe(true);
  });

  it('serializes simultaneous reservations so concurrent callers cannot burst past the limit', async () => {
    const limiter = new RollingWindowRequestRateLimiter();
    const starts: number[] = [];
    const options = { enabled: true, limitPerMinute: 14, label: 'test' };

    const requests = Array.from({ length: 20 }, () => (
      limiter.waitForTurn(options).then(() => {
        starts.push(Date.now());
      })
    ));

    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(starts).toHaveLength(14);

    await vi.advanceTimersByTimeAsync(59_999);
    await flushPromises();
    expect(starts).toHaveLength(14);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.all(requests);

    expect(starts).toHaveLength(20);
    expect(starts.filter(startedAt => startedAt < 60_000)).toHaveLength(14);
    expect(starts.filter(startedAt => startedAt >= 60_000)).toHaveLength(6);
  });
});
