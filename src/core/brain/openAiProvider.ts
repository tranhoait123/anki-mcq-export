import { AppSettings, UploadedFile } from '../../types';
import { getModelTokenProfile, normalizeModelForProvider } from '../../utils/models';
import { getFileTextContent } from './batching';
import { createProviderApiError } from './providerErrors';

export type OpenAICompatibleProvider = 'shopaikey' | 'openrouter';

export interface ProviderRequestConfig {
  url: string;
  providerName: string;
  model: string;
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

const JSON_MODE_FALLBACK_INSTRUCTION = 'QUAN TRỌNG: Endpoint hiện tại không hỗ trợ response_format. Bạn vẫn PHẢI trả về JSON hợp lệ duy nhất, không markdown, không giải thích ngoài JSON.';

export const isOpenAICompatibleProvider = (provider: AppSettings['provider']): provider is OpenAICompatibleProvider =>
  provider === 'shopaikey' || provider === 'openrouter';

const getProviderName = (provider: OpenAICompatibleProvider): string => {
  if (provider === 'shopaikey') return 'ShopAIKey';
  return 'OpenRouter';
};

const normalizeProviderModel = (provider: OpenAICompatibleProvider, model: string): string => {
  if (provider === 'shopaikey') return normalizeModelForProvider(provider, model);
  return model;
};

const buildProviderUrl = (settings: AppSettings): string => {
  if (settings.provider === 'shopaikey') return 'https://api.shopaikey.com/v1/chat/completions';
  return 'https://openrouter.ai/api/v1/chat/completions';
};

const getProviderApiKey = (settings: AppSettings): string | undefined => {
  if (settings.provider === 'shopaikey') return settings.shopAIKeyKey;
  return settings.openRouterKey;
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

export const buildOpenAICompatibleProviderRequest = (
  settings: AppSettings,
  modelName: string,
  messages: any[],
  includeResponseFormat: boolean = true
): ProviderRequestConfig => {
  if (!isOpenAICompatibleProvider(settings.provider)) {
    throw new Error(`Unsupported OpenAI-compatible provider: ${settings.provider}`);
  }

  const apiKey = getProviderApiKey(settings) || '';
  const model = normalizeProviderModel(settings.provider, modelName);
  const body: Record<string, any> = {
    model,
    messages,
    temperature: 0.1,
  };
  body.max_tokens = getModelTokenProfile(settings.provider, modelName).safeOutputBudget;

  if (includeResponseFormat) {
    body.response_format = { type: 'json_object' };
  }

  return {
    url: buildProviderUrl(settings),
    providerName: getProviderName(settings.provider),
    model,
    apiKey,
    headers: buildProviderHeaders(settings, apiKey),
    body,
  };
};

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
  selectedModel: string
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
    const response = await fetch('https://api.shopaikey.com/v1/models', {
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
    const models = extractShopAIKeyModelIds(data);
    const selectedModelAvailable = Boolean(normalizedSelectedModel && models.includes(normalizedSelectedModel));

    return {
      ok: selectedModelAvailable,
      models,
      selectedModel: normalizedSelectedModel,
      selectedModelAvailable,
      message: selectedModelAvailable
        ? `ShopAIKey kết nối OK. Model "${normalizedSelectedModel}" dùng được.`
        : `ShopAIKey key hợp lệ, nhưng model "${normalizedSelectedModel || '(trống)'}" không có trong danh sách model của key này. Hãy chọn model khả dụng từ danh sách đã xác minh.`,
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

export const extractProviderMessageContent = (data: any): string => {
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.content;
  if (Array.isArray(content)) {
    return content
      .map(part => (typeof part === 'string' ? part : part?.text || part?.content || ''))
      .join('');
  }
  if (typeof content === 'string' && content.trim()) return content;
  throw new Error('AI_FORMAT_ERROR_EMPTY_PROVIDER_RESPONSE: Provider không trả về choices[0].message.content.');
};

export const callOpenAICompatibleProvider = async (
  settings: AppSettings,
  modelName: string,
  messages: any[],
  includeResponseFormat: boolean = true
): Promise<string> => {
  const request = buildOpenAICompatibleProviderRequest(settings, modelName, messages, includeResponseFormat);
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
    });
  } catch (error: any) {
    const detail = error?.message || String(error) || 'Network request failed';
    throw new Error(`${request.providerName} NETWORK_ERROR: ${detail} | model=${request.model}`);
  }

  if (!response.ok) {
    const error = await createProviderApiError(request.providerName, response, request.model);
    if (includeResponseFormat && isResponseFormatUnsupportedError(error)) {
      console.warn(`${request.providerName}: response_format unsupported for ${request.model}. Retrying with prompt-only JSON mode.`);
      return callOpenAICompatibleProvider(settings, modelName, withJsonModeFallbackPrompt(messages), false);
    }
    throw error;
  }

  const data = await response.json();
  return extractProviderMessageContent(data);
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
