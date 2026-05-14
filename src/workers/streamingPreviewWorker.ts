/// <reference lib="webworker" />

import { createStreamingQuestionBuffer } from '../core/brain/parsing';

type StreamingPreviewWorkerRequest =
  | { type: 'append'; chunk: string }
  | { type: 'flush'; requestId: number }
  | { type: 'reset' }
  | { type: 'dispose' };

let buffer = createStreamingQuestionBuffer();

self.onmessage = (event: MessageEvent<StreamingPreviewWorkerRequest>) => {
  const message = event.data;

  try {
    if (message.type === 'append') {
      buffer.append(message.chunk || '');
      return;
    }

    if (message.type === 'flush') {
      self.postMessage({
        type: 'questions',
        requestId: message.requestId,
        questions: buffer.drain(),
      });
      return;
    }

    if (message.type === 'reset') {
      buffer = createStreamingQuestionBuffer();
      return;
    }

    if (message.type === 'dispose') {
      self.close();
    }
  } catch (error: any) {
    self.postMessage({
      type: 'error',
      requestId: message.type === 'flush' ? message.requestId : undefined,
      error: error?.message || 'Streaming preview worker failed',
    });
  }
};
