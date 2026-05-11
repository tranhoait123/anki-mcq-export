import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOpenAICompatibleProviderRequest,
  callOpenAICompatibleProvider,
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

  it('builds ShopAIKey requests with normalized model ids and bearer auth', () => {
    const request = buildOpenAICompatibleProviderRequest(
      shopAIKeySettings,
      'openai/gpt-5.4-mini',
      [{ role: 'user', content: 'Return JSON.' }]
    );

    expect(request.url).toBe('https://api.shopaikey.com/v1/chat/completions');
    expect(request.providerName).toBe('ShopAIKey');
    expect(request.model).toBe('gpt-5.4-mini');
    expect(request.headers.Authorization).toBe('Bearer shop-key');
    expect(request.body.model).toBe('gpt-5.4-mini');
    expect(request.body.response_format).toEqual({ type: 'json_object' });
    expect(request.body.max_tokens).toBe(65536);
  });

  it('retries ShopAIKey calls without response_format when a model rejects JSON mode', async () => {
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
  });

  it('validates a ShopAIKey key and selected model through /v1/models', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: 'list',
      data: [
        { id: 'deepseek-v3.2' },
        { id: 'gpt-5.4-mini' },
      ],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await validateShopAIKeyConnection('shop-key', 'openai/gpt-5.4-mini');

    expect(result.ok).toBe(true);
    expect(result.selectedModel).toBe('gpt-5.4-mini');
    expect(result.selectedModelAvailable).toBe(true);
    expect(result.models).toEqual(['deepseek-v3.2', 'gpt-5.4-mini']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.shopaikey.com/v1/models', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer shop-key' }),
    }));
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
