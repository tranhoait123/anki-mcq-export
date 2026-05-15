import { describe, expect, it } from 'vitest';
import { MCQ } from '../../types';
import {
  createBatchPostprocessState,
  processBatchPostprocess,
} from './batchPostprocess';

const makeQuestion = (id: number): MCQ => ({
  id: `seed-${id}`,
  question: `Câu ${id}: Bệnh nhân số ${id} cần chọn đáp án nào?`,
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: 'A',
  explanation: {
    core: 'A đúng.',
    evidence: 'Bằng chứng mock.',
    analysis: 'Phân tích mock.',
    warning: '',
  },
  source: 'seed',
  difficulty: 'Easy',
  depthAnalysis: 'Nhận biết',
});

describe('processBatchPostprocess', () => {
  it('parses, dedupes, and tracks coverage off the generation hot path', async () => {
    const seed = makeQuestion(1);
    const fresh: MCQ = {
      ...makeQuestion(2),
      question: 'Câu 2: Cơ chế tác dụng chính của thuốc lợi tiểu quai là gì?',
      options: ['A. Ức chế NKCC2', 'B. Ức chế ACE', 'C. Chẹn beta', 'D. Tăng ADH'],
      correctAnswer: 'A',
    };
    const state = createBatchPostprocessState([seed]);
    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 2,
      fullText: JSON.stringify({ questions: [seed, fresh] }),
      partMeta: {
        sourceLabel: 'Nhi_10.pdf | Trang 1',
        text: '',
      },
      topLevelBatchNumber: 1,
    }, state);

    expect(result.rawQuestions).toHaveLength(2);
    expect(result.newQuestions).toHaveLength(1);
    expect(result.newQuestions[0].question).toBe(fresh.question.replace(/^Câu\s*\d+[:.]\s*/i, ''));
    expect(result.autoSkippedCount).toBe(1);
    expect(result.coverageKeys.length).toBeGreaterThanOrEqual(1);
  });

  it('keeps partial salvage metadata for recovery decisions', async () => {
    const state = createBatchPostprocessState();
    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 3,
      fullText: JSON.stringify({ questions: [makeQuestion(1)] }),
      partMeta: { sourceLabel: 'partial.pdf' },
      topLevelBatchNumber: 1,
    }, state);

    expect(result.salvagedPartial).toBe(true);
    expect(result.missingCount).toBe(2);
    expect(result.newQuestions).toHaveLength(1);
  });
});
