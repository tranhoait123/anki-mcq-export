import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  buildGoogleBatchMessage,
  buildPartialSalvageRecoveryParts,
  callOpenAICompatibleProvider,
  extractProviderMessageContent,
  getAdaptiveQuestionBatchSize,
  getStructuredQuestionBatchSize,
  getModelConfig,
  getRetryDelayMsFromError,
  parseRetryAfterHeaderMs,
  STRUCTURED_QUESTION_BATCH_CAP,
  applyTrustedSourceLabel,
  applyTrustedSourceMetadata,
  applySharedCaseContextToQuestion,
  extractSharedCaseContexts,
  generateQuestions,
  parseQuestionsFromModelText,
  parseJsonFromModelText,
  salvageCompleteQuestionsFromJson,
  translateErrorForUser,
} from './brain';
import { executeWithUserRotation, userKeyRotator } from './brain/retryExecutor';
import {
  buildCompletedBatchSnapshot,
  getRecoveredMissingQuestionCount,
  getRecoveryPolicyForPart,
  isGoogleKeyConservationActive,
  splitRecoveryPartsForImmediateRun,
} from './brain/generation';
import type { RetryProfile } from '../utils/retryStrategy';
import { AppSettings } from '../types';

vi.mock('../db', () => ({
  db: {
    getKeyHealth: vi.fn().mockResolvedValue(null),
    saveKeyHealth: vi.fn().mockResolvedValue(undefined),
  }
}));

const baseSettings: AppSettings = {
  apiKey: '',
  shopAIKeyKey: 'shop-key',
  openRouterKey: 'openrouter-key',
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash',
  customPrompt: '',
};

const tinyRetryProfile: RetryProfile = {
  name: 'normal',
  attemptBuffer: 0,
  minAttempts: 4,
  fallbackAfterAttempt: 3,
  formatFastFailAttempt: 2,
  serverBusyFastFailAttempt: 3,
  backoffCapMs: 1,
  singleKeyBackoffCapMs: 1,
  maxElapsedMs: 5000,
  splitThresholdChars: 500,
  maxDepth: 1,
  targetSplitParts: 2,
  initialJitterMs: [1, 1],
};

