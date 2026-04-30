import { AppSettings, UploadedFile } from '../../types';
import { getModelTokenProfile } from '../../utils/models';
import { getFileTextContent } from './batching';
import { createProviderApiError } from './providerErrors';

export type OpenAICompatibleProvider = 'shopaikey' | 'openrouter' | 'vertexai';

export interface ProviderRequestConfig {
  url: string;
  providerName: string;
  model: string;
  apiKey: string;
  headers: Record<string, string>;
  body: Record<string, any>;
}

const JSON_MODE_FALLBACK_INSTRUCTION = 'QUAN TRỌNG: Endpoint hiện tại không hỗ trợ response_format. Bạn vẫn PHẢI trả về JSON hợp lệ duy nhất, không markdown, không giải thích ngoài JSON.';

export const isOpenAICompatibleProvider = (provider: AppSettings['provider']): provider is OpenAICompatibleProvider =>
  provider === 'shopaikey' || provider === 'openrouter' || provider === 'vertexai';

const getProviderName = (provider: OpenAICompatibleProvider): string => {
  if (provider === 'vertexai') return 'Vertex AI';
  if (provider === 'shopaikey') return 'ShopAIKey';
  return 'OpenRouter';
};

const normalizeVertexLocation = (location?: string): string => (location || 'global').trim() || 'global';

export const normalizeVertexOpenAIModel = (model: string): string => {
  if (!model) return 'google/gemini-2.5-flash';
  if (model.startsWith('google/')) return model;
  return `google/${model}`;
};

const normalizeProviderModel = (provider: OpenAICompatibleProvider, model: string): string => {
  if (provider === 'vertexai') return normalizeVertexOpenAIModel(model);
  return model;
};

const buildProviderUrl = (settings: AppSettings): string => {
  if (settings.provider === 'vertexai') {
    const location = normalizeVertexLocation(settings.vertexLocation);
    const projectId = settings.vertexProjectId?.trim();
    return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/endpoints/openapi/chat/completions`;
  }
  if (settings.provider === 'shopaikey') return 'https://api.shopaikey.com/v1/chat/completions';
  return 'https://openrouter.ai/api/v1/chat/completions';
};

const getProviderApiKey = (settings: AppSettings): string | undefined => {
  if (settings.provider === 'vertexai') return settings.vertexAccessToken;
  if (settings.provider === 'shopaikey') return settings.shopAIKeyKey;
  return settings.openRouterKey;
};

const buildProviderHeaders = (settings: AppSettings, apiKey: string): Record<string, string> => {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (settings.provider !== 'vertexai' && typeof window !== 'undefined') {
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
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify(request.body),
  });

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
  if (part.inlineData) {
    if (part.inlineData.mimeType === 'application/pdf') {
      throw new Error('PDF_PROVIDER_RASTERIZATION_REQUIRED: Provider OpenAI-compatible không nhận PDF thô. Hãy để hệ thống chuyển PDF sang ảnh trước khi quét.');
    }
    return [{ type: 'image_url', image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` } }];
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
