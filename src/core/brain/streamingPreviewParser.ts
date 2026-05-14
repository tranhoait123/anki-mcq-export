import { MCQ } from '../../types';
import {
  measureAsync,
  recordPerfMetric,
} from '../../utils/performance';
import { createStreamingQuestionBuffer } from './parsing';

export interface StreamingPreviewParser {
  append: (chunk: string) => void;
  flush: () => Promise<MCQ[]>;
  dispose: () => void;
}

export interface StreamingPreviewParserOptions {
  workerFactory?: () => Worker;
}

type PendingFlush = {
  resolve: (questions: MCQ[]) => void;
  reject: (error: Error) => void;
};

const createMainThreadStreamingPreviewParser = (): StreamingPreviewParser => {
  const buffer = createStreamingQuestionBuffer();
  let disposed = false;

  return {
    append: (chunk: string) => {
      if (disposed) return;
      buffer.append(chunk);
    },
    flush: () => (
      measureAsync('streamPreview.flush.mainThread', async () => (
        disposed ? [] : buffer.drain() as MCQ[]
      ))
    ),
    dispose: () => {
      disposed = true;
    },
  };
};

export const createStreamingPreviewParser = (
  options: StreamingPreviewParserOptions = {}
): StreamingPreviewParser => {
  let fallback: StreamingPreviewParser | null = null;
  const getFallback = () => {
    if (!fallback) fallback = createMainThreadStreamingPreviewParser();
    return fallback;
  };
  const createWorker = options.workerFactory || (() => new Worker(
    new URL('../../workers/streamingPreviewWorker.ts', import.meta.url),
    { type: 'module' }
  ));

  if (typeof Worker === 'undefined' && !options.workerFactory) return getFallback();

  let worker: Worker | null = null;
  let disposed = false;
  let nextRequestId = 1;
  const pending = new Map<number, PendingFlush>();

  const disableWorker = (error?: unknown) => {
    if (error) {
      recordPerfMetric({
        name: 'streamPreview.workerFallback',
        durationMs: 0,
        startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
        kind: 'measure',
        meta: { reason: error instanceof Error ? error.message : String(error) },
      });
    }
    pending.forEach(({ resolve }) => resolve([]));
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  try {
    worker = createWorker();
  } catch (error) {
    recordPerfMetric({
      name: 'streamPreview.workerFallback',
      durationMs: 0,
      startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      kind: 'measure',
      meta: { reason: error instanceof Error ? error.message : String(error) },
    });
    return getFallback();
  }

  worker.onmessage = (event: MessageEvent) => {
    const message = event.data || {};
    if (message.type === 'questions') {
      const pendingFlush = pending.get(message.requestId);
      if (!pendingFlush) return;
      pending.delete(message.requestId);
      pendingFlush.resolve((message.questions || []) as MCQ[]);
      return;
    }

    if (message.type === 'error') {
      const pendingFlush = pending.get(message.requestId);
      if (pendingFlush) {
        pending.delete(message.requestId);
        pendingFlush.resolve([]);
      }
      if (!message.requestId) disableWorker(message.error);
    }
  };

  worker.onerror = (event) => {
    disableWorker(event.error || new Error(event.message || 'Streaming preview worker failed'));
  };

  return {
    append: (chunk: string) => {
      if (disposed) return;
      if (!worker) {
        getFallback().append(chunk);
        return;
      }
      try {
        worker.postMessage({ type: 'append', chunk });
      } catch (error) {
        disableWorker(error);
        getFallback().append(chunk);
      }
    },
    flush: () => {
      if (disposed) return Promise.resolve([]);
      if (!worker) return fallback?.flush() ?? Promise.resolve([]);

      const requestId = nextRequestId++;
      return measureAsync('streamPreview.flush.worker', () => new Promise<MCQ[]>((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        try {
          worker?.postMessage({ type: 'flush', requestId });
        } catch (error) {
          pending.delete(requestId);
          disableWorker(error);
          resolve([]);
        }
      }));
    },
    dispose: () => {
      disposed = true;
      pending.forEach(({ resolve }) => resolve([]));
      pending.clear();
      try {
        worker?.postMessage({ type: 'dispose' });
      } catch {
        // Worker disposal is best-effort.
      }
      worker?.terminate();
      worker = null;
      fallback?.dispose();
    },
  };
};
