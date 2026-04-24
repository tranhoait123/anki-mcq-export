import { describe, expect, it } from 'vitest';
import { cleanText, formatSessionPhase, getPersistableFiles, sortMcqsByQuestionNumber, summarizeBatchFailures } from './appHelpers';
import { MCQ } from '../types';

const mcq = (question: string): MCQ => ({
  id: question,
  question,
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: 'A',
  explanation: { core: '', evidence: '', analysis: '', warning: '' },
  source: '',
  difficulty: '',
  depthAnalysis: '',
});

describe('app helpers', () => {
  it('keeps question sorting behavior numeric and stable for unnumbered items', () => {
    expect(sortMcqsByQuestionNumber([mcq('Câu 10'), mcq('Câu 2'), mcq('Không số')]).map(item => item.question))
      .toEqual(['Câu 2', 'Câu 10', 'Không số']);
  });

  it('cleans question and option labels for export', () => {
    expect(cleanText('Câu 12: Nội dung', 'question')).toBe('Nội dung');
    expect(cleanText('B. Đáp án', 'option')).toBe('Đáp án');
  });

  it('filters only completed files for persistence', () => {
    expect(getPersistableFiles([
      { id: '1', name: 'ready.txt', type: 'text/plain', content: 'ok', progress: 10 },
      { id: '2', name: 'loading.txt', type: 'text/plain', content: 'ok', isProcessing: true },
      { id: '3', name: 'empty.txt', type: 'text/plain', content: '' },
    ])).toEqual([{ id: '1', name: 'ready.txt', type: 'text/plain', content: 'ok', progress: 100, isProcessing: false }]);
  });

  it('formats processing phases for resume UI', () => {
    expect(formatSessionPhase('initial')).toBe('Trích xuất chính');
    expect(formatSessionPhase('fallback')).toBe('Fallback OCR');
    expect(formatSessionPhase('rescue')).toBe('Tự cứu batch lỗi');
    expect(formatSessionPhase('retryFailed')).toBe('Quét lại batch lỗi');
  });

  it('summarizes batch failures by reason and advice', () => {
    expect(summarizeBatchFailures([
      { index: 1, label: 'Batch 1', kind: 'format', stage: 'normal', message: 'JSON lỗi', advice: 'Thử lại.' },
      { index: 2, label: 'Batch 2', kind: 'format', stage: 'normal', message: 'JSON lỗi', advice: 'Thử lại.' },
    ], [1, 2])).toContain('Batch 1, Batch 2: JSON lỗi');
  });
});
