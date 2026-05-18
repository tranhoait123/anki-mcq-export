import { describe, expect, it } from 'vitest';
import { MCQ } from '../types';
import { selectPreferredPhaseOutcome, shouldDelayAutoRescue } from './resumeSession';

const makeQuestion = (id: number): MCQ => ({
  id: `q-${id}`,
  question: `Câu ${id}`,
  options: ['A. 1', 'B. 2', 'C. 3', 'D. 4'],
  correctAnswer: 'A',
  explanation: {
    core: 'core',
    evidence: 'evidence',
    analysis: 'analysis',
    warning: 'warning',
  },
  source: 'demo',
  difficulty: 'Medium',
  depthAnalysis: 'Standard',
});

describe('resume session selection', () => {
  it('keeps baseline failures when fallback is not better', () => {
    const result = selectPreferredPhaseOutcome({
      baselineQuestions: [makeQuestion(1), makeQuestion(2)],
      baselineFailedBatchIndices: [3],
      baselineFailedBatchDetails: [{
        index: 3,
        label: '3',
        kind: 'format',
        stage: 'normal',
        message: 'JSON lỗi',
        advice: 'Thử rescue',
      }],
      baselineMode: 'gemini',
      candidateQuestions: [makeQuestion(1)],
      candidateFailedBatchIndices: [2],
      candidateFailedBatchDetails: [{
        index: 2,
        label: '2',
        kind: 'empty',
        stage: 'normal',
        message: 'Rỗng',
        advice: 'Thử lại',
      }],
      candidateMode: 'tesseract',
    });

    expect(result.useCandidate).toBe(false);
    expect(result.questions).toHaveLength(2);
    expect(result.failedBatchIndices).toEqual([3]);
    expect(result.failedBatchDetails.map((item) => item.index)).toEqual([3]);
    expect(result.forcedOcrMode).toBe('gemini');
  });

  it('switches to fallback when it extracts more questions', () => {
    const result = selectPreferredPhaseOutcome({
      baselineQuestions: [makeQuestion(1)],
      baselineFailedBatchIndices: [4],
      baselineMode: 'gemini',
      candidateQuestions: [makeQuestion(1), makeQuestion(2), makeQuestion(3)],
      candidateFailedBatchIndices: [5],
      candidateFailedBatchDetails: [{
        index: 5,
        label: '5',
        kind: 'rateLimit',
        stage: 'normal',
        message: '429',
        advice: 'Đợi rồi thử lại',
      }],
      candidateMode: 'tesseract',
    });

    expect(result.useCandidate).toBe(true);
    expect(result.questions).toHaveLength(3);
    expect(result.failedBatchIndices).toEqual([5]);
    expect(result.forcedOcrMode).toBe('tesseract');
  });

  it('runs limited auto-rescue for small pressure failures but delays heavy pressure', () => {
    expect(shouldDelayAutoRescue([
      { index: 1, label: '1', kind: 'rateLimit', stage: 'normal', message: '429', advice: 'Đợi.' },
    ], [1])).toBe(false);

    expect(shouldDelayAutoRescue([
      { index: 1, label: '1', kind: 'rateLimit', stage: 'normal', message: '429', advice: 'Đợi.' },
      { index: 2, label: '2', kind: 'serverBusy', stage: 'partial', message: '503', advice: 'Đợi.' },
    ], [1, 2])).toBe(true);

    expect(shouldDelayAutoRescue([
      {
        index: 1,
        label: '1',
        kind: 'serverBusy',
        stage: 'partial',
        message: '503',
        advice: 'Đợi.',
        diagnostics: {
          keyHealth: [
            { keyNumber: 1, status: 'cooldown', remainingMs: 1000, inFlightCount: 0, failureCount: 1, successCount: 0 },
            { keyNumber: 2, status: 'cooldown', remainingMs: 1000, inFlightCount: 0, failureCount: 1, successCount: 0 },
            { keyNumber: 3, status: 'serverBusy', remainingMs: 1000, inFlightCount: 0, failureCount: 1, successCount: 0 },
          ],
        },
      },
    ], [1])).toBe(true);

    expect(shouldDelayAutoRescue([
      { index: 1, label: '1', kind: 'format', stage: 'partial', message: 'Thiếu', advice: 'Thử lại.' },
      { index: 2, label: '2', kind: 'empty', stage: 'split', message: 'Rỗng', advice: 'Thử lại.' },
      { index: 3, label: '3', kind: 'format', stage: 'normal', message: 'JSON', advice: 'Thử lại.' },
    ], [1, 2, 3])).toBe(true);

    expect(shouldDelayAutoRescue([
      { index: 1, label: '1', kind: 'format', stage: 'normal', message: 'JSON', advice: 'Thử lại.' },
    ], [1])).toBe(false);
  });
});
