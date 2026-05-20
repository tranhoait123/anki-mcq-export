import { AppSettings, UploadedFile } from '../../types';
import { getModelTokenProfile, isShopAIKeyDeepSeekModel, isShopAIKeyGeminiModel, normalizeModelForProvider } from '../../utils/models';
import { getFileTextContent } from './batching';
import { getShopAIKeyGoogleBaseUrl } from './googleProvider';
import { createProviderApiError, translateErrorForUser } from './providerErrors';

export type OpenAICompatibleProvider = 'shopaikey' | 'openrouter';

export interface ProviderRequestConfig {
  url: string;
  providerName: string;
  model: string;
  endpointKind: 'chat';
  apiKey: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

export interface ShopAIKeyValidationResult {
  ok: boolean;
  models: string[];
  selectedModel: string;
  selectedModelAvailable: boolean;
  message: string;
  status?: number;
}

export interface OpenAICompatibleCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  apiKeyOverride?: string;
}

const JSON_MODE_FALLBACK_INSTRUCTION = 'QUAN TRỌNG: Endpoint hiện tại không hỗ trợ response_format. Bạn vẫn PHẢI trả về JSON hợp lệ duy nhất, không markdown, không giải thích ngoài JSON.';
export const SHOPAIKEY_OPENAI_DIRECT_BASE_URL = 'https://direct.shopaikey.com/v1';
export const SHOPAIKEY_OPENAI_API_BASE_URL = 'https://api.shopaikey.com/v1';
export const SHOPAIKEY_OPENAI_BASE_URL = SHOPAIKEY_OPENAI_DIRECT_BASE_URL;
const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const isOpenAICompatibleProvider = (provider: AppSettings['provider']): provider is OpenAICompatibleProvider =>
  provider === 'shopaikey' || provider === 'openrouter';

export const isShopAIKeyGeminiRuntime = (settings: Pick<AppSettings, 'provider' | 'model'>): boolean =>
  settings.provider === 'shopaikey' && isShopAIKeyGeminiModel(settings.model);

export const isOpenAICompatibleRuntime = (settings: Pick<AppSettings, 'provider' | 'model'>): settings is Pick<AppSettings, 'provider' | 'model'> & { provider: OpenAICompatibleProvider } =>
  settings.provider === 'openrouter' || (settings.provider === 'shopaikey' && !isShopAIKeyGeminiRuntime(settings));

const getProviderName = (provider: OpenAICompatibleProvider): string => {
  if (provider === 'shopaikey') return 'ShopAIKey';
  return 'OpenRouter';
};

const normalizeProviderModel = (provider: OpenAICompatibleProvider, model: string): string => {
  if (provider === 'shopaikey') return normalizeModelForProvider(provider, model);
  return model;
};

export const getShopAIKeyOpenAIBaseUrl = (settings: Pick<AppSettings, 'shopAIKeyEndpoint'>): string =>
  settings.shopAIKeyEndpoint === 'api' ? SHOPAIKEY_OPENAI_API_BASE_URL : SHOPAIKEY_OPENAI_DIRECT_BASE_URL;

const buildProviderUrl = (settings: AppSettings): string => {
  if (settings.provider === 'shopaikey') {
    return `${getShopAIKeyOpenAIBaseUrl(settings)}/chat/completions`;
  }
  return OPENROUTER_CHAT_COMPLETIONS_URL;
};

const getProviderApiKey = (settings: AppSettings): string | undefined => {
  if (settings.provider === 'shopaikey') return settings.shopAIKeyKey;
  return settings.openRouterKey;
};

export const getOpenAICompatibleRuntimeApiKeys = (settings: Pick<AppSettings, 'provider' | 'shopAIKeyKey' | 'openRouterKey'>): string => {
  if (settings.provider === 'shopaikey') return settings.shopAIKeyKey;
  if (settings.provider === 'openrouter') return settings.openRouterKey || '';
  return '';
};

const buildProviderHeaders = (settings: AppSettings, apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (typeof window !== 'undefined') {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = 'MCQ AnkiGen Pro';
    if (settings.provider === 'openrouter') headers['X-OpenRouter-Title'] = 'MCQ AnkiGen Pro';
  }

  return headers;
};

const contentContainsImageUrl = (content: any): boolean => {
  if (!Array.isArray(content)) return false;
  return content.some(part => part?.type === 'image_url' || part?.image_url);
};

const messagesContainImageUrl = (messages: any[]): boolean =>
  messages.some(message => contentContainsImageUrl(message?.content));

