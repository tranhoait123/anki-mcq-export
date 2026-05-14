const getIsDevMode = () => {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
};

const isDevMode = getIsDevMode();
const MAX_PERF_METRICS = 200;
const SLOW_TASK_MS = 50;
const LONG_TASK_MS = 100;

export type PerfMetricKind = 'measure' | 'slow' | 'longtask';

export interface PerfMetric {
  name: string;
  durationMs: number;
  startedAt: number;
  kind: PerfMetricKind;
  meta?: Record<string, unknown>;
}

const perfMetrics: PerfMetric[] = [];
let longTaskObserverStarted = false;

const getNow = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

const classifyDuration = (durationMs: number): PerfMetricKind =>
  durationMs >= LONG_TASK_MS ? 'longtask' : durationMs >= SLOW_TASK_MS ? 'slow' : 'measure';

export const recordPerfMetric = (metric: PerfMetric): void => {
  if (!Number.isFinite(metric.durationMs)) return;
  perfMetrics.push({
    ...metric,
    durationMs: Math.round(metric.durationMs * 10) / 10,
  });
  if (perfMetrics.length > MAX_PERF_METRICS) {
    perfMetrics.splice(0, perfMetrics.length - MAX_PERF_METRICS);
  }
};

export const clearPerfMetrics = (): void => {
  perfMetrics.length = 0;
};

export const getPerfSnapshot = (): PerfMetric[] => perfMetrics.slice();

export const getRecentSlowMetricCount = (
  options: { sinceMs?: number; namePrefix?: string; includeLongTasks?: boolean } = {}
): number => {
  const sinceMs = options.sinceMs ?? 5000;
  const cutoff = getNow() - sinceMs;
  return perfMetrics.filter(metric => {
    if (metric.startedAt < cutoff) return false;
    if (options.namePrefix && !metric.name.startsWith(options.namePrefix)) return false;
    if (metric.kind === 'slow') return true;
    return options.includeLongTasks !== false && metric.kind === 'longtask';
  }).length;
};

export const hasRecentSlowMetrics = (
  options: { sinceMs?: number; namePrefix?: string; threshold?: number; includeLongTasks?: boolean } = {}
): boolean => (
  getRecentSlowMetricCount(options) >= (options.threshold ?? 3)
);

export const initPerformanceMonitor = (): void => {
  if (longTaskObserverStarted || typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;
  const supportedTypes = (PerformanceObserver as any).supportedEntryTypes as string[] | undefined;
  if (supportedTypes && !supportedTypes.includes('longtask')) return;

  try {
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((entry) => {
        recordPerfMetric({
          name: `browser.${entry.entryType}`,
          durationMs: entry.duration,
          startedAt: entry.startTime,
          kind: 'longtask',
        });
      });
    });
    observer.observe({ entryTypes: ['longtask'] });
    longTaskObserverStarted = true;
  } catch {
    longTaskObserverStarted = true;
  }
};

export const yieldToMain = (delay = 0): Promise<void> =>
  new Promise(resolve => globalThis.setTimeout(resolve, delay));

export const scheduleIdleTask = (callback: () => void, timeout = 800): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const requestIdle = (window as any).requestIdleCallback as ((cb: () => void, options?: { timeout: number }) => number) | undefined;
  const cancelIdle = (window as any).cancelIdleCallback as ((id: number) => void) | undefined;
  if (requestIdle) {
    const id = requestIdle(callback, { timeout });
    return () => cancelIdle?.(id);
  }
  const id = window.setTimeout(callback, 0);
  return () => window.clearTimeout(id);
};

export const measureAsync = async <T,>(label: string, work: () => Promise<T>): Promise<T> => {
  if (typeof performance === 'undefined') return work();
  const startedAt = getNow();
  try {
    return await work();
  } finally {
    const elapsed = getNow() - startedAt;
    recordPerfMetric({
      name: label,
      durationMs: elapsed,
      startedAt,
      kind: classifyDuration(elapsed),
    });
    if (isDevMode) console.debug(`[perf] ${label}: ${Math.round(elapsed * 10) / 10}ms`);
  }
};

export const measureSync = <T,>(label: string, work: () => T): T => {
  if (typeof performance === 'undefined') return work();
  const startedAt = getNow();
  try {
    return work();
  } finally {
    const elapsed = getNow() - startedAt;
    recordPerfMetric({
      name: label,
      durationMs: elapsed,
      startedAt,
      kind: classifyDuration(elapsed),
    });
    if (isDevMode) console.debug(`[perf] ${label}: ${Math.round(elapsed * 10) / 10}ms`);
  }
};

initPerformanceMonitor();
