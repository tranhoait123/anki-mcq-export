import { describe, expect, it } from 'vitest';
import {
  classifyBatchError,
  describeBatchError,
  getBackoffDelayMs,
  getRetryDecision,
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
    expect(classifyBatchError(new Error('Gemini API Error: too many requests; rate limit exceeded'))).toBe('rateLimit');
    expect(classifyBatchError({ statusCode: 429, message: 'RetryInfo quota exhausted' })).toBe('rateLimit');
    expect(classifyBatchError(new Error('Gemini overloaded 503'))).toBe('serverBusy');
    expect(getRetryProfile('rescue').minAttempts).toBeLessThan(getRetryProfile('normal').minAttempts);
    expect(getRetryProfile('rescue').backoffCapMs).toBeLessThan(getRetryProfile('normal').backoffCapMs);
    expect(getRetryProfile('rescue').maxElapsedMs).toBeGreaterThan(45_000);
  });

  it('separates hard quota from soft throttling decisions', () => {
    const hardQuota = getRetryDecision(new Error('429 RESOURCE_EXHAUSTED: exceeded your current quota, check billing'), getRetryProfile('normal'), 1);
    const softThrottle = getRetryDecision({ statusCode: 429, message: 'too many requests', retryAfterMs: 12000 }, getRetryProfile('normal'), 1);

    expect(hardQuota.kind).toBe('rateLimit');
    expect(hardQuota.cause).toBe('hardQuota');
    expect(hardQuota.action).toBe('fail');
    expect(softThrottle.cause).toBe('softRateLimit');
    expect(softThrottle.action).toBe('retry');
    expect(softThrottle.retryDelayMs).toBe(12000);
  });

  it('splits oversized requests immediately instead of retrying the same payload', () => {
    const decision = getRetryDecision({ statusCode: 413, message: 'context length exceeded; request too large' }, getRetryProfile('normal'), 1);

    expect(classifyBatchError({ statusCode: 413, message: 'request too large' })).toBe('format');
    expect(decision.cause).toBe('requestTooLarge');
    expect(decision.action).toBe('split');
  });

  it('retries transient server errors and only recommends fallback after repeated attempts', () => {
    const first = getRetryDecision(new Error('503 UNAVAILABLE model overloaded'), getRetryProfile('normal'), 1);
    const later = getRetryDecision(new Error('503 UNAVAILABLE model overloaded'), getRetryProfile('normal'), 7);

    expect(first.kind).toBe('serverBusy');
    expect(first.action).toBe('retry');
    expect(first.cooldownKind).toBeUndefined();
    expect(first.shouldTryFallbackModel).toBe(false);
    expect(later.shouldTryFallbackModel).toBe(true);
  });

  it('fails auth errors without retry or split', () => {
    const decision = getRetryDecision(new Error('403 permission denied API key not valid'), getRetryProfile('normal'), 1);

    expect(decision.kind).toBe('auth');
    expect(decision.action).toBe('fail');
    expect(shouldSplitForError(decision.kind)).toBe(false);
  });

  it('does not split auth failures', () => {
    expect(classifyBatchError(new Error('403 permission denied'))).toBe('auth');
    expect(classifyBatchError(new Error('API_KEY_INVALID: API key not valid'))).toBe('auth');
    expect(classifyBatchError(new Error('invalid_grant token expired'))).toBe('auth');
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