const buildChatRequestBody = (
  settings: AppSettings,
  modelName: string,
  model: string,
  messages: any[],
  includeResponseFormat: boolean
): Record<string, any> => {
  const body: Record<string, any> = {
    model,
    messages,
    temperature: 0.1,
    max_tokens: getModelTokenProfile(settings.provider, modelName).safeOutputBudget,
  };

  if (includeResponseFormat) {
    body.response_format = { type: 'json_object' };
  }

  return body;
};

export const buildOpenAICompatibleProviderRequest = (
  settings: AppSettings,
  modelName: string,
  messages: any[],
  includeResponseFormat: boolean = true,
  apiKeyOverride?: string
): ProviderRequestConfig => {
  if (!isOpenAICompatibleRuntime(settings)) {
    throw new Error(`Unsupported OpenAI-compatible provider: ${settings.provider}`);
  }

  const apiKey = apiKeyOverride || getProviderApiKey(settings) || '';
  const model = normalizeProviderModel(settings.provider, modelName);
  if (settings.provider === 'shopaikey' && isShopAIKeyDeepSeekModel(model) && messagesContainImageUrl(messages)) {
    throw new Error(`SHOPAIKEY_DEEPSEEK_VISION_GROUP_UNSUPPORTED: DeepSeek ShopAIKey nằm trong group Cheap API nên app không gửi image_url/PDF scan thô để tránh gateway route sang group Gemini. Hãy dùng file text/OCR hoặc chọn model vision khác. | model=${model}`);
  }
  const endpointKind = 'chat';
  const body = buildChatRequestBody(settings, modelName, model, messages, includeResponseFormat);

  return {
    url: buildProviderUrl(settings),
    providerName: getProviderName(settings.provider),
    model,
    endpointKind,
    apiKey,
    headers: buildProviderHeaders(settings, apiKey),
    body,
  };
};

