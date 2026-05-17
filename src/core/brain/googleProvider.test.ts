import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateGeminiKeys } from './googleProvider';

vi.mock('@google/genai', () => {
  class MockGoogleGenAI {
    apiKey: string;
    constructor(config: { apiKey: string }) {
      this.apiKey = config.apiKey;
    }
    models = {
      generateContent: async (options: any) => {
        const key = this.apiKey;
        if (key === 'invalid-key') {
          throw new Error('API_KEY_INVALID: The provided API key is invalid.');
        }
        if (key === 'quota-key') {
          throw new Error('RESOURCE_EXHAUSTED: Rate limit exceeded.');
        }
        if (key === 'busy-key') {
          throw new Error('503: Service Unavailable (Overloaded).');
        }
        return { text: 'Success' };
      }
    };
  }

  return {
    GoogleGenAI: MockGoogleGenAI,
    Type: {
      OBJECT: 'OBJECT',
      ARRAY: 'ARRAY',
      STRING: 'STRING'
    }
  };
});

describe('Google Gemini API Key bulk validation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails immediately if no keys are provided', async () => {
    const result = await validateGeminiKeys('', 'gemini-2.5-flash');
    expect(result.ok).toBe(false);
    expect(result.totalChecked).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.message).toContain('Vui lòng nhập danh sách API Key');
  });

  it('validates a healthy key list successfully', async () => {
    const result = await validateGeminiKeys('key-good-1, key-good-2', 'gemini-2.5-flash');
    expect(result.ok).toBe(true);
    expect(result.totalChecked).toBe(2);
    expect(result.healthyCount).toBe(2);
    expect(result.results[0].ok).toBe(true);
    expect(result.results[0].status).toBe('healthy');
    expect(result.results[0].keyTruncated).toBe('key-go...od-1');
    expect(result.results[0].keyRaw).toBe('key-good-1');
  });

  it('diagnoses auth blocked keys (invalid api key)', async () => {
    const result = await validateGeminiKeys('invalid-key, key-good', 'gemini-2.5-flash');
    expect(result.ok).toBe(true); // At least one good key exists
    expect(result.totalChecked).toBe(2);
    expect(result.healthyCount).toBe(1);

    const badKey = result.results.find(r => r.keyTruncated === 'invali...-key');
    expect(badKey).toBeDefined();
    expect(badKey?.ok).toBe(false);
    expect(badKey?.status).toBe('authBlocked');
    expect(badKey?.message).toContain('Key không hợp lệ hoặc đã bị khóa');
  });

  it('diagnoses rate limited / exhausted keys', async () => {
    const result = await validateGeminiKeys('quota-key', 'gemini-2.5-flash');
    expect(result.ok).toBe(false);
    expect(result.healthyCount).toBe(0);
    expect(result.results[0].status).toBe('quotaBlocked');
    expect(result.results[0].message).toContain('Hết hạn mức');
  });

  it('diagnoses server busy / overloaded errors', async () => {
    const result = await validateGeminiKeys('busy-key', 'gemini-2.5-flash');
    expect(result.ok).toBe(false);
    expect(result.healthyCount).toBe(0);
    expect(result.results[0].status).toBe('serverBusy');
    expect(result.results[0].message).toContain('Server Google quá tải hoặc Timeout');
  });
});
