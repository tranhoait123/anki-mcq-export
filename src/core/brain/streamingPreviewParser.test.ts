import { describe, expect, it } from 'vitest';
import { createStreamingQuestionBuffer } from './parsing';
import { createStreamingPreviewParser } from './streamingPreviewParser';

const question = (id: number) => ({
  question: `Câu ${id}: Nội dung preview ${id}?`,
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: 'A',
  explanation: { core: '', evidence: '', analysis: '', warning: '' },
  source: 'worker-fixture',
  difficulty: 'Easy',
  depthAnalysis: '',
});

class FakeStreamingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private buffer = createStreamingQuestionBuffer();

  postMessage(message: any) {
    if (message.type === 'append') {
      this.buffer.append(message.chunk);
      return;
    }
    if (message.type === 'flush') {
      this.onmessage?.({
        data: {
          type: 'questions',
          requestId: message.requestId,
          questions: this.buffer.drain(),
        },
      } as MessageEvent);
    }
  }

  terminate() {}
}

describe('createStreamingPreviewParser', () => {
  it('uses a worker to emit completed preview questions without duplicates', async () => {
    const parser = createStreamingPreviewParser({
      workerFactory: () => new FakeStreamingWorker() as unknown as Worker,
    });
    const payload = JSON.stringify({ questions: [question(1), question(2)] });
    const chunks = payload.match(/.{1,17}/g) || [];
    const emitted = [];

    for (const chunk of chunks) {
      parser.append(chunk);
      emitted.push(...await parser.flush());
    }

    expect(emitted.map(item => item.question)).toEqual([
      'Nội dung preview 1?',
      'Nội dung preview 2?',
    ]);
    expect(await parser.flush()).toEqual([]);
    parser.dispose();
  });

  it('falls back to the main-thread parser when worker creation fails', async () => {
    const parser = createStreamingPreviewParser({
      workerFactory: () => {
        throw new Error('worker unavailable');
      },
    });
    parser.append(JSON.stringify({ questions: [question(3)] }));

    const emitted = await parser.flush();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].question).toBe('Nội dung preview 3?');
    parser.dispose();
  });
});
