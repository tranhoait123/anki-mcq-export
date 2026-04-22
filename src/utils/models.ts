import { AppSettings } from '../types';

export type AIProvider = AppSettings['provider'];

export interface ModelOption {
  value: string;
  label: string;
}

export interface ModelGroup {
  label: string;
  options: ModelOption[];
}

export interface ModelTokenProfile {
  inputLimit: number;
  outputLimit: number;
  safeOutputBudget: number;
  maxQuestionsPerBatch: number;
  visionPagesPerBatch: number;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite-preview';
export const OPENROUTER_VISION_FALLBACK_MODEL = 'google/gemini-2.5-flash';
export const SHOPAIKEY_VISION_FALLBACK_MODEL = 'gemini-2.5-flash';

export const MODEL_GROUPS: Record<AIProvider, ModelGroup[]> = {
  google: [
    {
      label: 'Mới nhất 2026',
      options: [
        { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (Mới nhất - tốc độ cao)' },
        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Stable - tiết kiệm)' },
      ],
    },
    {
      label: 'Google Gemini hiện có',
      options: [
        { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Mạnh nhất - Tư duy Y khoa sâu)' },
        { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite (Khuyên dùng - Nhanh & Mượt)' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Ổn định - Tương thích cao)' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Sắp xếp dự phòng - Tương thích)' },
        { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Cực nhanh)' },
      ],
    },
  ],
  shopaikey: [
    {
      label: 'Mới nhất 2026',
      options: [
        { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro (ShopAIKey)' },
        { value: 'gpt-5.4', label: 'GPT-5.4 (ShopAIKey)' },
        { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (ShopAIKey)' },
        { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano (ShopAIKey)' },
        { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (ShopAIKey)' },
        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (ShopAIKey)' },
        { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (ShopAIKey)' },
        { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (gateway tương thích)' },
        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (gateway tương thích)' },
        { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (ShopAIKey)' },
      ],
    },
    {
      label: 'Hệ thống ShopAIKey (2026)',
      options: [
        { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Mạnh nhất 2026)' },
        { value: 'o3-pro', label: 'OpenAI o3 Pro' },
        { value: 'o3-mini', label: 'OpenAI o3-mini' },
        { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { value: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
        { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite (Tối ưu chi phí)' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Rất ổn định)' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Cân bằng hiệu suất)' },
      ],
    },
  ],
  openrouter: [
    {
      label: 'Mới nhất 2026',
      options: [
        { value: 'openai/gpt-5.4-pro', label: 'GPT-5.4 Pro' },
        { value: 'openai/gpt-5.4', label: 'GPT-5.4' },
        { value: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
        { value: 'openai/gpt-5.4-nano', label: 'GPT-5.4 Nano' },
        { value: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7' },
        { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
        { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
        { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (OpenRouter)' },
        { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (OpenRouter)' },
      ],
    },
    {
      label: 'Hệ thống OpenRouter',
      options: [
        { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Mạnh nhất GCP)' },
        { value: 'openai/gpt-4.5-preview', label: 'GPT-4.5 Preview (Tối tân nhất)' },
        { value: 'openai/o3-pro', label: 'OpenAI o3 Pro (Lý luận chuyên gia)' },
        { value: 'openai/o3-mini', label: 'OpenAI o3-mini (Lý luận lập trình & Logic)' },
        { value: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet (Siêu việt lập luận)' },
        { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2 (Mới nhất)' },
        { value: 'openai/gpt-4o', label: 'GPT-4o (Thông minh, toàn diện)' },
        { value: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (OpenRouter; official DeepSeek API: deepseek-chat)' },
        { value: 'deepseek/deepseek-r1', label: 'DeepSeek Reasoner (OpenRouter R1; official DeepSeek API: deepseek-reasoner)' },
        { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro (OpenRouter API)' },
        { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash (OpenRouter API)' },
        { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (Siêu tốc)' },
        { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
      ],
    },
    {
      label: 'Newest OpenRouter bổ sung',
      options: [
        { value: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
        { value: 'z-ai/glm-5.1', label: 'GLM 5.1' },
        { value: 'qwen/qwen3.6-plus', label: 'Qwen3.6 Plus' },
      ],
    },
  ],
  vertexai: [
    {
      label: 'Mới nhất 2026',
      options: [
        { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite Stable' },
      ],
    },
    {
      label: 'Google Cloud Vertex AI',
      options: [
        { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
        { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Nền tảng GCP)' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { value: 'gemini-2.0-pro-exp-0205', label: 'Gemini 2.0 Pro Experimental' },
        { value: 'gemini-2.0-flash-001', label: 'Gemini 2.0 Flash 001' },
        { value: 'gemini-2.0-flash-lite-preview-02-05', label: 'Gemini 2.0 Flash-Lite' },
      ],
    },
  ],
};

export const getModelGroups = (provider: AIProvider): ModelGroup[] => MODEL_GROUPS[provider] ?? MODEL_GROUPS.google;

export const getModelValues = (provider: AIProvider): string[] =>
  getModelGroups(provider).flatMap(group => group.options.map(option => option.value));

const SHOPAIKEY_MODEL_ALIASES: Record<string, string> = {
  'openai/gpt-5.4-pro': 'gpt-5.4-pro',
  'openai/gpt-5.4': 'gpt-5.4',
  'openai/gpt-5.4-mini': 'gpt-5.4-mini',
  'openai/gpt-5.4-nano': 'gpt-5.4-nano',
  'openai/o3-pro': 'o3-pro',
  'openai/o3-mini': 'o3-mini',
  'anthropic/claude-opus-4.7': 'claude-opus-4-7',
  'anthropic/claude-sonnet-4.6': 'claude-sonnet-4-6',
  'anthropic/claude-haiku-4.5': 'claude-haiku-4-5-20251001',
  'anthropic/claude-3.7-sonnet': 'claude-sonnet-4-20250514',
  'deepseek/deepseek-v3.2': 'deepseek-v3.2',
  'deepseek/deepseek-reasoner': 'deepseek-reasoner',
};

export const normalizeModelForProvider = (provider: AIProvider, model: string): string => {
  if (provider === 'shopaikey') return SHOPAIKEY_MODEL_ALIASES[model] || model;
  return model;
};

export const isModelAllowedForProvider = (provider: AIProvider, model: string): boolean => {
  const normalizedModel = normalizeModelForProvider(provider, model);
  if (!normalizedModel) return false;
  if (provider === 'google' || provider === 'vertexai') return normalizedModel.startsWith('gemini-');
  return true;
};

export const getProviderFallbackModel = (provider: AIProvider): string => {
  if (provider === 'openrouter') return OPENROUTER_VISION_FALLBACK_MODEL;
  return 'gemini-2.5-flash';
};

export const isVisionCapableModel = (provider: AIProvider, model: string): boolean => {
  const normalizedModel = normalizeModelForProvider(provider, model);
  if (!normalizedModel) return false;
  if (provider === 'google' || provider === 'vertexai') return normalizedModel.startsWith('gemini-');

  const normalized = normalizedModel.toLowerCase();
  if (normalized.includes('gemini')) return true;
  if (normalized.includes('gpt-4o')) return true;
  if (normalized.includes('gpt-5.4')) return true;
  if (normalized.includes('claude')) return true;
  return false;
};

export const getVisionFallbackModel = (provider: AIProvider): string => {
  if (provider === 'openrouter') return OPENROUTER_VISION_FALLBACK_MODEL;
  if (provider === 'shopaikey') return SHOPAIKEY_VISION_FALLBACK_MODEL;
  return getProviderFallbackModel(provider);
};

export const coerceModelForProvider = (provider: AIProvider, model: string): string => {
  const normalizedModel = normalizeModelForProvider(provider, model);
  if (isModelAllowedForProvider(provider, normalizedModel)) return normalizedModel;
  if (provider === 'google' || provider === 'vertexai') return DEFAULT_GEMINI_MODEL;
  return getProviderFallbackModel(provider);
};

export const coerceModelForProviderInput = (provider: AIProvider, model: string, requiresVision: boolean): string => {
  const providerSafeModel = coerceModelForProvider(provider, model);
  if (!requiresVision) return providerSafeModel;
  if (isVisionCapableModel(provider, providerSafeModel)) return providerSafeModel;
  return getVisionFallbackModel(provider);
};

export const getProviderModelMismatchMessage = (provider: AIProvider, model: string): string | null => {
  if (isModelAllowedForProvider(provider, model)) return null;
  if (provider === 'google' || provider === 'vertexai') {
    return `MODEL_PROVIDER_MISMATCH: Model "${model || '(trống)'}" không dùng được với ${provider === 'google' ? 'Google Gemini' : 'Vertex AI'}. Chỉ model dạng gemini-* mới gọi được Google endpoint.`;
  }
  return `MODEL_PROVIDER_MISMATCH: Model đang trống hoặc không phù hợp với provider hiện tại.`;
};

const GEMINI_FLASH_PROFILE: ModelTokenProfile = {
  inputLimit: 1_048_576,
  outputLimit: 65_536,
  safeOutputBudget: 49_152,
  maxQuestionsPerBatch: 35,
  visionPagesPerBatch: 4,
};

const GPT5_PROFILE: ModelTokenProfile = {
  inputLimit: 400_000,
  outputLimit: 128_000,
  safeOutputBudget: 65_536,
  maxQuestionsPerBatch: 35,
  visionPagesPerBatch: 3,
};

const CONSERVATIVE_PROFILE: ModelTokenProfile = {
  inputLimit: 128_000,
  outputLimit: 32_768,
  safeOutputBudget: 24_576,
  maxQuestionsPerBatch: 20,
  visionPagesPerBatch: 3,
};

export const getModelTokenProfile = (provider: AIProvider, model: string): ModelTokenProfile => {
  const normalizedModel = normalizeModelForProvider(provider, model || '');
  const normalized = normalizedModel.toLowerCase();

  if (
    normalized.includes('gemini-2.5-flash') ||
    normalized.includes('gemini-2.5-pro') ||
    normalized.includes('gemini-3-flash')
  ) {
    return { ...GEMINI_FLASH_PROFILE };
  }

  if (normalized.includes('gpt-5')) {
    return { ...GPT5_PROFILE };
  }

  return { ...CONSERVATIVE_PROFILE };
};
