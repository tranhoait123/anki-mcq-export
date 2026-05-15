import { DuplicateInfo, MCQ } from '../../types';
import { measureAsync, recordPerfMetric } from '../../utils/performance';
import {
  BatchPostprocessInput,
  BatchPostprocessResult,
  compactQuestionForDedupe,
  createBatchPostprocessState,
  ingestBatchPostprocessResult,
  processBatchPostprocess,
} from './batchPostprocess';

export interface BatchPostprocessor {
  dispose: () => void;
  processBatch: (input: BatchPostprocessInput) => Promise<BatchPostprocessResult>;
  start: (seedQuestions: MCQ[], seedDuplicates?: DuplicateInfo[]) => Promise<void>;
}

export interface BatchPostprocessorOptions {
  workerFactory?: () => Worker;
}

type PendingRequest<T> = {
  reject: (error: Error) => void;
  resolve: (value: T) => void;
};

type LocalBatchPostprocessor = BatchPostprocessor & {
  ingestResult: (result: BatchPostprocessResult, topLevelBatchNumber: number) => void;
};

const recordWorkerFallback = (error: unknown) => {
  recordPerfMetric({
    name: 'batchPostprocess.workerFallback',
    durationMs: 0,
    startedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    kind: 'measure',
    meta: { reason: error instanceof Error ? error.message : String(error) },
  });
};

const createLocalBatchPostprocessor = (): LocalBatchPostprocessor => {
  let state = createBatchPostprocessState();
  let disposed = false;
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
    const next = chain.catch(() => undefined).then(work);
    chain = next.catch(() => undefined);
    return next;
  };

  return {
    dispose: () => {
      disposed = true;
    },
    processBatch: (input) => enqueue(() => {
      if (disposed) return Promise.reject(new Error('Batch postprocessor disposed'));
      return measureAsync('batchPostprocess.mainThread', () => processBatchPostprocess(input, state, {
        cooperative: true,
        yieldEvery: 6,
      }));
    }),
    ingestResult: (result, topLevelBatchNumber) => {
      ingestBatchPostprocessResult(state, result, topLevelBatchNumber);
    },
    start: async (seedQuestions, seedDuplicates = []) => {
      state = createBatchPostprocessState(seedQuestions, seedDuplicates.length);
      disposed = false;
    },
  };
};

export const createBatchPostprocessor = (
  options: BatchPostprocessorOptions = {}
): BatchPostprocessor => {
  const localFallback = createLocalBatchPostprocessor();
  const createWorker = options.workerFactory || (() => new Worker(
    new URL('../../workers/batchPostprocessWorker.ts', import.meta.url),
    { type: 'module' }
  ));

  if (typeof Worker === 'undefined' && !options.workerFactory) return localFallback;

  let worker: Worker | null = null;
  let disposed = false;
  let nextRequestId = 1;
  let usingFallback = false;
  const pending = new Map<number, PendingRequest<any>>();

  const disableWorker = (error: unknown) => {
    if (!usingFallback) recordWorkerFallback(error);
    usingFallback = true;
    pending.forEach(({ reject }) => reject(error instanceof Error ? error : new Error(String(error))));
    pending.clear();
    worker?.terminate();
    worker = null;
  };

  const postWorkerMessage = <T,>(message: Record<string, unknown>): Promise<T> => {
    if (!worker || disposed || usingFallback) return Promise.reject(new Error('Batch postprocessor worker unavailable'));
    const requestId = nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        worker?.postMessage({ ...message, requestId });
      } catch (error) {
        pending.delete(requestId);
        disableWorker(error);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  try {
    worker = createWorker();
  } catch (error) {
    recordWorkerFallback(error);
    return localFallback;
  }

  worker.onmessage = (event: MessageEvent) => {
    const message = event.data || {};
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (message.type === 'error') {
      request.reject(new Error(message.error || 'Batch postprocess worker failed'));
      return;
    }
    request.resolve(message.result);
  };

  worker.onerror = (event) => {
    disableWorker(event.error || new Error(event.message || 'Batch postprocess worker failed'));
  };

  return {
    dispose: () => {
      disposed = true;
      pending.forEach(({ reject }) => reject(new Error('Batch postprocessor disposed')));
      pending.clear();
      try {
        worker?.postMessage({ type: 'dispose' });
      } catch {
        // Disposal is best-effort.
      }
      worker?.terminate();
      worker = null;
      localFallback.dispose();
    },
    processBatch: async (input) => {
      if (disposed) throw new Error('Batch postprocessor disposed');
      if (usingFallback || !worker) return localFallback.processBatch(input);
      try {
        const result = await measureAsync('batchPostprocess.worker', () =>
          postWorkerMessage<BatchPostprocessResult>({ type: 'process', input })
        );
        localFallback.ingestResult(result, input.topLevelBatchNumber);
        return result;
      } catch (error) {
        if (usingFallback) return localFallback.processBatch(input);
        throw error;
      }
    },
    start: async (seedQuestions, seedDuplicates = []) => {
      await localFallback.start(seedQuestions, seedDuplicates);
      if (disposed || usingFallback || !worker) return;
      try {
        await postWorkerMessage<void>({
          type: 'start',
          seedQuestions: seedQuestions.map(compactQuestionForDedupe),
          seedDuplicateCount: seedDuplicates.length,
        });
      } catch (error) {
        disableWorker(error);
      }
    },
  };
};
