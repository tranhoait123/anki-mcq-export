import { describe, expect, it } from 'vitest';
import { MCQ } from '../../types';
import {
  compactQuestionForDedupe,
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
  it('keeps seed dedupe state compact while preserving match-critical fields', () => {
    const compact = compactQuestionForDedupe({
      ...makeQuestion(1),
      explanation: {
        core: 'x'.repeat(5000),
        evidence: 'heavy evidence',
        analysis: 'heavy analysis',
        warning: 'heavy warning',
      },
      trace: {
        fileId: 'file-1',
        fileName: 'deck.pdf',
        sourceLabel: 'deck.pdf | Trang 1',
        mode: 'pdfText',
      },
    });

    expect(compact).toMatchObject({
      id: 'seed-1',
      question: 'Câu 1: Bệnh nhân số 1 cần chọn đáp án nào?',
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      source: 'seed',
    });
    expect(compact.explanation).toEqual({
      core: '',
      evidence: '',
      analysis: '',
      warning: '',
    });
    expect(compact.trace?.sourceLabel).toBe('deck.pdf | Trang 1');
  });

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

  it('does not count seeded questions from the same source as recovered duplicates', async () => {
    const seed = {
      ...makeQuestion(1),
      source: 'deck.docx | Nhóm 1',
    };
    const state = createBatchPostprocessState([seed]);

    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 1,
      fullText: JSON.stringify({ questions: [seed] }),
      partMeta: {
        sourceLabel: 'deck.docx | Nhóm 1',
        text: '',
      },
      topLevelBatchNumber: 1,
    }, state);

    expect(result.newQuestions).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
    expect(result.autoSkippedCount).toBe(0);
    expect(result.coverageKeys).toHaveLength(0);
  });

  it('spends selective recovery budget when an existing question from another source covers the missing item', async () => {
    const seed = {
      ...makeQuestion(1),
      source: 'deck.docx | Nhóm khác',
    };
    const extra = {
      ...makeQuestion(2),
      question: 'Câu 2: Câu không nên xử lý khi budget đã đủ?',
    };
    const state = createBatchPostprocessState([seed]);

    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 2,
      fullText: JSON.stringify({ questions: [seed, extra] }),
      partMeta: {
        sourceLabel: 'deck.docx | Nhóm 1',
        text: '',
      },
      recoveryBudgetRemaining: 1,
      topLevelBatchNumber: 1,
    }, state);

    expect(result.autoSkippedCount).toBe(1);
    expect(result.coverageKeys).toHaveLength(1);
    expect(result.newQuestions).toHaveLength(0);
    expect(result.recoveryBudgetRemaining).toBe(0);
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
