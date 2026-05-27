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

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
export const OPENROUTER_VISION_FALLBACK_MODEL = 'google/gemini-3.1-flash-lite';
export const SHOPAIKEY_VISION_FALLBACK_MODEL = DEFAULT_GEMINI_MODEL;

export const MODEL_GROUPS: Record<AIProvider, ModelGroup[]> = {
  google: [
    {
      label: 'Mới nhất 2026 (Free Tier)',
      options: [
        { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (Bản chính thức - Khuyên dùng)' },
        { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Tối tân nhất - Tốc độ & Coding)' },
        { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview (Mạnh mẽ & Lập trình)' },
        { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview (Sắp đóng)' },
        { value: 'gemini-flash-latest', label: 'Gemini Flash Latest (Alias - tốc độ/chất lượng mới nhất)' },
      ],
    },
    {
      label: 'Google Gemini hiện có (Free Tier)',
      options: [
        { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (Bản chính thức)' },
        { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (Đa năng/Mạnh mẽ)' },
        { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview (Suy luận sâu sắc)' },
        { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview (Free Tier)' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Flagship reasoning)' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Cân bằng hiệu suất)' },
        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Siêu nhanh & Tiết kiệm)' },
        { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (Cực nhanh - Shutdown 01/06/2026)' },
      ],
    },
  ],
  shopaikey: [
    {
      label: 'OpenAI-compatible qua ShopAIKey',
      options: [
        { value: 'gpt-5.5', label: 'GPT-5.5 (ShopAIKey - mạnh nhất cho đề khó)' },
        { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro (ShopAIKey)' },
        { value: 'gpt-5.4', label: 'GPT-5.4 (ShopAIKey)' },
        { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (ShopAIKey)' },
        { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano (ShopAIKey - rẻ/nhanh)' },
        { value: 'gpt-5-nano', label: 'GPT-5 Nano (ShopAIKey - rẻ/nhanh)' },
        { value: 'o3-pro', label: 'OpenAI o3 Pro' },
        { value: 'o3-mini', label: 'OpenAI o3-mini' },
      ],
    },
    {
      label: 'Claude qua ShopAIKey',
      options: [
        { value: 'claude-opus-4-7', label: 'Claude Opus 4.7 (ShopAIKey)' },
        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (ShopAIKey)' },
        { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (ShopAIKey)' },
      ],
    },
    {
      label: 'Gemini qua ShopAIKey',
      options: [
        { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (ShopAIKey - Mặc định)' },
        { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview (ShopAIKey - PDF/Ảnh & Suy luận)' },
        { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite Preview (ShopAIKey)' },
        { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (ShopAIKey)' },
        { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview (ShopAIKey)' },
        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (ShopAIKey - Rất ổn định)' },
        { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (ShopAIKey - Cân bằng hiệu suất)' },
        { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (ShopAIKey - Tiết kiệm)' },
      ],
    },
    {
      label: 'Model khác qua ShopAIKey',
      options: [
        { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (ShopAIKey - text reasoning, 1M context)' },
        { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (ShopAIKey - text nhanh/tiết kiệm)' },
        { value: 'qwen3.6-plus', label: 'Qwen3.6 Plus (ShopAIKey - long-context)' },
        { value: 'qwen3.6-27b', label: 'Qwen3.6 27B (ShopAIKey - cân bằng)' },
        { value: 'qwen3.6-35b-a3b', label: 'Qwen3.6 35B A3B (ShopAIKey - tiết kiệm)' },
        { value: 'grok-4-20-reasoning', label: 'Grok 4-20 Reasoning (ShopAIKey - suy luận text)' },
        { value: 'grok-4-20-non-reasoning', label: 'Grok 4-20 Non-Reasoning (ShopAIKey - nhanh hơn)' },
        { value: 'MiniMax-M2.7', label: 'MiniMax M2.7 (ShopAIKey - text model mới)' },
        { value: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro (ShopAIKey - text reasoning)' },
        { value: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
        { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner (ShopAIKey)' },
      ],
    },
  ],
  openrouter: [
    {
      label: 'Mới nhất 2026',
      options: [
        { value: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash (OpenRouter - Tối tân, agent/coding)' },
        { value: 'google/gemini-3.1-pro', label: 'Gemini 3.1 Pro (OpenRouter - Flagship reasoning)' },
        { value: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (OpenRouter - siêu tiết kiệm)' },
        { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (OpenRouter - Tiết kiệm)' },
        { value: '~google/gemini-pro-latest', label: 'Gemini Pro Latest (OpenRouter - audit đề khó/PDF dài)' },
        { value: '~google/gemini-flash-latest', label: 'Gemini Flash Latest (OpenRouter - nhanh, đa phương thức)' },
        { value: '~openai/gpt-latest', label: 'OpenAI GPT Latest (OpenRouter - lý luận mạnh)' },
        { value: '~anthropic/claude-sonnet-latest', label: 'Claude Sonnet Latest (OpenRouter - đọc hiểu dài tốt)' },
        { value: 'x-ai/grok-4.3', label: 'Grok 4.3 (OpenRouter - vision + reasoning, 1M context)' },
        { value: 'qwen/qwen3.6-flash', label: 'Qwen3.6 Flash (OpenRouter - nhanh, rẻ, multimodal)' },
        { value: 'openai/gpt-5.5', label: 'GPT-5.5 (OpenRouter - frontier, file/image)' },
        { value: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro (OpenRouter - text reasoning, 1M context)' },
        { value: 'openai/gpt-5.4-pro', label: 'GPT-5.4 Pro' },
        { value: 'openai/gpt-5.4', label: 'GPT-5.4' },
        { value: 'openai/gpt-5.4-mini', label: 'GPT-5.4 Mini' },
        { value: 'openai/gpt-5.4-nano', label: 'GPT-5.4 Nano' },
        { value: 'openai/gpt-5-nano', label: 'GPT-5 Nano' },
        { value: 'anthropic/claude-opus-4.7', label: 'Claude Opus 4.7' },
        { value: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6' },
        { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
      ],
    },
    {
      label: 'Hệ thống OpenRouter',
      options: [
        { value: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash (Tối tân nhất)' },
        { value: 'google/gemini-3.1-pro', label: 'Gemini 3.1 Pro (Mạnh nhất GCP)' },
        { value: 'google/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (Tiết kiệm)' },
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
        { value: 'openai/gpt-5.5-pro', label: 'GPT-5.5 Pro (đắt hơn - dùng khi cần độ chính xác cao)' },
        { value: '~openai/gpt-mini-latest', label: 'OpenAI GPT Mini Latest (nhanh/tiết kiệm)' },
        { value: '~anthropic/claude-haiku-latest', label: 'Claude Haiku Latest (nhanh/tiết kiệm)' },
        { value: 'qwen/qwen3.5-plus-20260420', label: 'Qwen3.5 Plus 2026-04-20 (1M context, multimodal)' },
        { value: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash (text nhanh, 1M context)' },
        { value: '~moonshotai/kimi-latest', label: 'Kimi Latest (long-context, multimodal)' },
        { value: 'moonshotai/kimi-k2.6', label: 'Kimi K2.6' },
        { value: 'z-ai/glm-5.1', label: 'GLM 5.1' },
        { value: 'qwen/qwen3.6-plus', label: 'Qwen3.6 Plus' },
      ],
    },
  ],
};

export const getModelGroups = (provider: AIProvider): ModelGroup[] => MODEL_GROUPS[provider] ?? MODEL_GROUPS.google;

export const getModelValues = (provider: AIProvider): string[] =>
  getModelGroups(provider).flatMap(group => group.options.map(option => option.value));

export const getShopAIKeyVerifiedModelGroups = (modelIds: string[]): ModelGroup[] => {
  const knownLabels = new Map(
    MODEL_GROUPS.shopaikey
      .flatMap(group => group.options)
      .map(option => [normalizeModelForProvider('shopaikey', option.value), option.label])
  );
  const options = Array.from(new Set(modelIds.map(model => normalizeModelForProvider('shopaikey', model)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b))
    .map(model => ({
      value: model,
      label: knownLabels.get(model) || model,
    }));

  return options.length > 0
    ? [{ label: 'ShopAIKey models đã xác minh từ API', options }]
    : MODEL_GROUPS.shopaikey;
};

const LEGACY_GEMINI_MODEL_PATTERNS = [
  /^gemini-1(?:\.|$|-)/,
  /^gemini-2\.0(?:-|$)/,
  /^gemini-pro$/,
  /^gemini-3-pro-preview$/,
];

export const isLegacyGeminiModel = (model: string): boolean => {
  const normalized = String(model || '').trim().toLowerCase().replace(/^google\//, '');
  return LEGACY_GEMINI_MODEL_PATTERNS.some(pattern => pattern.test(normalized));
};

export const getModelLifecycleWarning = (provider: AIProvider, model: string): string | null => {
  const normalizedModel = normalizeModelForProvider(provider, model || '');
  const displayModel = normalizedModel || '(trống)';

  if (!isModelAllowedForProvider(provider, normalizedModel)) {
    return getProviderModelMismatchMessage(provider, model);
  }

  if ((provider === 'google' || normalizedModel.includes('gemini')) && isLegacyGeminiModel(normalizedModel)) {
    return `MODEL_LIFECYCLE_WARNING: Model "${displayModel}" là model Gemini cũ/deprecated hoặc preview đã đóng. Ưu tiên sử dụng gemini-3.1-flash-lite hoặc gemini-3.5-flash để giảm lỗi endpoint.`;
  }

  return null;
};

const SHOPAIKEY_MODEL_ALIASES: Record<string, string> = {
  'openai/gpt-5.5': 'gpt-5.5',
  'openai/gpt-5.4-pro': 'gpt-5.4-pro',
  'openai/gpt-5.4': 'gpt-5.4',
  'openai/gpt-5.4-mini': 'gpt-5.4-mini',
  'openai/gpt-5.4-nano': 'gpt-5.4-nano',
  'openai/gpt-5-nano': 'gpt-5-nano',
  'google/gemini-3.5-flash': 'gemini-3.5-flash',
  'google/gemini-3.1-pro': 'gemini-3.1-pro',
  'google/gemini-3.1-flash-lite': 'gemini-3.1-flash-lite',
  'google/gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
  'google/gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite-preview',
  'google/gemini-3-pro-preview': 'gemini-3-pro-preview',
  'google/gemini-3-flash-preview': 'gemini-3-flash-preview',
  'google/gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'google/gemini-2.5-pro': 'gemini-2.5-pro',
  'google/gemini-2.5-flash': 'gemini-2.5-flash',
  'openai/o3-pro': 'o3-pro',
  'openai/o3-mini': 'o3-mini',
  'anthropic/claude-opus-4.7': 'claude-opus-4-7',
  'anthropic/claude-opus-4-7': 'claude-opus-4-7',
  'anthropic/claude-sonnet-4.6': 'claude-sonnet-4-6',
  'anthropic/claude-sonnet-4-6': 'claude-sonnet-4-6',
  'anthropic/claude-haiku-4.5': 'claude-haiku-4-5-20251001',
  'anthropic/claude-haiku-4-5': 'claude-haiku-4-5-20251001',
  'anthropic/claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
  'deepseek/deepseek-v3.2': 'deepseek-v3.2',
  'deepseek/deepseek-reasoner': 'deepseek-reasoner',
  'deepseek/deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek/deepseek-v4-flash': 'deepseek-v4-flash',
  'qwen/qwen3.6-plus': 'qwen3.6-plus',
  'qwen/qwen3.6-27b': 'qwen3.6-27b',
  'qwen/qwen3.6-35b-a3b': 'qwen3.6-35b-a3b',
};

export const normalizeModelForProvider = (provider: AIProvider, model: string): string => {
  if (!model) return '';
  if (provider === 'shopaikey') return SHOPAIKEY_MODEL_ALIASES[model] || model;
  if (provider === 'google') {
    if (model.startsWith('google/')) return model.substring(7);
    if (model.startsWith('~google/')) return model.substring(8);
  }
  return model;
};

export const isShopAIKeyDeepSeekModel = (model: string): boolean => {
  const normalized = normalizeModelForProvider('shopaikey', model || '').toLowerCase();
  return normalized.startsWith('deepseek-') || normalized === 'deepseek-chat' || normalized === 'deepseek-reasoner';
};

export const isShopAIKeyGeminiModel = (model: string): boolean => {
  const normalized = normalizeModelForProvider('shopaikey', model || '').toLowerCase();
  return normalized.startsWith('gemini-');
};

export const isShopAIKeyClaudeModel = (model: string): boolean => {
  const normalized = normalizeModelForProvider('shopaikey', model || '').toLowerCase();
  return normalized.startsWith('claude-');
};

export const isShopAIKeyOpenAIModel = (model: string): boolean =>
  Boolean(normalizeModelForProvider('shopaikey', model || '')) && !isShopAIKeyGeminiModel(model) && !isShopAIKeyClaudeModel(model);

export const isShopAIKeyOpenAIResponsesModel = isShopAIKeyOpenAIModel;

export const isModelAllowedForProvider = (provider: AIProvider, model: string): boolean => {
  const normalizedModel = normalizeModelForProvider(provider, model);
  if (!normalizedModel) return false;
  if (provider === 'google') return normalizedModel.startsWith('gemini-');
  return true;
};

export const getProviderFallbackModel = (provider: AIProvider, selectedModel: string = ''): string => {
  const normalizedSelectedModel = normalizeModelForProvider(provider, selectedModel);
  if (provider === 'google') {
    return isModelAllowedForProvider(provider, normalizedSelectedModel)
      ? normalizedSelectedModel
      : DEFAULT_GEMINI_MODEL;
  }
  if (provider === 'openrouter') return OPENROUTER_VISION_FALLBACK_MODEL;
  return DEFAULT_GEMINI_MODEL;
};

export const isVisionCapableModel = (provider: AIProvider, model: string): boolean => {
  const normalizedModel = normalizeModelForProvider(provider, model);
  if (!normalizedModel) return false;
  if (provider === 'google') return normalizedModel.startsWith('gemini-');

  const normalized = normalizedModel.toLowerCase();
  if (normalized.includes('gemini')) return true;
  if (normalized.includes('gpt-4o')) return true;
  if (normalized.includes('gpt-5')) return true;
  if (normalized.includes('gpt-latest') || normalized.includes('gpt-mini-latest')) return true;
  if (normalized.includes('claude')) return true;
  if (normalized.includes('grok-4.3')) return true;
  if (normalized.includes('qwen3.5-plus') || normalized.includes('qwen3.6-flash') || normalized.includes('qwen3.6-27b') || normalized.includes('qwen3.6-35b')) return true;
  if (normalized.includes('kimi')) return true;
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
  if (provider === 'google') return DEFAULT_GEMINI_MODEL;
  return getProviderFallbackModel(provider);
};

export const coerceModelForProviderInput = (provider: AIProvider, model: string, requiresVision: boolean): string => {
  const providerSafeModel = coerceModelForProvider(provider, model);
  if (!requiresVision) return providerSafeModel;
  if (provider === 'shopaikey' && isShopAIKeyDeepSeekModel(providerSafeModel)) return providerSafeModel;
  if (isVisionCapableModel(provider, providerSafeModel)) return providerSafeModel;
  return getVisionFallbackModel(provider);
};

export const getProviderModelMismatchMessage = (provider: AIProvider, model: string): string | null => {
  if (isModelAllowedForProvider(provider, model)) return null;
  if (provider === 'google') {
    return `MODEL_PROVIDER_MISMATCH: Model "${model || '(trống)'}" không dùng được với Google Gemini. Chỉ model dạng gemini-* mới gọi được Google endpoint.`;
  }
  return `MODEL_PROVIDER_MISMATCH: Model đang trống hoặc không phù hợp với provider hiện tại.`;
};

const GEMINI_FLASH_PROFILE: ModelTokenProfile = {
  inputLimit: 1_048_576,
  outputLimit: 65_536,
  safeOutputBudget: 15_000,
  maxQuestionsPerBatch: 10,
  visionPagesPerBatch: 2,
};

const GPT5_PROFILE: ModelTokenProfile = {
  inputLimit: 400_000,
  outputLimit: 128_000,
  safeOutputBudget: 65_536,
  maxQuestionsPerBatch: 10,
  visionPagesPerBatch: 2,
};

const CONSERVATIVE_PROFILE: ModelTokenProfile = {
  inputLimit: 128_000,
  outputLimit: 32_768,
  safeOutputBudget: 15_000,
  maxQuestionsPerBatch: 10,
  visionPagesPerBatch: 2,
};

export const getModelTokenProfile = (provider: AIProvider, model: string): ModelTokenProfile => {
  const normalizedModel = normalizeModelForProvider(provider, model || '');
  const normalized = normalizedModel.toLowerCase();

  if (
    normalized.includes('gemini-2.5-flash') ||
    normalized.includes('gemini-2.5-pro') ||
    normalized.includes('gemini-3-flash') ||
    normalized.includes('gemini-3.1') ||
    normalized.includes('gemini-3.5') ||
    normalized.includes('gemini-flash-latest') ||
    normalized.includes('gemini-pro-latest')
  ) {
    return { ...GEMINI_FLASH_PROFILE };
  }

  if (normalized.includes('gpt-5') || normalized.includes('gpt-latest') || normalized.includes('gpt-mini-latest')) {
    return { ...GPT5_PROFILE };
  }

  if (
    normalized.includes('claude-sonnet-latest') ||
    normalized.includes('grok-4.3') ||
    normalized.includes('grok-4-20') ||
    normalized.includes('qwen3.5-plus') ||
    normalized.includes('qwen3.6-plus') ||
    normalized.includes('qwen3.6-27b') ||
    normalized.includes('qwen3.6-35b') ||
    normalized.includes('qwen3.6-flash') ||
    normalized.includes('deepseek-v4') ||
    normalized.includes('minimax-m2.7') ||
    normalized.includes('mimo-v2.5') ||
    normalized.includes('kimi-latest')
  ) {
    return { ...GEMINI_FLASH_PROFILE };
  }

  return { ...CONSERVATIVE_PROFILE };
};