const buildShopAIKeyGeminiProbeUrl = (model: string, endpoint: AppSettings['shopAIKeyEndpoint']): string =>
  `${getShopAIKeyGoogleBaseUrl({ shopAIKeyEndpoint: endpoint })}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const buildShopAIKeyChatProbeBody = (model: string): Record<string, any> => ({
  model,
  messages: [{ role: 'user', content: 'ping' }],
  max_tokens: 8,
  temperature: 0,
});

const buildShopAIKeyGeminiProbeBody = (): Record<string, any> => ({
  contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
  generationConfig: {
    maxOutputTokens: 8,
    temperature: 0,
  },
});

const hasNoAvailableChannelSignal = (error: Error): boolean =>
  error.message.toLowerCase().includes('no available channel');

const extractProviderErrorDetail = async (response: Response): Promise<string> => {
  try {
    const raw = await response.text();
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      return parsed?.error?.message || parsed?.message || parsed?.detail || raw;
    } catch {
      return raw;
    }
  } catch {
    return '';
  }
};

const extractShopAIKeyModelIds = (data: any): string[] => {
  const items = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  const modelIds = items
    .map((item: any) => String(item?.id || item?.name || item || '').trim())
    .filter(Boolean);
  return Array.from(new Set<string>(modelIds))
    .sort((a, b) => a.localeCompare(b));
};

const getShopAIKeyValidationErrorMessage = (status: number, detail: string): string => {
  const cleanDetail = detail.replace(/\s+/g, ' ').slice(0, 180);
  const suffix = cleanDetail ? ` Chi tiết: ${cleanDetail}` : '';
  if (status === 401) return `ShopAIKey API key không hợp lệ hoặc đã hết hạn.${suffix}`;
  if (status === 402) return `Tài khoản ShopAIKey hết số dư. Vui lòng nạp thêm credit.${suffix}`;
  if (status === 403) return `ShopAIKey API key không có quyền truy cập model/API này.${suffix}`;
  if (status === 429) return `ShopAIKey đang giới hạn tốc độ. Chờ 1-2 phút rồi thử lại.${suffix}`;
  return `Không kiểm tra được ShopAIKey (mã ${status}).${suffix}`;
};

export const validateShopAIKeyConnection = async (
  apiKey: string,
  selectedModel: string,
  endpoint: AppSettings['shopAIKeyEndpoint'] = 'direct'
): Promise<ShopAIKeyValidationResult> => {
  const token = apiKey.trim();
  const normalizedSelectedModel = normalizeModelForProvider('shopaikey', selectedModel || '');
  if (!token) {
    return {
      ok: false,
      models: [],
      selectedModel: normalizedSelectedModel,
      selectedModelAvailable: false,
      message: 'Vui lòng nhập ShopAIKey API key trước khi kiểm tra.',
    };
  }

  try {
    const openAIBaseUrl = getShopAIKeyOpenAIBaseUrl({ shopAIKeyEndpoint: endpoint });
    const response = await fetch(`${openAIBaseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const detail = await extractProviderErrorDetail(response);
      return {
        ok: false,
        models: [],
        selectedModel: normalizedSelectedModel,
        selectedModelAvailable: false,
        status: response.status,
        message: getShopAIKeyValidationErrorMessage(response.status, detail),
      };
    }

    const data = await response.json();
    const listedModels = extractShopAIKeyModelIds(data);
    const isGeminiModel = isShopAIKeyGeminiModel(normalizedSelectedModel);
    const models = isGeminiModel && normalizedSelectedModel && !listedModels.includes(normalizedSelectedModel)
      ? [...listedModels, normalizedSelectedModel].sort((a, b) => a.localeCompare(b))
      : listedModels;
    const selectedModelAvailable = Boolean(normalizedSelectedModel && (listedModels.includes(normalizedSelectedModel) || isGeminiModel));

    if (!selectedModelAvailable) {
      return {
        ok: false,
        models,
        selectedModel: normalizedSelectedModel,
        selectedModelAvailable,
        message: `ShopAIKey key hợp lệ, nhưng model "${normalizedSelectedModel || '(trống)'}" không có trong danh sách model của key này. Hãy chọn model khả dụng từ danh sách đã xác minh.`,
      };
    }

    const probeResponse = await fetch(
      isGeminiModel
        ? buildShopAIKeyGeminiProbeUrl(normalizedSelectedModel, endpoint)
        : `${openAIBaseUrl}/chat/completions`,
      {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(isGeminiModel
        ? buildShopAIKeyGeminiProbeBody()
        : buildShopAIKeyChatProbeBody(normalizedSelectedModel)),
      }
    );

    if (!probeResponse.ok) {
      const error = await createProviderApiError('ShopAIKey', probeResponse, normalizedSelectedModel);
      if (endpoint === 'api' && !isGeminiModel && hasNoAvailableChannelSignal(error)) {
        const directProbeResponse = await fetch(`${SHOPAIKEY_OPENAI_DIRECT_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildShopAIKeyChatProbeBody(normalizedSelectedModel)),
        });
        if (directProbeResponse.ok) {
          return {
            ok: false,
            models,
            selectedModel: normalizedSelectedModel,
            selectedModelAvailable,
            status: probeResponse.status,
            message: `Official API của ShopAIKey đang lỗi channel cho model "${normalizedSelectedModel}", nhưng Direct backup phản hồi OK. Hãy đổi ShopAIKey Endpoint sang "Direct backup" rồi kiểm tra lại. Chi tiết official: ${error.message.slice(0, 220)}`,
          };
        }
      }
      return {
        ok: false,
        models,
        selectedModel: normalizedSelectedModel,
        selectedModelAvailable,
        status: probeResponse.status,
        message: translateErrorForUser(error, 'Kiểm tra ShopAIKey'),
      };
    }

    return {
      ok: true,
      models,
      selectedModel: normalizedSelectedModel,
      selectedModelAvailable,
      message: `ShopAIKey kết nối OK (${endpoint === 'api' ? 'official api' : 'direct backup'}). Model "${normalizedSelectedModel}" phản hồi ${isGeminiModel ? 'Google GenAI' : 'OpenAI Chat Completions'} OK.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      models: [],
      selectedModel: normalizedSelectedModel,
      selectedModelAvailable: false,
      message: `Không kết nối được tới ShopAIKey. Kiểm tra mạng/CORS rồi thử lại. Chi tiết: ${detail.slice(0, 180)}`,
    };
  }
};

const isResponseFormatUnsupportedError = (error: Error): boolean => {
  const msg = error.message.toLowerCase();
  return (
    (msg.includes('response_format') || msg.includes('json_object') || msg.includes('json mode')) &&
    (msg.includes('not support') || msg.includes('unsupported') || msg.includes('invalid') || msg.includes('unrecognized'))
  );
};

const withJsonModeFallbackPrompt = (messages: any[]): any[] => {
  const next = messages.map(message => ({ ...message }));
  const systemIndex = next.findIndex(message => message.role === 'system');
  if (systemIndex >= 0) {
    next[systemIndex] = {
      ...next[systemIndex],
      content: `${next[systemIndex].content}\n\n${JSON_MODE_FALLBACK_INSTRUCTION}`,
    };
  } else {
    next.unshift({ role: 'system', content: JSON_MODE_FALLBACK_INSTRUCTION });
  }
  return next;
};

const extractResponsesOutputText = (data: any): string => {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const output = Array.isArray(data?.output) ? data.output : [];
  return output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((part: any) => {
      if (typeof part === 'string') return part;
      return part?.text || part?.content || '';
    })
    .join('');
};

