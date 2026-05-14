import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearPerfMetrics,
  getPerfSnapshot,
  getRecentSlowMetricCount,
  hasRecentSlowMetrics,
  measureAsync,
  recordPerfMetric,
} from './performance';

describe('performance monitor', () => {
  beforeEach(() => {
    clearPerfMetrics();
  });

  it('keeps only the most recent 200 metrics', () => {
    for (let index = 0; index < 205; index++) {
      recordPerfMetric({
        name: `metric-${index}`,
        durationMs: 1,
        startedAt: index,
        kind: 'measure',
      });
    }

    const snapshot = getPerfSnapshot();
    expect(snapshot).toHaveLength(200);
    expect(snapshot[0].name).toBe('metric-5');
    expect(snapshot[199].name).toBe('metric-204');
  });

  it('counts recent slow and long metrics for adaptive throttling', () => {
    const now = performance.now();
    recordPerfMetric({ name: 'visible.append', durationMs: 55, startedAt: now - 200, kind: 'slow' });
    recordPerfMetric({ name: 'browser.longtask', durationMs: 120, startedAt: now - 100, kind: 'longtask' });
    recordPerfMetric({ name: 'old.slow', durationMs: 80, startedAt: now - 10000, kind: 'slow' });

    expect(getRecentSlowMetricCount({ sinceMs: 1000 })).toBe(2);
    expect(getRecentSlowMetricCount({ sinceMs: 1000, namePrefix: 'visible' })).toBe(1);
    expect(hasRecentSlowMetrics({ sinceMs: 1000, threshold: 2 })).toBe(true);
    expect(hasRecentSlowMetrics({ sinceMs: 1000, threshold: 3 })).toBe(false);
  });

  it('does not treat async wall time as main-thread slow work', async () => {
    await measureAsync('idb.saveSession', () => new Promise<void>(resolve => {
      setTimeout(resolve, 60);
    }));

    expect(getPerfSnapshot()[0].kind).toBe('measure');
    expect(hasRecentSlowMetrics({ sinceMs: 1000, threshold: 1 })).toBe(false);
  });
});
