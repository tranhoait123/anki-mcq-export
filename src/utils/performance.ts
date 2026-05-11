const getIsDevMode = () => {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
};

const isDevMode = getIsDevMode();

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
  if (!isDevMode || typeof performance === 'undefined') return work();
  const startedAt = performance.now();
  try {
    return await work();
  } finally {
    const elapsed = Math.round((performance.now() - startedAt) * 10) / 10;
    console.debug(`[perf] ${label}: ${elapsed}ms`);
  }
};

export const measureSync = <T,>(label: string, work: () => T): T => {
  if (!isDevMode || typeof performance === 'undefined') return work();
  const startedAt = performance.now();
  try {
    return work();
  } finally {
    const elapsed = Math.round((performance.now() - startedAt) * 10) / 10;
    console.debug(`[perf] ${label}: ${elapsed}ms`);
  }
};