export const extractProviderMessageContent = (data: any): string => {
  const responsesText = extractResponsesOutputText(data);
  if (responsesText.trim()) return responsesText;
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part?.text || part?.content || ''))
      .join('');
  }
  if (typeof content === 'string' && content.trim()) return content;
  throw new Error('AI_FORMAT_ERROR_EMPTY_PROVIDER_RESPONSE: Provider không trả về choices[0].message.content.');
};

const getProviderFinishReason = (data: any): string =>
  String(data?.choices?.[0]?.finish_reason ?? data?.choices?.[0]?.finishReason ?? data?.finish_reason ?? '').toLowerCase();

const isTruncatedFinishReason = (finishReason: string): boolean =>
  finishReason === 'length' || finishReason === 'max_tokens' || finishReason === 'max_output_tokens';

export const callOpenAICompatibleProvider = async (
  settings: AppSettings,
  modelName: string,
  messages: any[],
  includeResponseFormat: boolean = true,
  options: OpenAICompatibleCallOptions = {}
): Promise<string> => {
  const request = buildOpenAICompatibleProviderRequest(settings, modelName, messages, includeResponseFormat, options.apiKeyOverride);
  const localAbortController = !options.signal && options.timeoutMs ? new AbortController() : null;
  const timeoutId = localAbortController && options.timeoutMs
    ? setTimeout(() => localAbortController.abort(), options.timeoutMs)
    : undefined;
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: options.signal || localAbortController?.signal,
    });
  } catch (error: any) {
    const detail = error?.message || String(error) || 'Network request failed';
    throw new Error(`${request.providerName} NETWORK_ERROR: ${detail} | model=${request.model}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = await createProviderApiError(request.providerName, response, request.model);
    if (includeResponseFormat && isResponseFormatUnsupportedError(error)) {
      console.warn(`${request.providerName}: response_format unsupported for ${request.model}. Retrying with prompt-only JSON mode.`);
      return callOpenAICompatibleProvider(settings, modelName, withJsonModeFallbackPrompt(messages), false, options);
    }
    throw error;
  }

  const data = await response.json();
  const content = extractProviderMessageContent(data);
  const finishReason = getProviderFinishReason(data);
  if (isTruncatedFinishReason(finishReason)) {
    const error: Error & { partialText?: string } = new Error(`AI_FORMAT_ERROR_TRUNCATED: Provider stopped because finish_reason=${finishReason}.`);
    error.partialText = content;
    throw error;
  }
  return content;
};

export const toOpenAIContentFromPart = (part: any): any[] => {
  const inlineDataParts = Array.isArray(part.inlineDataParts) ? part.inlineDataParts : [];
  if (inlineDataParts.length > 0) {
    return [
      ...(part.text ? [{ type: 'text', text: `[PDF_TEXT_LAYER_CONTEXT]\n${part.text}` }] : []),
      ...inlineDataParts.map((inlineData: any) => {
        if (inlineData.mimeType === 'application/pdf') {
          throw new Error('PDF_PROVIDER_RASTERIZATION_REQUIRED: Provider OpenAI-compatible không nhận PDF thô. Hãy để hệ thống chuyển PDF sang ảnh trước khi quét.');
        }
        return { type: 'image_url', image_url: { url: `data:${inlineData.mimeType};base64,${inlineData.data}` } };
      }),
    ];
  }
  if (part.inlineData) {
    if (part.inlineData.mimeType === 'application/pdf') {
      throw new Error('PDF_PROVIDER_RASTERIZATION_REQUIRED: Provider OpenAI-compatible không nhận PDF thô. Hãy để hệ thống chuyển PDF sang ảnh trước khi quét.');
    }
    return [
      ...(part.text ? [{ type: 'text', text: `[PDF_TEXT_LAYER_CONTEXT]\n${part.text}` }] : []),
      { type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } },
    ];
  }
  return [{ type: 'text', text: part.text || '' }];
};

export const toOpenAIContentFromFile = (file: UploadedFile): any => {
  if (file.type.startsWith('image/')) {
    return {
      type: 'image_url',
      image_url: { url: `data:${file.type};base64,${file.content.includes(',') ? file.content.split(',')[1] : file.content}` },
    };
  }
  if (file.type === 'application/pdf') {
    return { type: 'text', text: `FILE: ${file.name}\n[PDF chưa được chuyển sang ảnh. Vui lòng quét lại để hệ thống rasterize PDF trước.]\n` };
  }
  return { type: 'text', text: `FILE: ${file.name}\n${getFileTextContent(file)}\n` };
};
