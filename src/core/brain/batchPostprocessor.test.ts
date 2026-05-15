import { describe, expect, it } from 'vitest';
import { MCQ } from '../../types';
import { createBatchPostprocessor } from './batchPostprocessor';

const makeQuestion = (id: number): MCQ => ({
  id: `q-${id}`,
  question: `Câu ${id}: Fallback worker item ${id}?`,
  options: ['A. Đúng', 'B. Sai', 'C. Khác', 'D. Không rõ'],
  correctAnswer: 'A',
  explanation: {
    core: 'A đúng.',
    evidence: 'Mock.',
    analysis: 'Mock.',
    warning: '',
  },
  source: 'fallback',
  difficulty: 'Easy',
  depthAnalysis: 'Nhận biết',
});

describe('createBatchPostprocessor', () => {
  it('starts workers with compact seed questions and duplicate counts only', async () => {
    const messages: any[] = [];
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      postMessage(message: any) {
        messages.push(message);
        queueMicrotask(() => {
          this.onmessage?.({
            data: { requestId: message.requestId, result: undefined, type: 'started' },
          } as MessageEvent);
        });
      },
      terminate() {},
    };
    const postprocessor = createBatchPostprocessor({
      workerFactory: () => worker as unknown as Worker,
    });

    await postprocessor.start([
      {
        ...makeQuestion(1),
        explanation: {
          core: 'x'.repeat(5000),
          evidence: 'heavy',
          analysis: 'heavy',
          warning: 'heavy',
        },
      },
    ], [{
      id: 'dup-1',
      question: 'duplicate',
      reason: 'mock',
      matchedWith: 'seed',
      fullData: makeQuestion(2),
    }]);

    expect(messages[0]).toMatchObject({
      type: 'start',
      seedDuplicateCount: 1,
    });
    expect(messages[0].seedDuplicates).toBeUndefined();
    expect(messages[0].seedQuestions[0].explanation).toEqual({
      core: '',
      evidence: '',
      analysis: '',
      warning: '',
    });
    postprocessor.dispose();
  });

  it('falls back to cooperative main-thread postprocess when worker creation fails', async () => {
    const postprocessor = createBatchPostprocessor({
      workerFactory: () => {
        throw new Error('worker unavailable');
      },
    });
    await postprocessor.start([]);

    const result = await postprocessor.processBatch({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 1,
      fullText: JSON.stringify({ questions: [makeQuestion(1)] }),
      partMeta: { sourceLabel: 'fallback.pdf' },
      topLevelBatchNumber: 1,
    });

    expect(result.newQuestions).toHaveLength(1);
    expect(result.newQuestions[0].source).toBe('fallback.pdf');
    postprocessor.dispose();
  });
});
