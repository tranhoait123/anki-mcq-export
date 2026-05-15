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