describe('Core Logic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    userKeyRotator.init('', 1);
  });

  it('should be able to run mathematical checks', () => {
    expect(1 + 1).toBe(2);
  });

  it('includes provider model and response details in translated API errors', () => {
    const message = translateErrorForUser(
      new Error('OpenRouter API Error: 400 | model=openai/gpt-5.4 | This model does not support response_format'),
      'Trích xuất'
    );

    expect(message).toContain('Model: openai/gpt-5.4');
    expect(message).toContain('response_format');
  });

  it('explains provider/model mismatch instead of generic network failure', () => {
    const message = translateErrorForUser(
      new Error('MODEL_PROVIDER_MISMATCH: Model "deepseek/deepseek-v3.2" không dùng được với Google Gemini.'),
      'Trích xuất'
    );

    expect(message).toContain('Model đang không khớp provider');
    expect(message).toContain('OpenRouter');
    expect(message).toContain('gemini-*');
  });

  it('omits text parts from Google batch messages when context cache is available', () => {
    const part = { text: 'very long document part', sourceLabel: 'demo.pdf | Trang 1' };
    const prompt = 'Dựa trên tài liệu đã cache, hãy trích xuất Phần 1.';

    expect(buildGoogleBatchMessage(part, prompt, 'cachedContents/abc')).toEqual([{ text: prompt }]);
    expect(buildGoogleBatchMessage(part, prompt)).toEqual([{ text: 'very long document part' }, { text: prompt }]);
  });

  it('still includes inline vision parts even when context cache is available', () => {
    const part = {
      inlineData: { mimeType: 'application/pdf', data: 'base64-data' },
      sourceLabel: 'demo.pdf | Trang 10-12',
    };
    const prompt = 'Dựa trên tài liệu đã cache, chỉ trích xuất trong phạm vi hiện tại.';

    expect(buildGoogleBatchMessage(part, prompt, 'cachedContents/abc')).toEqual([
      { inlineData: { mimeType: 'application/pdf', data: 'base64-data' } },
      { text: prompt },
    ]);
  });

  it('retries provider calls without response_format when JSON mode is unsupported', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'This model does not support response_format' },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"questions":[]}' } }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAICompatibleProvider(
      { ...baseSettings, provider: 'openrouter', model: 'openai/gpt-5.4' },
      'openai/gpt-5.4',
      [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Scan this.' },
      ]
    );

    expect(result).toBe('{"questions":[]}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.response_format).toEqual({ type: 'json_object' });
    expect(firstBody.max_tokens).toBe(65536);
    expect(secondBody.response_format).toBeUndefined();
    expect(secondBody.max_tokens).toBe(65536);
    expect(secondBody.messages[0].content).toContain('Endpoint hiện tại không hỗ trợ response_format');
  });

  it('parses provider message content and reports empty responses clearly', () => {
    expect(extractProviderMessageContent({
      choices: [{ message: { content: '{"ok":true}' } }],
    })).toBe('{"ok":true}');

    expect(() => extractProviderMessageContent({ choices: [{ message: {} }] }))
      .toThrow('AI_FORMAT_ERROR_EMPTY_PROVIDER_RESPONSE');
  });

  it('extracts retry delay hints from provider errors when available', () => {
    expect(getRetryDelayMsFromError(new Error('RESOURCE_EXHAUSTED. Please retry in 21.5s.'))).toBe(21500);
    expect(getRetryDelayMsFromError({ message: 'RetryDelay: 1500ms' })).toBe(1500);
    expect(getRetryDelayMsFromError({ retryAfterMs: 12000, message: '429' })).toBe(12000);
    expect(getRetryDelayMsFromError({
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }],
    })).toBe(12000);
    expect(getRetryDelayMsFromError({
      message: '{"details":[{"retryDelay":{"seconds":"7"}}]}',
    })).toBe(7000);
  });

  it('parses retry-after-ms before retry-after and supports HTTP-date retry-after', () => {
    expect(parseRetryAfterHeaderMs(new Headers({
      'retry-after-ms': '2500',
      'retry-after': '10',
    }))).toBe(2500);
    expect(parseRetryAfterHeaderMs(new Headers({
      'retry-after-ms': '999999',
      'retry-after': '2',
    }))).toBe(2000);
    expect(parseRetryAfterHeaderMs(new Headers({
      'retry-after': new Date(10_000).toUTCString(),
    }), 5_000)).toBe(5000);
  });

  it('keeps 503 provider pressure on the same key and leaves keys available', async () => {
    userKeyRotator.init('key-one-valid,key-two-valid,key-three-valid', 3);
    const calls: string[] = [];

    const result = await executeWithUserRotation(
      'gemini-test',
      async (apiKey) => {
        calls.push(apiKey);
        if (calls.length < 3) {
          const error: any = new Error('503 UNAVAILABLE: model overloaded');
          error.statusCode = 503;
          throw error;
        }
        return 'ok';
      },
      'key-one-valid',
      'gemini-fallback',
      tinyRetryProfile
    );

    expect(result).toBe('ok');
    expect(calls).toEqual(['key-one-valid', 'key-two-valid', 'key-two-valid']);
    expect(userKeyRotator.availableKeyCount).toBe(3);
    expect(userKeyRotator.getRecommendedConcurrency()).toBeLessThan(3);
  });

  it('rotates to backup keys immediately after first soft 429 and cools down the failed key', async () => {
    userKeyRotator.init('key-one-valid,key-two-valid,key-three-valid', 3);
    const calls: string[] = [];

    const result = await executeWithUserRotation(
      'gemini-test',
      async (apiKey) => {
        calls.push(apiKey);
        if (calls.length === 1) {
          const error: any = new Error('429 RESOURCE_EXHAUSTED: too many requests');
          error.statusCode = 429;
          error.retryAfterMs = 1;
          throw error;
        }
        return 'ok';
      },
      'key-one-valid',
      'gemini-fallback',
      tinyRetryProfile
    );

    expect(result).toBe('ok');
    expect(calls).toEqual(['key-one-valid', 'key-two-valid']);
    expect(userKeyRotator.availableKeyCount).toBe(2); // key-one-valid is cooling down
    expect(userKeyRotator.hardFailedKeyCount).toBe(0);
  });

  it('marks only invalid keys failed and rotates to a healthy key', async () => {
    userKeyRotator.init('key-one-valid,key-two-valid,key-three-valid', 3);
    const calls: string[] = [];

    const result = await executeWithUserRotation(
      'gemini-test',
      async (apiKey) => {
        calls.push(apiKey);
        if (apiKey === 'key-one-valid') {
          const error: any = new Error('403 permission denied: API key not valid');
          error.statusCode = 403;
          throw error;
        }
        return 'ok';
      },
      'key-one-valid',
      'gemini-fallback',
      tinyRetryProfile
    );

    expect(result).toBe('ok');
    expect(calls).toEqual(['key-one-valid', 'key-two-valid']);
    expect(userKeyRotator.hardFailedKeyCount).toBe(1);
    expect(userKeyRotator.availableKeyCount).toBe(2);
  });

  it('caps soft-rate-limit key visits per logical batch and preserves fresh keys under provider pressure', async () => {
    userKeyRotator.init('key-one-valid,key-two-valid,key-three-valid,key-four-valid,key-five-valid', 5);
    const calls: string[] = [];
    const profile: RetryProfile = { ...tinyRetryProfile, minAttempts: 7, attemptBuffer: 0, maxElapsedMs: 1600 };

    await expect(executeWithUserRotation(
      'gemini-test',
      async (apiKey) => {
        calls.push(apiKey);
        const error: any = new Error('429 RESOURCE_EXHAUSTED: too many requests');
        error.statusCode = 429;
        error.retryAfterMs = 1;
        throw error;
      },
      'key-one-valid',
      'gemini-fallback',
      profile
    )).rejects.toThrow(/quá tải|bận|RETRY_BUDGET/i);

    expect(calls.slice(0, 2)).toEqual(['key-one-valid', 'key-two-valid']);
    expect(new Set(calls)).toEqual(new Set([
      'key-one-valid',
      'key-two-valid',
    ]));
    expect(calls.filter(key => key === 'key-two-valid').length).toBeGreaterThan(1);
    expect(userKeyRotator.availableKeyCount).toBe(4); // provider-pressure mode keeps fresh keys unburned
    expect(userKeyRotator.getRecommendedConcurrency()).toBe(1);
  });

  it('aborts timed-out attempts and releases in-flight keys without hard-failing them', async () => {
    userKeyRotator.init('key-one-valid', 1);
    let signal: AbortSignal | undefined;
    const timeoutProfile: RetryProfile = {
      ...tinyRetryProfile,
      minAttempts: 1,
      attemptBuffer: 0,
      maxElapsedMs: 20,
      backoffCapMs: 1,
      singleKeyBackoffCapMs: 1,
    };

    await expect(executeWithUserRotation(
      'gemini-test',
      async (_apiKey, _model, attemptContext) => {
        signal = attemptContext.signal;
        return new Promise<string>(() => {});
      },
      'key-one-valid',
      'gemini-fallback',
      timeoutProfile
    )).rejects.toThrow(/quá tải|bận|RETRY_BUDGET/i);

    expect(signal?.aborted).toBe(true);
    expect(userKeyRotator.getKeyHealthSnapshot()[0].inFlightCount).toBe(0);
    expect(userKeyRotator.hardFailedKeyCount).toBe(0);
  });

  it('caps PDF recovery accounting to questions added by the same batch', () => {
    expect(getRecoveredMissingQuestionCount(8, 22, 2)).toBe(2);
    expect(getRecoveredMissingQuestionCount(8, 9, 2)).toBe(1);
    expect(getRecoveredMissingQuestionCount(10, 9, 2)).toBe(0);
  });

  it('treats auto-skipped duplicate recovery questions as covered instead of failing the batch', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const makeQuestionPayload = (question: string) => ({
      question,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: {
        core: 'A đúng.',
        evidence: '',
        analysis: '',
        warning: '',
      },
      source: 'model-source',
      difficulty: 'Medium',
      depthAnalysis: '',
    });
    const providerResponse = (questions: any[]) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse([
        makeQuestionPayload('1. Alpha stem?'),
        makeQuestionPayload('2. Beta stem?'),
      ]))
      .mockResolvedValueOnce(providerResponse([
        makeQuestionPayload('3. Gamma stem?'),
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-1',
        name: 'deck.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: '',
        nativeText: [
          '[DOCX_NATIVE_MCQ_COUNT: 3]',
          '',
          '<<<MCQ 1>>>',
          'Question: 1. Alpha stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 2>>>',
          'Question: 2. Beta stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 3>>>',
          'Question: 3. Gamma stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
        ].join('\n'),
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0,
      undefined,
      undefined,
      false,
      {
        existingQuestions: [{
          id: 'existing-gamma',
          question: 'Gamma stem?',
          options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
          correctAnswer: 'A',
          explanation: {
            core: 'A đúng.',
            evidence: '',
            analysis: '',
            warning: '',
          },
          source: 'other-source',
          difficulty: 'Medium',
          depthAnalysis: '',
        }],
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.failedBatches).toEqual([]);
    expect(result.failedBatchDetails).toEqual([]);
    expect(result.autoSkippedCount).toBe(1);
    expect(result.questions.map((question) => question.question).sort()).toEqual([
      'Alpha stem?',
      'Beta stem?',
      'Gamma stem?',
    ]);
  });

  it('keeps valid partial progress in results while leaving the batch retryable', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const makeQuestionPayload = (question: string) => ({
      question,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: {
        core: 'A đúng.',
        evidence: '',
        analysis: '',
        warning: '',
      },
      source: 'model-source',
      difficulty: 'Medium',
      depthAnalysis: '',
    });
    const providerResponse = (questions: any[]) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(providerResponse([
        makeQuestionPayload('1. Alpha stem?'),
        makeQuestionPayload('2. Beta stem?'),
      ]))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'provider rejected targeted recovery' },
      }), { status: 418 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-1',
        name: 'deck.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: '',
        nativeText: [
          '[DOCX_NATIVE_MCQ_COUNT: 3]',
          '',
          '<<<MCQ 1>>>',
          'Question: 1. Alpha stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 2>>>',
          'Question: 2. Beta stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 3>>>',
          'Question: 3. Gamma stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
        ].join('\n'),
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.failedBatches).toEqual([1]);
    expect(result.failedBatchDetails[0]).toMatchObject({
      index: 1,
      stage: 'partial',
      missingCount: 1,
      recoveredCount: 0,
    });
    expect(result.questions.map((question) => question.question).sort()).toEqual([
      'Alpha stem?',
      'Beta stem?',
    ]);
  });

  it('salvages truncated provider output before recovering the missing native block', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const makeQuestionPayload = (question: string) => ({
      question,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: {
        core: 'A đúng.',
        evidence: '',
        analysis: '',
        warning: '',
      },
      source: 'model-source',
      difficulty: 'Medium',
      depthAnalysis: '',
    });
    const partialText = `{"questions":[${[
      makeQuestionPayload('1. Alpha stem?'),
      makeQuestionPayload('2. Beta stem?'),
    ].map(question => JSON.stringify(question)).join(',')},{"question":"3. Gamma`;
    const truncatedProviderResponse = () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'length',
        message: { content: partialText },
      }],
    }), { status: 200 });
    const providerResponse = (questions: any[]) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(truncatedProviderResponse())
      .mockResolvedValueOnce(truncatedProviderResponse())
      .mockResolvedValueOnce(providerResponse([
        makeQuestionPayload('3. Gamma stem?'),
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-1',
        name: 'deck.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: '',
        nativeText: [
          '[DOCX_NATIVE_MCQ_COUNT: 3]',
          '',
          '<<<MCQ 1>>>',
          'Question: 1. Alpha stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 2>>>',
          'Question: 2. Beta stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 3>>>',
          'Question: 3. Gamma stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
        ].join('\n'),
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.failedBatches).toEqual([]);
    expect(result.failedBatchDetails).toEqual([]);
    expect(result.questions.map((question) => question.question).sort()).toEqual([
      'Alpha stem?',
      'Beta stem?',
      'Gamma stem?',
    ]);
  });

  it('keeps OpenRouter recovery independent from Google key-conservation pressure', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const progressMessages: string[] = [];
    const makeQuestionPayload = (question: string) => ({
      question,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: {
        core: 'A đúng.',
        evidence: '',
        analysis: '',
        warning: '',
      },
      source: 'model-source',
      difficulty: 'Medium',
      depthAnalysis: '',
    });
    const providerResponse = (questions: any[]) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => {
        userKeyRotator.markProviderPressure(1);
        return Promise.resolve(providerResponse([
          makeQuestionPayload('1. Alpha stem?'),
          makeQuestionPayload('2. Beta stem?'),
        ]));
      })
      .mockResolvedValueOnce(providerResponse([
        makeQuestionPayload('3. Gamma stem?'),
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-1',
        name: 'deck.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: '',
        nativeText: [
          '[DOCX_NATIVE_MCQ_COUNT: 3]',
          '',
          '<<<MCQ 1>>>',
          'Question: 1. Alpha stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 2>>>',
          'Question: 2. Beta stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 3>>>',
          'Question: 3. Gamma stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
        ].join('\n'),
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      (message) => progressMessages.push(message),
      0
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(progressMessages.some(message => message.includes('provider hạ nhiệt'))).toBe(false);
    expect(result.failedBatches).toEqual([]);
    expect(result.failedBatchDetails).toEqual([]);
    expect(result.questions.map((question) => question.question).sort()).toEqual([
      'Alpha stem?',
      'Beta stem?',
      'Gamma stem?',
    ]);
  });

  it('keeps deferred recovery retryable when the deferred attempt still fails', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const makeQuestionPayload = (question: string) => ({
      question,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: {
        core: 'A đúng.',
        evidence: '',
        analysis: '',
        warning: '',
      },
      source: 'model-source',
      difficulty: 'Medium',
      depthAnalysis: '',
    });
    const providerResponse = (questions: any[]) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => {
        userKeyRotator.markProviderPressure(1);
        return Promise.resolve(providerResponse([
          makeQuestionPayload('1. Alpha stem?'),
          makeQuestionPayload('2. Beta stem?'),
        ]));
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'provider still busy during deferred recovery' },
      }), { status: 418 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-1',
        name: 'deck.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: '',
        nativeText: [
          '[DOCX_NATIVE_MCQ_COUNT: 3]',
          '',
          '<<<MCQ 1>>>',
          'Question: 1. Alpha stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 2>>>',
          'Question: 2. Beta stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
          '',
          '<<<MCQ 3>>>',
          'Question: 3. Gamma stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
        ].join('\n'),
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.failedBatches).toEqual([1]);
    expect(result.failedBatchDetails[0]).toMatchObject({
      index: 1,
      stage: 'partial',
      missingCount: 1,
      recoveredCount: 0,
    });
    expect(result.questions.map((question) => question.question).sort()).toEqual([
      'Alpha stem?',
      'Beta stem?',
    ]);
  });

  it('splits recovery parts into immediate and deferred groups without running excess parts in parallel', () => {
    const { immediateParts, deferredParts } = splitRecoveryPartsForImmediateRun([1, 2, 3, 4, 5], 3);

    expect(immediateParts).toEqual([1, 2, 3]);
    expect(deferredParts).toEqual([4, 5]);
    expect(splitRecoveryPartsForImmediateRun([1, 2], 0)).toEqual({
      immediateParts: [],
      deferredParts: [1, 2],
    });
  });

  it('classifies recovery eligibility from local evidence without adding confirmation requests', () => {
    expect(getRecoveryPolicyForPart({
      nativeMcqBatch: true,
      sourceMode: 'docxText',
      text: '[DOCX_NATIVE_MCQ_COUNT: 2]\n\n<<<MCQ 1>>>\nQuestion: Alpha\n\n<<<MCQ 2>>>\nQuestion: Beta',
    }, 2)).toMatchObject({
      eligibility: 'strong',
      maxRecoveryRequests: 3,
      shouldRecoverMissing: true,
    });

    expect(getRecoveryPolicyForPart({
      sourceMode: 'pdfVision',
      text: 'Câu 1. Nội dung?\nA. Một\nB. Hai\nC. Ba',
    }, 0)).toMatchObject({
      allowEmpty: false,
      eligibility: 'medium',
      maxRecoveryRequests: 1,
    });

    expect(getRecoveryPolicyForPart({
      sourceMode: 'docxImage',
      text: '',
    }, 0)).toMatchObject({
      allowEmpty: true,
      eligibility: 'weak',
      maxRecoveryRequests: 0,
      shouldRecoverMissing: false,
    });
  });

  it('scopes key-conservation pressure to the Google key rotator only', () => {
    expect(isGoogleKeyConservationActive('google', true)).toBe(true);
    expect(isGoogleKeyConservationActive('openrouter', true)).toBe(false);
    expect(isGoogleKeyConservationActive('shopaikey', true)).toBe(false);
    expect(isGoogleKeyConservationActive('google', false)).toBe(false);
  });

  it('does not retry or split a no-MCQ text batch that returns an empty result', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: '{"questions":[]}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-plain',
        name: 'intro.txt',
        type: 'text/plain',
        content: 'Tài liệu giới thiệu môn học, không có câu hỏi trắc nghiệm trong đoạn này.',
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.questions).toEqual([]);
    expect(result.failedBatches).toEqual([]);
    expect(result.failedBatchDetails).toEqual([]);
  });

  it('accepts an empty DOCX illustration image without a stricter retry', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: '{"questions":[]}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-docx-image',
        name: 'deck.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: '',
        docxImageParts: [{
          name: 'illustration.png',
          mimeType: 'image/png',
          content: 'data:image/png;base64,aW1hZ2U=',
          index: 1,
        }],
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.questions).toEqual([]);
    expect(result.failedBatches).toEqual([]);
    expect(result.failedBatchDetails).toEqual([]);
  });

  it('resumes fresh batches before previously failed batches to avoid burning keys early', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const seenRequests: string[] = [];
    const fetchMock = vi.fn(async (_url, init: any) => {
      seenRequests.push(JSON.stringify(JSON.parse(init.body).messages));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"questions":[]}' } }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await generateQuestions(
      [
        { id: 'done', name: 'done.txt', type: 'text/plain', content: 'Batch đã hoàn tất.' },
        { id: 'failed', name: 'failed-old.txt', type: 'text/plain', content: 'Batch lỗi cũ cần để sau.' },
        { id: 'fresh', name: 'fresh-next.txt', type: 'text/plain', content: 'Batch mới chưa quét.' },
      ],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0,
      undefined,
      undefined,
      false,
      {
        resumeMode: true,
        completedBatchIndices: [1],
        deprioritizedBatchIndices: [2],
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seenRequests[0]).toContain('fresh-next.txt');
    expect(seenRequests[1]).toContain('failed-old.txt');
  });

  it('runs targeted rescue retry indices sequentially even when app concurrency is high', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"questions":[]}' } }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await generateQuestions(
      [
        { id: 'a', name: 'a.txt', type: 'text/plain', content: 'A' },
        { id: 'b', name: 'b.txt', type: 'text/plain', content: 'B' },
        { id: 'c', name: 'c.txt', type: 'text/plain', content: 'C' },
      ],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 5 },
      0,
      undefined,
      0,
      undefined,
      [1, 2, 3],
      true,
      {
        retryProfile: 'rescue',
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);
  });

  it('does not infer-skip explicit rescue retry indices from seeded partial questions', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const makeQuestionPayload = (question: string) => ({
      question,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: {
        core: 'A đúng.',
        evidence: '',
        analysis: '',
        warning: '',
      },
      source: 'model-source',
      difficulty: 'Medium',
      depthAnalysis: '',
    });
    const providerResponse = (questions: any[]) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    }), { status: 200 });
    const fetchMock = vi.fn().mockResolvedValueOnce(providerResponse([
      makeQuestionPayload('2. Rescued stem?'),
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const existingQuestion = {
      id: 'existing-alpha',
      question: '1. Existing stem?',
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: {
        core: 'A đúng.',
        evidence: '',
        analysis: '',
        warning: '',
      },
      source: 'deck.docx | Nhóm 1',
      difficulty: 'Medium',
      depthAnalysis: '',
    };

    const result = await generateQuestions(
      [{
        id: 'file-1',
        name: 'deck.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: '',
        nativeText: [
          '[DOCX_NATIVE_MCQ_COUNT: 1]',
          '',
          '<<<MCQ 1>>>',
          'Question: 2. Rescued stem?',
          'A. Một',
          'B. Hai',
          'C. Ba',
          'D. Bốn',
        ].join('\n'),
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0,
      undefined,
      [1],
      true,
      {
        existingQuestions: [existingQuestion],
        resumeMode: true,
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.failedBatches).toEqual([]);
    expect(result.questions.map((question) => question.question).sort()).toEqual([
      '1. Existing stem?',
      'Rescued stem?',
    ]);
  });

  it('excludes partial questions from failed batches in final snapshots', () => {
    const snapshot = buildCompletedBatchSnapshot(
      [{ question: 'Existing' }],
      [{ id: 'existing-dup' }],
      1,
      new Map([
        [1, [{ question: 'Completed batch 1' }]],
        [2, [{ question: 'Failed partial batch 2' }]],
        [3, [{ question: 'Completed batch 3' }]],
      ]),
      new Map([
        [1, [{ id: 'dup-1' }]],
        [2, [{ id: 'failed-dup' }]],
      ]),
      new Map([
        [1, 2],
        [2, 9],
        [3, 1],
      ]),
      [1, 3]
    );

    expect(snapshot.questionsSnapshot.map((item) => item.question)).toEqual([
      'Existing',
      'Completed batch 1',
      'Completed batch 3',
    ]);
    expect(snapshot.duplicatesSnapshot.map((item) => item.id)).toEqual(['existing-dup', 'dup-1']);
    expect(snapshot.autoSkippedCount).toBe(4);
  });

  it('upserts retried questions by id in final snapshots', () => {
    const snapshot = buildCompletedBatchSnapshot(
      [
        { id: 'batch-3-question', question: 'Bad old batch 3 text' },
        { id: 'batch-1-question', question: 'Keep batch 1' },
      ],
      [],
      0,
      new Map([
        [3, [{ id: 'batch-3-question', question: 'Repaired batch 3 text' }]],
      ]),
      new Map(),
      new Map(),
      [3]
    );

    expect(snapshot.questionsSnapshot).toHaveLength(2);
    expect(snapshot.questionsSnapshot.map((item) => item.question)).toEqual([
      'Repaired batch 3 text',
      'Keep batch 1',
    ]);
  });

  it('computes safe adaptive question batch sizes from output budgets', () => {
    expect(getAdaptiveQuestionBatchSize({
      inputLimit: 1048576,
      outputLimit: 65536,
      safeOutputBudget: 49152,
      maxQuestionsPerBatch: 35,
      visionPagesPerBatch: 3,
    })).toBe(35);

    expect(getAdaptiveQuestionBatchSize({
      inputLimit: 128000,
      outputLimit: 32768,
      safeOutputBudget: 24576,
      maxQuestionsPerBatch: 20,
      visionPagesPerBatch: 3,
    })).toBe(19);
  });

  it('caps structured DOCX/PDF text batches at the quality-safe limit in generate flow', () => {
    expect(getStructuredQuestionBatchSize({
      inputLimit: 1048576,
      outputLimit: 65536,
      safeOutputBudget: 49152,
      maxQuestionsPerBatch: 35,
      visionPagesPerBatch: 3,
    })).toBe(STRUCTURED_QUESTION_BATCH_CAP);

    expect(getStructuredQuestionBatchSize({
      inputLimit: 400000,
      outputLimit: 128000,
      safeOutputBudget: 65536,
      maxQuestionsPerBatch: 35,
      visionPagesPerBatch: 3,
    })).toBe(STRUCTURED_QUESTION_BATCH_CAP);

    expect(getStructuredQuestionBatchSize({
      inputLimit: 128000,
      outputLimit: 32768,
      safeOutputBudget: 24576,
      maxQuestionsPerBatch: 20,
      visionPagesPerBatch: 3,
    })).toBe(10);
  });

  it('adds Google maxOutputTokens without dropping schema or cached content', () => {
    const schema = { type: 'object', properties: { questions: { type: 'array' } } };
    const config = getModelConfig('key', 'system', schema, 'gemini-2.5-flash', 'cachedContents/abc', 49152);

    expect(config.model).toBe('gemini-2.5-flash');
    expect(config.config.responseSchema).toBe(schema);
    expect(config.config.cachedContent).toBe('cachedContents/abc');
    expect(config.config.maxOutputTokens).toBe(49152);
    expect(config.config.httpOptions.retryOptions.attempts).toBe(1);
  });

  it('adds Google provider timeout and abort signal while disabling inner retries', () => {
    const schema = { type: 'object', properties: { questions: { type: 'array' } } };
    const controller = new AbortController();
    const config = getModelConfig('key', 'system', schema, 'gemini-2.5-flash', undefined, undefined, {
      timeoutMs: 1234,
      signal: controller.signal,
    });

    expect(config.config.abortSignal).toBe(controller.signal);
    expect(config.config.httpOptions).toEqual({
      timeout: 1234,
      retryOptions: { attempts: 1 },
    });
  });

  it('salvages complete MCQs from malformed partial JSON', () => {
    const validQuestion = (id: number) => JSON.stringify({
      question: `Câu ${id}: Nội dung câu hỏi`,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: {
        core: 'Vì A đúng.',
        evidence: 'Bằng chứng.',
        analysis: 'Phân tích.',
        warning: 'Lưu ý.',
      },
      source: 'demo',
      difficulty: 'Medium',
      depthAnalysis: 'Key point',
    });
    const malformed = `{"questions":[${validQuestion(1)},${validQuestion(2)},{"question":"Câu 3 bị cắt","options":["A.`;

    const questions = salvageCompleteQuestionsFromJson(malformed);

    expect(questions).toHaveLength(2);
    expect(questions.map((q) => q.question)).toEqual(['Nội dung câu hỏi', 'Nội dung câu hỏi']);
  });

  it('builds targeted recovery chunks for missing structured MCQ blocks', () => {
    const part = {
      nativeMcqBatch: true,
      text: [
        '[DOCX_NATIVE_BATCH_COUNT: 4]',
        '',
        '<<<MCQ 1>>>',
        'Question: 101. Câu alpha',
        'A. Một',
        '',
        '<<<MCQ 2>>>',
        'Question: 102. Câu beta',
        'A. Hai',
        '',
        '<<<MCQ 3>>>',
        'Question: 103. Câu gamma còn thiếu',
        'A. Ba',
        '',
        '<<<MCQ 4>>>',
        'Question: 104. Câu delta',
        'A. Bốn',
      ].join('\n'),
    };

    const recoveryParts = buildPartialSalvageRecoveryParts(part, [
      { question: '101. Câu alpha' },
      { question: '102. Câu beta' },
      { question: '104. Câu delta' },
    ], 1);

    expect(recoveryParts).toHaveLength(1);
    expect(recoveryParts[0].expectedQuestions).toBe(1);
    expect(recoveryParts[0].partialRecovery).toBe(false);
    expect(recoveryParts[0].text).toContain('103. Câu gamma còn thiếu');
    expect(recoveryParts[0].text).not.toContain('101. Câu alpha');
  });

  it('falls back to two-question recovery chunks when partial salvage mapping is low confidence', () => {
    const part = {
      nativeMcqBatch: true,
      text: [
        '[DOCX_NATIVE_BATCH_COUNT: 3]',
        '',
        '<<<MCQ 1>>>',
        'Question: Alpha',
        '',
        '<<<MCQ 2>>>',
        'Question: Beta',
        '',
        '<<<MCQ 3>>>',
        'Question: Gamma',
      ].join('\n'),
    };

    const recoveryParts = buildPartialSalvageRecoveryParts(part, [
      { question: 'Completely unrelated text' },
    ], 2);

    expect(recoveryParts).toHaveLength(2);
    expect(recoveryParts.map((item) => item.expectedQuestions)).toEqual([2, 1]);
  });

  it('targets only tail blocks when high-coverage partial salvage cannot be text-matched', () => {
    const blocks = Array.from({ length: 10 }, (_, index) => [
      `<<<MCQ ${index + 1}>>>`,
      `Question: ${601 + index}. Nội dung gốc câu ${index + 1}`,
      'A. Một',
      'B. Hai',
    ].join('\n'));
    const part = {
      nativeMcqBatch: true,
      text: `[PDF_TEXT_MCQ_COUNT: 10]\n\n${blocks.join('\n\n')}`,
    };

    const recoveryParts = buildPartialSalvageRecoveryParts(part, Array.from({ length: 8 }, (_, index) => ({
      question: `Model đã bỏ số và diễn đạt lại câu ${index + 1}`,
    })), 1);

    expect(recoveryParts).toHaveLength(2);
    expect(recoveryParts.every((item) => item.expectedQuestions === 1)).toBe(true);
    expect(recoveryParts[0].text).toContain('609. Nội dung gốc câu 9');
    expect(recoveryParts[1].text).toContain('610. Nội dung gốc câu 10');
    expect(recoveryParts.map((item) => item.text).join('\n')).not.toContain('601. Nội dung gốc câu 1');
  });

  it('flags a 9-question PDF vision response as partial when the text-layer hint expects 10', () => {
    const parsed = parseQuestionsFromModelText(JSON.stringify({
      questions: Array.from({ length: 9 }, (_, index) => ({
        question: `Câu ${index + 1}: Nội dung câu hỏi`,
        options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
        correctAnswer: 'A',
        explanation: {
          core: 'Vì A đúng.',
          evidence: 'Bằng chứng.',
          analysis: 'Phân tích.',
          warning: 'Lưu ý.',
        },
        source: 'demo.pdf | Trang 1-3',
        difficulty: 'Medium',
        depthAnalysis: 'Key point',
      })),
    }), 0, 10, { allowEmpty: true });

    expect(parsed).toHaveLength(9);
    expect((parsed as any).__salvagedPartial).toBe(true);
    expect((parsed as any).__missingCount).toBe(1);
  });

  it('overrides hallucinated source with the trusted batch source label', () => {
    const questions = applyTrustedSourceLabel([
      { source: '2024 - ĐỀ 1 - ĐÁP ÁN.docx' },
    ], { sourceLabel: 'foo.pdf | Trang 2-4' });

    expect(questions[0].source).toBe('foo.pdf | Trang 2-4');
  });

  it('applies the trusted source label to every parsed question in a batch', () => {
    const parsed = parseQuestionsFromModelText(JSON.stringify({
      questions: [1, 2].map((id) => ({
        question: `Câu ${id}`,
        options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
        correctAnswer: 'A',
        explanation: {
          core: 'Vì A đúng.',
          evidence: 'Bằng chứng.',
          analysis: 'Phân tích.',
          warning: 'Lưu ý.',
        },
        source: `AI tự bịa ${id}`,
        difficulty: 'Medium',
        depthAnalysis: 'Key point',
      })),
    }), 0, 2);

    applyTrustedSourceLabel(parsed, { sourceLabel: 'bar.docx | Nhóm 3' });

    expect(parsed.map((q) => q.source)).toEqual(['bar.docx | Nhóm 3', 'bar.docx | Nhóm 3']);
  });

  it('attaches source trace metadata while preserving the trusted source label', () => {
    const questions = applyTrustedSourceMetadata([
      {
        question: 'Câu 1. Nội dung dài để làm snippet fallback',
        source: 'AI tự bịa',
      },
    ], {
      sourceLabel: 'demo.pdf | Trang 2-4',
      trace: {
        fileId: 'file-1',
        fileName: 'demo.pdf',
        sourceLabel: 'demo.pdf | Trang 2-4',
        pageRange: { start: 2, end: 4 },
        batchIndex: 1,
        mode: 'pdfText',
        snippet: 'Câu 1 từ text layer',
      },
    });

    expect(questions[0].source).toBe('demo.pdf | Trang 2-4');
    expect((questions[0] as any).trace).toEqual({
      fileId: 'file-1',
      fileName: 'demo.pdf',
      sourceLabel: 'demo.pdf | Trang 2-4',
      pageRange: { start: 2, end: 4 },
      batchIndex: 1,
      mode: 'pdfText',
      snippet: 'Câu 1 từ text layer',
    });
  });

  it('can restore plain shared case context to parsed model questions', () => {
    const sourceText = `
Tình huống cho câu 11-12-13-14: Bệnh nhân nữ có siêu âm tử cung trống beta 1300. Siêu âm có 1 khối echo hỗn hợp cạnh buồng trứng.
Câu 11: Chẩn đoán:
A. Thai chưa xác định vị trí.
B. Thai ngoài tử cung.
C. Xảy thai trọn.
D. Thai nghén thất bại sớm.
Câu 12: Xử trí tiếp theo là gì?
`;
    const contexts = extractSharedCaseContexts(sourceText);

    expect(applySharedCaseContextToQuestion('Câu 11: Chẩn đoán:', contexts))
      .toContain('Tình huống cho câu 11-12-13-14');
    expect(applySharedCaseContextToQuestion('Câu 13: Lâm sàng hướng đến sảy thai trọn.', contexts))
      .toContain('beta 1300');
  });

  it('salvages complete questions from malformed/truncated JSON even if truncated at the end', () => {
    const truncated = `{"questions":[
      {
        "question": "Câu 1: Câu hỏi hoàn chỉnh",
        "options": ["A. Một", "B. Hai"],
        "correctAnswer": "A",
        "explanation": {
          "core": "Giải thích"
        }
      },
      {
        "question": "Câu 2: Câu hỏi bị cắt",
        "options": ["A. Ba", "B. Bốn"],
        "correctAnswer": "B",
        "explanation": {
          "co
    ]}`;
    const questions = salvageCompleteQuestionsFromJson(truncated);
    expect(questions).toHaveLength(2);
    expect(questions[0].question).toBe("Câu hỏi hoàn chỉnh");
    expect(questions[1].question).toBe("Câu hỏi bị cắt");
    expect(questions[1].explanation.core).toBe("");
  });

  it('keeps empty optional responses as valid JSON payloads', () => {
    expect(parseQuestionsFromModelText('{"questions":[]}', 0, 0)).toEqual([]);
    expect(() => parseQuestionsFromModelText('{"questions":[]}', 0, 2)).toThrow('Dữ liệu AI');
    expect(() => parseQuestionsFromModelText('{"questions":[]}', 0, 0, { allowEmpty: false })).toThrow('Dữ liệu AI');
    expect(salvageCompleteQuestionsFromJson('{"questions":[]}')).toEqual([]);
    expect(extractProviderMessageContent({
      choices: [{ message: { content: '{"questions":[]}' } }],
    })).toBe('{"questions":[]}');
  });

  it('extracts JSON without treating brackets inside strings as structure', () => {
    const payload = {
      estimatedCount: 12,
      specialty: 'Dược lý [tim mạch',
      confidence: 0.91,
      hasAnswers: true,
      structureNote: 'Có ký hiệu tập {x | x > 0 trong đề và hậu tố ngoài JSON bị bỏ qua.',
    };

    const parsed = parseJsonFromModelText<typeof payload>(
      `Model output:\n${JSON.stringify(payload)}\n\nGhi chú ngoài JSON.`
    );

    expect(parsed).toEqual(payload);
  });

  it('normalizes common model shape drift before rendering/export', () => {
    const parsed = parseQuestionsFromModelText(JSON.stringify({
      questions: [
        {
          question: 'Câu 1: Thuốc nào là lựa chọn đúng?',
          options: {
            B: 'Metformin',
            A: 'Insulin',
            D: 'Amlodipin',
            C: 'Aspirin',
          },
          correctAnswer: 'Aspirin',
          explanation: 'Vì aspirin là đáp án trong đề.',
          source: 'demo.pdf | Trang 1',
          difficulty: 'Medium',
          depthAnalysis: 'Key point',
        },
        {
          question: 'Câu 2: Marker option nằm chung dòng?',
          options: 'A. Một B. Hai C. Ba D. Bốn',
          correctAnswer: 2,
          explanation: {
            core: 'B đúng.',
          },
          source: 'demo.pdf | Trang 1',
          difficulty: 'Easy',
          depthAnalysis: 'Key point',
        },
      ],
    }), 0, 2);

    expect(parsed[0].options).toEqual(['A. Insulin', 'B. Metformin', 'C. Aspirin', 'D. Amlodipin']);
    expect(parsed[0].correctAnswer).toBe('C');
    expect(parsed[0].explanation.core).toBe('Vì aspirin là đáp án trong đề.');
    expect(parsed[1].options).toEqual(['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn']);
    expect(parsed[1].correctAnswer).toBe('B');
  });

  it('accepts common alias fields from model output', () => {
    const parsed = parseQuestionsFromModelText(JSON.stringify({
      questions: [
        {
          stem: 'Câu 3: Thuật ngữ nào phù hợp nhất?',
          choices: [
            { label: 'C', text: 'Tăng huyết áp' },
            { label: 'A', text: 'Sốt' },
            { label: 'B', text: 'Ho' },
            { label: 'D', text: 'Đau bụng' },
          ],
          correct_answer: { letter: 'C' },
          rationale: 'Tăng huyết áp là thuật ngữ phù hợp.',
          source: 'alias-fixture',
          difficulty: 'Medium',
          depthAnalysis: '> Alias fields',
        },
      ],
    }), 0, 1);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].question).toBe('Thuật ngữ nào phù hợp nhất?');
    expect(parsed[0].options).toEqual(['A. Sốt', 'B. Ho', 'C. Tăng huyết áp', 'D. Đau bụng']);
    expect(parsed[0].correctAnswer).toBe('C');
    expect(parsed[0].explanation.core).toBe('Tăng huyết áp là thuật ngữ phù hợp.');
  });

  it('infers correct answers from option markers and cleans option text', () => {
    const markerExplanation = {
      core: 'Core',
      evidence: 'Evidence',
      analysis: 'Analysis',
      warning: 'Warning',
    };
    const parsed = parseQuestionsFromModelText(JSON.stringify({
      questions: [
        {
          question: 'Câu 4: Marker nằm trong option array?',
          options: ['A. Sốt', 'B. Ho', '✅ C. Đau bụng', 'D. Khó thở'],
          correctAnswer: '',
          explanation: markerExplanation,
          source: 'marker-fixture',
          difficulty: 'Easy',
          depthAnalysis: '> Marker',
        },
        {
          question: 'Câu 5: Marker nằm trong option string?',
          options: 'A. Một B. Hai ✓ C. Ba D. Bốn',
          correctAnswer: 'A',
          explanation: markerExplanation,
          source: 'marker-fixture',
          difficulty: 'Easy',
          depthAnalysis: '> Marker',
        },
      ],
    }), 0, 2);

    expect(parsed[0].options).toEqual(['A. Sốt', 'B. Ho', 'C. Đau bụng', 'D. Khó thở']);
    expect(parsed[0].correctAnswer).toBe('C');
    expect(parsed[1].options).toEqual(['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn']);
    expect(parsed[1].correctAnswer).toBe('C');
  });

  it('strictly enforces sequential execution (concurrency = 1) for PDF Vision batches and split recoveries under high initial concurrency settings', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pdfProcessor = await import('../utils/pdfProcessor');
    vi.spyOn(pdfProcessor, 'analyzePdfTextLayer').mockResolvedValue({
      pageCount: 3,
      pages: [
        {
          ...pdfProcessor.scorePdfTextPage('Câu 1. Alpha\nCâu 2. Beta\nCâu 3. Gamma', 1),
          quality: 'goodText',
        },
        {
          ...pdfProcessor.scorePdfTextPage('', 2),
          quality: 'goodText',
        },
        {
          ...pdfProcessor.scorePdfTextPage('', 3),
          quality: 'goodText',
        },
      ],
      textBatches: [],
      visionPageRanges: [{ start: 1, end: 3 }],
      detectedMcqCount: 3,
      mode: 'vision',
    });
    vi.spyOn(pdfProcessor, 'convertPdfToImages').mockResolvedValue(['image1', 'image2', 'image3']);

    const makeQuestionPayload = (question: string) => ({
      question,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: { core: 'A đúng.', evidence: '', analysis: '', warning: '' },
      source: 'model-source',
      difficulty: 'Medium',
      depthAnalysis: '',
    });

    const providerResponse = (questions: any[]) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    }), { status: 200 });

    let activeRequests = 0;
    let maxConcurrentRequests = 0;

    const fetchMock = vi.fn().mockImplementation(async () => {
      activeRequests++;
      maxConcurrentRequests = Math.max(maxConcurrentRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 20)); // tiny delay to capture overlapping requests
      activeRequests--;

      const callCount = fetchMock.mock.calls.length;
      if (callCount === 1) {
        // Main batch 1-3: only returns 2 questions instead of 3
        return providerResponse([
          makeQuestionPayload('1. Alpha stem?'),
          makeQuestionPayload('2. Beta stem?'),
        ]);
      } else {
        // Recovery splits
        return providerResponse([
          makeQuestionPayload('3. Gamma stem?'),
        ]);
      }
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-pdf-vision-concurrency',
        name: 'test_vision.pdf',
        type: 'application/pdf',
        content: 'data:application/pdf;base64,JVBERi0xLjQK...',
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 5 }, // set initially high concurrency of 5
      0,
      undefined,
      0
    );

    // Confirm all questions are recovered fully
    expect(result.questions).toHaveLength(3);
    expect(result.questions.map(q => q.question).sort()).toEqual([
      'Alpha stem?',
      'Beta stem?',
      'Gamma stem?',
    ]);
    expect(result.failedBatches).toEqual([]);

    // KEY ASSERTION: The maximum active concurrent requests must be strictly 1 at all times
    expect(maxConcurrentRequests).toBe(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    vi.unstubAllGlobals();
  });

  it('keeps provider-pressure PDF Vision batches retryable when recovered count is not reliable', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pdfProcessor = await import('../utils/pdfProcessor');
    vi.spyOn(pdfProcessor, 'analyzePdfTextLayer').mockResolvedValue({
      pageCount: 1,
      pages: [{
        ...pdfProcessor.scorePdfTextPage('', 1),
        quality: 'scanOrEmpty',
      }],
      textBatches: [],
      visionPageRanges: [{ start: 1, end: 1 }],
      detectedMcqCount: 0,
      mode: 'vision',
    });
    vi.spyOn(pdfProcessor, 'convertPdfToImages').mockResolvedValue(['image1']);

    const makeQuestionPayload = (question: string) => ({
      question,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: { core: 'A đúng.', evidence: '', analysis: '', warning: '' },
      source: 'model-source',
      difficulty: 'Medium',
      depthAnalysis: '',
    });
    const providerResponse = (questions: any[]) => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ questions }) } }],
    }), { status: 200 });
    const busyResponse = () => new Response(JSON.stringify({
      error: { message: '503 UNAVAILABLE provider overloaded' },
    }), { status: 503 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(busyResponse())
      .mockResolvedValueOnce(busyResponse())
      .mockResolvedValueOnce(providerResponse([
        makeQuestionPayload('1. Alpha stem?'),
        makeQuestionPayload('2. Beta stem?'),
        makeQuestionPayload('3. Gamma stem?'),
        makeQuestionPayload('4. Delta stem?'),
      ]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-pdf-vision-uncertain-recovery',
        name: 'scan.pdf',
        type: 'application/pdf',
        content: 'data:application/pdf;base64,JVBERi0xLjQK...',
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.questions).toHaveLength(3);
    expect(result.failedBatches).toEqual([1]);
    expect(result.failedBatchDetails[0]).toMatchObject({
      index: 1,
      kind: 'serverBusy',
      stage: 'partial',
      recoveredCount: 3,
    });

    vi.unstubAllGlobals();
  });

  it('keeps interrupted partial salvage retryable when expected count is not reliable', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const pdfProcessor = await import('../utils/pdfProcessor');
    vi.spyOn(pdfProcessor, 'analyzePdfTextLayer').mockResolvedValue({
      pageCount: 1,
      pages: [{
        ...pdfProcessor.scorePdfTextPage('', 1),
        quality: 'scanOrEmpty',
      }],
      textBatches: [],
      visionPageRanges: [{ start: 1, end: 1 }],
      detectedMcqCount: 0,
      mode: 'vision',
    });
    vi.spyOn(pdfProcessor, 'convertPdfToImages').mockResolvedValue(['image1']);

    const makeQuestionPayload = (question: string) => ({
      question,
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      explanation: { core: 'A đúng.', evidence: '', analysis: '', warning: '' },
      source: 'model-source',
      difficulty: 'Medium',
      depthAnalysis: '',
    });
    const partialText = `{"questions":[${[
      makeQuestionPayload('1. Alpha stem?'),
      makeQuestionPayload('2. Beta stem?'),
    ].map(question => JSON.stringify(question)).join(',')},{"question":"3. Gamma`;
    const truncatedProviderResponse = () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'length',
        message: { content: partialText },
      }],
    }), { status: 200 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(truncatedProviderResponse())
      .mockResolvedValueOnce(truncatedProviderResponse());
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateQuestions(
      [{
        id: 'file-pdf-vision-uncertain-partial',
        name: 'scan-partial.pdf',
        type: 'application/pdf',
        content: 'data:application/pdf;base64,JVBERi0xLjQK...',
      }],
      { ...baseSettings, adaptiveBatching: false, concurrencyLimit: 1 },
      0,
      undefined,
      0
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.questions.map(question => question.question).sort()).toEqual([
      'Alpha stem?',
      'Beta stem?',
    ]);
    expect(result.failedBatches).toEqual([1]);
    expect(result.failedBatchDetails[0]).toMatchObject({
      index: 1,
      kind: 'format',
      stage: 'partial',
      recoveredCount: 2,
    });

    vi.unstubAllGlobals();
  });

  it('respects user-defined visionPagesPerBatch advanced setting for splitting PDF vision page ranges', async () => {
    const pdfProcessor = await import('../utils/pdfProcessor');
    const analyzeSpy = vi.spyOn(pdfProcessor, 'analyzePdfTextLayer').mockResolvedValue({
      pageCount: 8,
      pages: Array.from({ length: 8 }, (_, i) => ({
        ...pdfProcessor.scorePdfTextPage('', i + 1),
        quality: 'scanOrEmpty',
      })),
      textBatches: [],
      visionPageRanges: [{ start: 1, end: 4 }, { start: 5, end: 8 }],
      detectedMcqCount: 0,
      mode: 'vision',
    });
    vi.spyOn(pdfProcessor, 'convertPdfToImages').mockResolvedValue(['img']);

    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ questions: [] }) } }],
    }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    await generateQuestions(
      [{
        id: 'file-pdf-vision-custom-batch',
        name: 'test_vision_custom.pdf',
        type: 'application/pdf',
        content: 'data:application/pdf;base64,JVBERi0xLjQK...',
      }],
      { ...baseSettings, visionPagesPerBatch: 4 },
      0,
      undefined,
      0
    );

    expect(analyzeSpy).toHaveBeenCalledWith(
      expect.any(String),
      4,
      1,
      expect.any(Number),
      expect.any(Boolean)
    );

    vi.unstubAllGlobals();
  });
});
