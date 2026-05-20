import { describe, expect, it } from 'vitest';
import {
  buildGoogleBatchMessage,
  createGoogleGenAIClient,
  getGoogleRuntimeApiKeys,
  getGoogleRuntimeBaseUrl,
  getModelConfig,
  isShopAIKeyGeminiRuntime,
  SHOPAIKEY_GOOGLE_GENAI_API_BASE_URL,
  SHOPAIKEY_GOOGLE_GENAI_BASE_URL,
  SHOPAIKEY_GOOGLE_GENAI_DIRECT_BASE_URL,
} from './googleProvider';

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

  it('configures ShopAIKey Gemini runtime with the direct Google GenAI base URL and key', () => {
    const settings = {
      provider: 'shopaikey' as const,
      model: 'google/gemini-3.1-flash-lite-preview',
      apiKey: 'google-key',
      shopAIKeyKey: 'shop-key',
    };

    expect(isShopAIKeyGeminiRuntime(settings)).toBe(true);
    expect(getGoogleRuntimeApiKeys(settings)).toBe('shop-key');
    expect(getGoogleRuntimeBaseUrl(settings)).toBe(SHOPAIKEY_GOOGLE_GENAI_BASE_URL);
    expect(createGoogleGenAIClient(settings, 'shop-key')).toBeTruthy();
  });

  it('can switch ShopAIKey Gemini runtime between direct and official API base URLs', () => {
    const baseSettings = {
      provider: 'shopaikey' as const,
      model: 'gemini-3.1-flash-lite-preview',
      apiKey: 'google-key',
      shopAIKeyKey: 'shop-key',
    };

    expect(getGoogleRuntimeBaseUrl({ ...baseSettings, shopAIKeyEndpoint: 'direct' as const })).toBe(SHOPAIKEY_GOOGLE_GENAI_DIRECT_BASE_URL);
    expect(getGoogleRuntimeBaseUrl({ ...baseSettings, shopAIKeyEndpoint: 'api' as const })).toBe(SHOPAIKEY_GOOGLE_GENAI_API_BASE_URL);
    expect(SHOPAIKEY_GOOGLE_GENAI_BASE_URL).toBe(SHOPAIKEY_GOOGLE_GENAI_DIRECT_BASE_URL);
  });

  it('omits text parts from batch messages when context cache is available', () => {
    const part = { text: 'long document text' };
    const prompt = 'Extract current batch.';

    expect(buildGoogleBatchMessage(part, prompt, 'cachedContents/demo')).toEqual([{ text: prompt }]);
    expect(buildGoogleBatchMessage(part, prompt)).toEqual([{ text: 'long document text' }, { text: prompt }]);
  });
});
