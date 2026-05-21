import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOpenAICompatibleProviderRequest,
  callOpenAICompatibleProvider,
  getOpenAICompatibleRuntimeApiKeys,
  getShopAIKeyOpenAIBaseUrl,
  SHOPAIKEY_OPENAI_API_BASE_URL,
  SHOPAIKEY_OPENAI_DIRECT_BASE_URL,
  toOpenAIContentFromPart,
  validateShopAIKeyConnection,
} from './openAiProvider';
import { AppSettings } from '../../types';

const shopAIKeySettings: AppSettings = {
  apiKey: '',
  shopAIKeyKey: 'shop-key',
  openRouterKey: '',
  provider: 'shopaikey',
  model: 'openai/gpt-5.4-mini',
  customPrompt: '',
};

describe('OpenAI-compatible provider vision payloads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps multi-page PDF vision batches together with text-layer context', () => {
    const content = toOpenAIContentFromPart({
      text: 'Tình huống lâm sàng cho câu 41-42. Bệnh nhân đau ngực sát cuối trang.',
      inlineDataParts: [
        { mimeType: 'image/jpeg', data: 'page-1' },
        { mimeType: 'image/jpeg', data: 'page-2' },
      ],
      sourceLabel: 'case.pdf | Trang 1-2',
    });

    expect(content).toEqual([
      { type: 'text', text: '[PDF_TEXT_LAYER_CONTEXT]\nTình huống lâm sàng cho câu 41-42. Bệnh nhân đau ngực sát cuối trang.' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,page-1' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,page-2' } },
    ]);
  });

  it('builds ShopAIKey OpenAI-compatible model requests for chat completions with normalized ids and bearer auth', () => {
    const request = buildOpenAICompatibleProviderRequest(
      shopAIKeySettings,
      'openai/gpt-5.4-mini',
      [{ role: 'user', content: 'Return JSON.' }]
    );

    expect(request.url).toBe('https://direct.shopaikey.com/v1/chat/completions');
    expect(request.providerName).toBe('ShopAIKey');
    expect(request.model).toBe('gpt-5.4-mini');
    expect(request.endpointKind).toBe('chat');
    expect(request.headers.Authorization).toBe('Bearer shop-key');
    expect(request.body.model).toBe('gpt-5.4-mini');
    expect(request.body.messages).toEqual([{ role: 'user', content: 'Return JSON.' }]);
    expect(request.body.response_format).toEqual({ type: 'json_object' });
    expect(request.body.max_tokens).toBe(65536);
  });

  it('can switch ShopAIKey OpenAI-compatible requests between direct and official API endpoints', () => {
    expect(getShopAIKeyOpenAIBaseUrl({ shopAIKeyEndpoint: 'direct' })).toBe(SHOPAIKEY_OPENAI_DIRECT_BASE_URL);
    expect(getShopAIKeyOpenAIBaseUrl({ shopAIKeyEndpoint: 'api' })).toBe(SHOPAIKEY_OPENAI_API_BASE_URL);

    const officialRequest = buildOpenAICompatibleProviderRequest(
      { ...shopAIKeySettings, shopAIKeyEndpoint: 'api' },
      'openai/gpt-5.4-mini',
      [{ role: 'user', content: 'Return JSON.' }]
    );

    expect(officialRequest.url).toBe('https://api.shopaikey.com/v1/chat/completions');
  });

  it('builds ShopAIKey OpenAI-compatible requests for the Responses API route', () => {
    const request = buildOpenAICompatibleProviderRequest(
      { ...shopAIKeySettings, shopAIKeyOpenAIRoute: 'responses' },
      'openai/gpt-5.4-mini',
      [
        { role: 'system', content: 'Return JSON.' },
        { role: 'user', content: 'Scan this.' },
      ]
    );

    expect(request.url).toBe('https://direct.shopaikey.com/v1/responses');
    expect(request.endpointKind).toBe('responses');
    expect(request.body.model).toBe('gpt-5.4-mini');
    expect(request.body.input).toEqual([{ role: 'user', content: 'Scan this.' }]);
    expect(request.body.instructions).toContain('Return JSON.');
    expect(request.body.instructions).toContain('Endpoint hiện tại không hỗ trợ response_format');
    expect(request.body.max_output_tokens).toBe(65536);
    expect(request.body.response_format).toBeUndefined();
  });

  it('builds ShopAIKey Claude Messages requests with system text and image payloads', () => {
    const request = buildOpenAICompatibleProviderRequest(
      { ...shopAIKeySettings, model: 'anthropic/claude-sonnet-4.6' },
      'anthropic/claude-sonnet-4.6',
      [
        { role: 'system', content: 'Return JSON.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Mô tả ảnh.' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
          ],
        },
      ]
    );

    expect(request.url).toBe('https://direct.shopaikey.com/v1/messages');
    expect(request.endpointKind).toBe('claude');
    expect(request.body.model).toBe('claude-sonnet-4-6');
    expect(request.body.system).toContain('Return JSON.');
    expect(request.body.system).toContain('Endpoint hiện tại không hỗ trợ response_format');
    expect(request.body.messages[0].role).toBe('user');
    expect(request.body.messages[0].content).toEqual([
      { type: 'text', text: 'Mô tả ảnh.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
    ]);
    expect(request.body.max_tokens).toBeGreaterThan(0);
  });

  it('uses the active rotated key override for OpenAI-compatible provider attempts', () => {
    const request = buildOpenAICompatibleProviderRequest(
      { ...shopAIKeySettings, shopAIKeyKey: 'key-one,key-two' },
      'openai/gpt-5.4-mini',
      [{ role: 'user', content: 'Return JSON.' }],
      true,
      'key-two'
    );

    expect(getOpenAICompatibleRuntimeApiKeys({ ...shopAIKeySettings, shopAIKeyKey: 'key-one,key-two' })).toBe('key-one,key-two');
    expect(request.apiKey).toBe('key-two');
    expect(request.headers.Authorization).toBe('Bearer key-two');
  });

  it('rejects ShopAIKey Gemini requests from the OpenAI-compatible adapter', () => {
    expect(() => buildOpenAICompatibleProviderRequest(
      { ...shopAIKeySettings, model: 'gemini-3.1-flash-lite-preview' },
      'gemini-3.1-flash-lite-preview',
      [{ role: 'user', content: 'Return JSON.' }]
    )).toThrow('Unsupported OpenAI-compatible provider');
  });

  it('blocks ShopAIKey DeepSeek image_url payloads before hitting the gateway', () => {
    expect(() => buildOpenAICompatibleProviderRequest(
      { ...shopAIKeySettings, model: 'deepseek-v4-pro' },
      'deepseek-v4-pro',
      [{
        role: 'user',
        content: [
          { type: 'text', text: 'Mô tả ảnh này.' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc123' } },
        ],
      }]
    )).toThrow('SHOPAIKEY_DEEPSEEK_VISION_GROUP_UNSUPPORTED');
  });

  it('keeps ShopAIKey DeepSeek text-only requests on the selected model', () => {
    const request = buildOpenAICompatibleProviderRequest(
      { ...shopAIKeySettings, model: 'deepseek-v4-pro' },
      'deepseek-v4-pro',
      [{ role: 'user', content: [{ type: 'text', text: 'Trích xuất từ OCR này.' }] }]
    );
    expect(request.body.model).toBe('deepseek-v4-pro');
    expect(request.endpointKind).toBe('chat');
    expect(request.body.messages[0].content).toEqual([{ type: 'text', text: 'Trích xuất từ OCR này.' }]);
    expect(request.body.response_format).toEqual({ type: 'json_object' });
  });

  it('retries ShopAIKey chat calls without response_format when a model rejects JSON mode', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'This model does not support response_format' },
      }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: '{"questions":[]}' } }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAICompatibleProvider(
      shopAIKeySettings,
      'openai/gpt-5.4-mini',
      [{ role: 'user', content: 'Scan this.' }]
    );

    expect(result).toBe('{"questions":[]}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.model).toBe('gpt-5.4-mini');
    expect(firstBody.response_format).toEqual({ type: 'json_object' });
    expect(secondBody.model).toBe('gpt-5.4-mini');
    expect(secondBody.response_format).toBeUndefined();
    expect(secondBody.messages[0].content).toContain('Endpoint hiện tại không hỗ trợ response_format');
  });

  it('calls ShopAIKey Responses API and parses output content text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [
        { content: [{ type: 'output_text', text: '{"questions":[]}' }] },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAICompatibleProvider(
      { ...shopAIKeySettings, shopAIKeyOpenAIRoute: 'responses' },
      'gpt-5.4-mini',
      [{ role: 'user', content: 'Scan this.' }]
    );

    expect(result).toBe('{"questions":[]}');
    expect(fetchMock.mock.calls[0][0]).toBe('https://direct.shopaikey.com/v1/responses');
  });

  it('calls ShopAIKey Claude Messages and parses content text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: '{"questions":[]}' }],
      stop_reason: 'end_turn',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callOpenAICompatibleProvider(
      { ...shopAIKeySettings, model: 'claude-sonnet-4-6' },
      'claude-sonnet-4-6',
      [{ role: 'user', content: 'Scan this.' }]
    );

    expect(result).toBe('{"questions":[]}');
    expect(fetchMock.mock.calls[0][0]).toBe('https://direct.shopaikey.com/v1/messages');
  });

  it('passes external abort signals through provider fetch calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"questions":[]}' } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const result = await callOpenAICompatibleProvider(
      shopAIKeySettings,
      'openai/gpt-5.4-mini',
      [{ role: 'user', content: 'Scan this.' }],
      true,
      { signal: controller.signal, timeoutMs: 123 }
    );

    expect(result).toBe('{"questions":[]}');
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('wraps browser network/CORS failures with provider and model context', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(callOpenAICompatibleProvider(
      shopAIKeySettings,
      'openai/gpt-5.4-mini',
      [{ role: 'user', content: 'Scan this.' }]
    )).rejects.toThrow('ShopAIKey NETWORK_ERROR: Failed to fetch | model=gpt-5.4-mini');
  });

  it('validates a ShopAIKey key and selected model through /v1/models', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
      object: 'list',
      data: [
        { id: 'deepseek-v3.2' },
        { id: 'gpt-5.4-mini' },
      ],
    }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'pong' } }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateShopAIKeyConnection('shop-key', 'openai/gpt-5.4-mini');

    expect(result.ok).toBe(true);
    expect(result.selectedModel).toBe('gpt-5.4-mini');
    expect(result.selectedModelAvailable).toBe(true);
    expect(result.models).toEqual(['deepseek-v3.2', 'gpt-5.4-mini']);
    expect(fetchMock).toHaveBeenCalledWith('https://direct.shopaikey.com/v1/models', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer shop-key' }),
    }));
    const probeBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(fetchMock.mock.calls[1][0]).toBe('https://direct.shopaikey.com/v1/chat/completions');
    expect(probeBody.model).toBe('gpt-5.4-mini');
    expect(probeBody.messages).toEqual([{ role: 'user', content: 'ping' }]);
    expect(probeBody.max_tokens).toBe(8);
    expect(probeBody.response_format).toBeUndefined();
  });

  it('validates ShopAIKey through the official API endpoint when selected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'gpt-5.4-mini' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'pong' } }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateShopAIKeyConnection('shop-key', 'gpt-5.4-mini', 'api');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('official api');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.shopaikey.com/v1/models');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.shopaikey.com/v1/chat/completions');
  });

  it('validates ShopAIKey OpenAI-compatible models through /v1/responses when selected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'gpt-5.4-mini' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output: [{ content: [{ text: 'pong' }] }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateShopAIKeyConnection('shop-key', 'gpt-5.4-mini', 'direct', 'responses');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('OpenAI Responses');
    expect(fetchMock.mock.calls[1][0]).toBe('https://direct.shopaikey.com/v1/responses');
    const probeBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(probeBody).toMatchObject({ model: 'gpt-5.4-mini', input: 'ping', max_output_tokens: 8 });
  });

  it('validates ShopAIKey Claude models through /v1/messages', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'claude-sonnet-4-6' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        content: [{ type: 'text', text: 'pong' }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateShopAIKeyConnection('shop-key', 'anthropic/claude-sonnet-4.6');

    expect(result.ok).toBe(true);
    expect(result.selectedModel).toBe('claude-sonnet-4-6');
    expect(result.message).toContain('Claude Messages');
    expect(fetchMock.mock.calls[1][0]).toBe('https://direct.shopaikey.com/v1/messages');
    const probeBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(probeBody).toMatchObject({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
    });
  });

  it('validates ShopAIKey Gemini models through the native Google GenAI endpoint', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'gpt-5.4-mini' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'pong' }] } }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateShopAIKeyConnection('shop-key', 'google/gemini-3.1-flash-lite-preview');

    expect(result.ok).toBe(true);
    expect(result.selectedModel).toBe('gemini-3.1-flash-lite-preview');
    expect(result.selectedModelAvailable).toBe(true);
    expect(result.models).toContain('gemini-3.1-flash-lite-preview');
    expect(fetchMock.mock.calls[1][0]).toBe('https://direct.shopaikey.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent');
    expect(fetchMock.mock.calls[1][1].headers).toMatchObject({
      Authorization: 'Bearer shop-key',
      'Content-Type': 'application/json',
    });
    const probeBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(probeBody.contents).toEqual([{ role: 'user', parts: [{ text: 'ping' }] }]);
    expect(probeBody.generationConfig.maxOutputTokens).toBe(8);
  });

  it('validates ShopAIKey Gemini through the official Google GenAI endpoint when selected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        object: 'list',
        data: [{ id: 'gpt-5.4-mini' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'pong' }] } }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateShopAIKeyConnection('shop-key', 'gemini-3.1-flash-lite-preview', 'api');

    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.shopaikey.com/v1/models');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.shopaikey.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent');
  });

  it('fails ShopAIKey validation when the selected model has no chat channel', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'deepseek-v4-flash' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'no available channel for group cheap,gemini model deepseek-v4-flash (request id: req-1)' },
      }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateShopAIKeyConnection('shop-key', 'deepseek-v4-flash');

    expect(result.ok).toBe(false);
    expect(result.selectedModelAvailable).toBe(true);
    expect(result.status).toBe(500);
    expect(result.message).toContain('chưa có kênh khả dụng');
    expect(result.message).toContain('Model: deepseek-v4-flash');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('diagnoses official API channel failures when direct backup works', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'gpt-5-nano-2025-08-07' }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'no available channel for group cheap,gemini model gpt-5-nano-2025-08-07 (request id: req-2)' },
      }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'pong' } }],
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateShopAIKeyConnection('shop-key', 'gpt-5-nano-2025-08-07', 'api');

    expect(result.ok).toBe(false);
    expect(result.selectedModelAvailable).toBe(true);
    expect(result.message).toContain('Official API');
    expect(result.message).toContain('Direct backup phản hồi OK');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.shopaikey.com/v1/chat/completions');
    expect(fetchMock.mock.calls[2][0]).toBe('https://direct.shopaikey.com/v1/chat/completions');
  });

  it('reports a valid ShopAIKey key with a missing selected model', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'deepseek-v3.2' }],
    }), { status: 200 })));

    const result = await validateShopAIKeyConnection('shop-key', 'gpt-5.4-mini');

    expect(result.ok).toBe(false);
    expect(result.selectedModelAvailable).toBe(false);
    expect(result.models).toEqual(['deepseek-v3.2']);
    expect(result.message).toContain('không có trong danh sách model');
  });

  it.each([
    [401, 'không hợp lệ'],
    [402, 'hết số dư'],
    [403, 'không có quyền'],
    [429, 'giới hạn tốc độ'],
  ])('maps ShopAIKey validation status %s to actionable copy', async (status, expectedText) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'provider detail' },
    }), { status })));

    const result = await validateShopAIKeyConnection('shop-key', 'gpt-5.4-mini');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(status);
    expect(result.message).toContain(expectedText);
    expect(result.message).toContain('provider detail');
  });
});
