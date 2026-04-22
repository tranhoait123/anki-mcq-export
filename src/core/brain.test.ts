import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  buildGoogleBatchMessage,
  buildOpenAICompatibleProviderRequest,
  callOpenAICompatibleProvider,
  extractProviderMessageContent,
  translateErrorForUser,
} from './brain';
import { AppSettings } from '../types';

const baseSettings: AppSettings = {
  apiKey: '',
  shopAIKeyKey: 'shop-key',
  openRouterKey: 'openrouter-key',
  vertexProjectId: 'demo-project',
  vertexLocation: 'us-central1',
  vertexAccessToken: 'vertex-token',
  provider: 'openrouter',
  model: 'google/gemini-2.5-flash',
  customPrompt: '',
};

describe('Core Logic', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it('keeps Vertex auth guidance instead of falling through to generic Gemini key text', () => {
    const message = translateErrorForUser(
      new Error('Vertex AI API Error: 403 | model=google/gemini-2.5-flash | Permission denied'),
      'Trích xuất'
    );

    expect(message).toContain('Lỗi Vertex AI');
    expect(message).toContain('Token không đủ quyền');
    expect(message).not.toContain('Key đã bật Gemini API');
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

  it('omits document parts from Google batch messages when context cache is available', () => {
    const part = { text: 'very long document part' };
    const prompt = 'Dựa trên tài liệu đã cache, hãy trích xuất Phần 1.';

    expect(buildGoogleBatchMessage(part, prompt, 'cachedContents/abc')).toEqual([{ text: prompt }]);
    expect(buildGoogleBatchMessage(part, prompt)).toEqual([part, { text: prompt }]);
  });

  it('builds Vertex AI OpenAI-compatible requests with the documented endpoint and model prefix', () => {
    const request = buildOpenAICompatibleProviderRequest(
      { ...baseSettings, provider: 'vertexai', model: 'gemini-2.5-flash' },
      'gemini-2.5-flash',
      [{ role: 'user', content: 'hello' }]
    );

    expect(request.url).toBe('https://aiplatform.googleapis.com/v1/projects/demo-project/locations/us-central1/endpoints/openapi/chat/completions');
    expect(request.model).toBe('google/gemini-2.5-flash');
    expect(request.headers.Authorization).toBe('Bearer vertex-token');
    expect(request.body.model).toBe('google/gemini-2.5-flash');
  });

  it('uses global as the Vertex location fallback', () => {
    const request = buildOpenAICompatibleProviderRequest(
      { ...baseSettings, provider: 'vertexai', vertexLocation: '' },
      'gemini-2.5-flash',
      []
    );

    expect(request.url).toContain('/locations/global/endpoints/openapi/chat/completions');
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
    expect(secondBody.response_format).toBeUndefined();
    expect(secondBody.messages[0].content).toContain('Endpoint hiện tại không hỗ trợ response_format');
  });

  it('parses provider message content and reports empty responses clearly', () => {
    expect(extractProviderMessageContent({
      choices: [{ message: { content: '{"ok":true}' } }],
    })).toBe('{"ok":true}');

    expect(() => extractProviderMessageContent({ choices: [{ message: {} }] }))
      .toThrow('AI_FORMAT_ERROR_EMPTY_PROVIDER_RESPONSE');
  });
});
