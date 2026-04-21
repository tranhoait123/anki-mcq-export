import { describe, expect, it } from 'vitest';
import {
  classifyBatchError,
  describeBatchError,
  getBackoffDelayMs,
  getRetryProfile,
  shouldSplitForError,
  splitTextIntoNaturalParts,
} from './retryStrategy';

describe('batch retry strategy', () => {
  it('classifies JSON and empty responses as split-worthy errors', () => {
    expect(classifyBatchError(new Error('AI_FORMAT_ERROR_TRUNCATED'))).toBe('format');
    expect(classifyBatchError(new Error('Không tìm thấy câu hỏi trắc nghiệm'))).toBe('empty');
    expect(shouldSplitForError('format')).toBe(true);
    expect(shouldSplitForError('empty')).toBe(true);
  });

  it('classifies rate/server errors for short rescue retry', () => {
    expect(classifyBatchError(new Error('OpenRouter API Error: 429'))).toBe('rateLimit');
    expect(classifyBatchError(new Error('Gemini overloaded 503'))).toBe('serverBusy');
    expect(getRetryProfile('rescue').minAttempts).toBeLessThan(getRetryProfile('normal').minAttempts);
    expect(getRetryProfile('rescue').backoffCapMs).toBeLessThan(getRetryProfile('normal').backoffCapMs);
  });

  it('does not split auth failures', () => {
    expect(classifyBatchError(new Error('403 permission denied'))).toBe('auth');
    expect(shouldSplitForError('auth')).toBe(false);
    expect(describeBatchError(new Error('403 permission denied')).advice).toContain('API key');
  });

  it('splits text on natural boundaries without empty parts', () => {
    const text = [
      'Đoạn 1. Câu hỏi A có nhiều dữ kiện lâm sàng.',
      'Đoạn 2. Câu hỏi B có nhiều dữ kiện lâm sàng.',
      'Đoạn 3. Câu hỏi C có nhiều dữ kiện lâm sàng.',
      'Đoạn 4. Câu hỏi D có nhiều dữ kiện lâm sàng.',
      'Đoạn 5. Câu hỏi E có nhiều dữ kiện lâm sàng.',
    ].join('\n\n').repeat(12);

    const parts = splitTextIntoNaturalParts(text, 4, 250);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.length).toBeLessThanOrEqual(4);
    expect(parts.every(part => part.trim().length > 0)).toBe(true);
    expect(parts.join('').length).toBeGreaterThan(text.length * 0.95);
  });

  it('caps rescue backoff lower than normal backoff', () => {
    const normal = getBackoffDelayMs(getRetryProfile('normal'), 8, 8, true, false, false, false, () => 1);
    const rescue = getBackoffDelayMs(getRetryProfile('rescue'), 8, 8, true, false, false, false, () => 1);
    expect(rescue).toBeLessThan(normal);
    expect(rescue).toBeLessThanOrEqual(getRetryProfile('rescue').backoffCapMs);
  });
});
