import { describe, expect, it } from 'vitest';
import { MCQ } from '../types';
import { inferCompletedBatchIndicesFromExistingQuestions } from './brain';

const makeQuestion = (id: number, source: string): MCQ => ({
  id: `q-${id}`,
  question: `Câu ${id}. Nội dung câu hỏi`,
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: 'A',
  explanation: {
    core: '',
    evidence: '',
    analysis: '',
    warning: '',
  },
  source,
  difficulty: 'Medium',
  depthAnalysis: '',
});

describe('resume batch inference', () => {
  it('marks a structured batch complete when restored questions already cover its source label', () => {
    const parts = [
      {
        text: '<<<MCQ 1>>> Câu 1\n<<<MCQ 2>>> Câu 2',
        expectedQuestions: 2,
        sourceLabel: 'deck.docx | Nhóm 1',
      },
      {
        text: '<<<MCQ 1>>> Câu 3\n<<<MCQ 2>>> Câu 4',
        expectedQuestions: 2,
        sourceLabel: 'deck.docx | Nhóm 2',
      },
    ];

    const completed = inferCompletedBatchIndicesFromExistingQuestions(parts, [
      makeQuestion(1, 'deck.docx | Nhóm 1'),
      makeQuestion(2, 'deck.docx | Nhóm 1'),
      makeQuestion(3, 'deck.docx | Nhóm 2'),
    ]);

    expect(completed).toEqual([1]);
  });

  it('does not infer completion for uncountable vision batches', () => {
    const completed = inferCompletedBatchIndicesFromExistingQuestions(
      [{ sourceLabel: 'scan.pdf | Trang 1' }],
      [makeQuestion(1, 'scan.pdf | Trang 1')]
    );

    expect(completed).toEqual([]);
  });
});
