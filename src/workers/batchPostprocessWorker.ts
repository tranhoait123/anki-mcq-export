/// <reference lib="webworker" />

import {
  BatchPostprocessInput,
  createBatchPostprocessState,
  processBatchPostprocess,
} from '../core/brain/batchPostprocess';
import { MCQ } from '../types';

type BatchPostprocessWorkerRequest =
  | { type: 'start'; requestId: number; seedDuplicateCount?: number; seedQuestions: MCQ[] }
  | { type: 'process'; requestId: number; input: BatchPostprocessInput }
  | { type: 'dispose' };

let state = createBatchPostprocessState();

self.onmessage = (event: MessageEvent<BatchPostprocessWorkerRequest>) => {
  const message = event.data;

  if (message.type === 'dispose') {
    self.close();
    return;
  }

  void (async () => {
    try {
      if (message.type === 'start') {
        state = createBatchPostprocessState(message.seedQuestions || [], message.seedDuplicateCount || 0);
        self.postMessage({ type: 'started', requestId: message.requestId, result: undefined });
        return;
      }

      const result = await processBatchPostprocess(message.input, state);
      self.postMessage({ type: 'result', requestId: message.requestId, result });
    } catch (error: any) {
      self.postMessage({
        type: 'error',
        requestId: message.requestId,
        error: error?.message || 'Batch postprocess worker failed',
      });
    }
  })();
};
