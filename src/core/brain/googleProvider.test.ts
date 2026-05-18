import { describe, expect, it } from 'vitest';
import { buildGoogleBatchMessage, getModelConfig } from './googleProvider';

describe('Google provider request helpers', () => {
  it('passes timeout and abort signal without enabling SDK retries', () => {
    const controller = new AbortController();
    const config = getModelConfig(
      'api-key',
      'system instruction',
      undefined,
      'gemini-2.5-flash',
      undefined,
      1024,
      { timeoutMs: 1234, signal: controller.signal }
    );

    expect(config.config.abortSignal).toBe(controller.signal);
    expect(config.config.httpOptions).toEqual({
      timeout: 1234,
      retryOptions: { attempts: 1 },
    });
  });

  it('omits text parts from batch messages when context cache is available', () => {
    const part = { text: 'long document text' };
    const prompt = 'Extract current batch.';

    expect(buildGoogleBatchMessage(part, prompt, 'cachedContents/demo')).toEqual([{ text: prompt }]);
    expect(buildGoogleBatchMessage(part, prompt)).toEqual([{ text: 'long document text' }, { text: prompt }]);
  });
});
