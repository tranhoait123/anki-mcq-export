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
export const SHOPAIKEY_VISION_FALLBACK_MODEL = DEFAULT_GEMINI_MODEL;

export const MODEL_GROUPS: Record<AIProvider, ModelGroup[]> = {
  google: [
    {
      label: 'Mới nhất 2026',
      options: [
        { value: 'gemini-pro-latest', label: 'Gemini Pro Latest (Alias - luôn bám Pro mới nhất)' },
        { value: 'gemini-flash-latest', label: 'Gemini Flash Latest (Alias - tốc độ/chất lượng mới nhất)' },
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
        { value: 'gpt-5.5', label: 'GPT-5.5 (ShopAIKey - mạnh nhất cho đề khó)' },
        { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview (ShopAIKey - PDF/ảnh + suy luận sâu)' },
        { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite (ShopAIKey - nhanh/rẻ cho scan đề)' },
        { value: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro (ShopAIKey - text reasoning, 1M context)' },
        { value: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (ShopAIKey - text nhanh/tiết kiệm)' },
        { value: 'qwen3.6-plus', label: 'Qwen3.6 Plus (ShopAIKey - long-context)' },
        { value: 'qwen3.6-27b', label: 'Qwen3.6 27B (ShopAIKey - cân bằng)' },
        { value: 'qwen3.6-35b-a3b', label: 'Qwen3.6 35B A3B (ShopAIKey - tiết kiệm)' },
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
        { value: 'grok-4-20-reasoning', label: 'Grok 4-20 Reasoning (ShopAIKey - suy luận text)' },
        { value: 'grok-4-20-non-reasoning', label: 'Grok 4-20 Non-Reasoning (ShopAIKey - nhanh hơn)' },
        { value: 'MiniMax-M2.7', label: 'MiniMax M2.7 (ShopAIKey - text model mới)' },
        { value: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro (ShopAIKey - text reasoning)' },
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
    return `MODEL_LIFECYCLE_WARNING: Model "${displayModel}" là model Gemini cũ/deprecated. Ưu tiên gemini-3.1-flash-lite-preview hoặc gemini-3-flash-preview để giảm lỗi endpoint và giới hạn legacy.`;
  }

  return null;
};

const SHOPAIKEY_MODEL_ALIASES: Record<string, string> = {
  'openai/gpt-5.5': 'gpt-5.5',
  'openai/gpt-5.4-pro': 'gpt-5.4-pro',
  'openai/gpt-5.4': 'gpt-5.4',
  'openai/gpt-5.4-mini': 'gpt-5.4-mini',
  'openai/gpt-5.4-nano': 'gpt-5.4-nano',
  'google/gemini-3.1-pro-preview': 'gemini-3.1-pro-preview',
  'google/gemini-3.1-flash-lite-preview': 'gemini-3.1-flash-lite-preview',
  'google/gemini-3-flash-preview': 'gemini-3-flash-preview',
  'google/gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'google/gemini-2.5-pro': 'gemini-2.5-pro',
  'google/gemini-2.5-flash': 'gemini-2.5-flash',
  'openai/o3-pro': 'o3-pro',
  'openai/o3-mini': 'o3-mini',
  'anthropic/claude-opus-4.7': 'claude-opus-4-7',
  'anthropic/claude-sonnet-4.6': 'claude-sonnet-4-6',
  'anthropic/claude-haiku-4.5': 'claude-haiku-4-5-20251001',
  'anthropic/claude-3.7-sonnet': 'claude-sonnet-4-20250514',
  'deepseek/deepseek-v3.2': 'deepseek-v3.2',
  'deepseek/deepseek-reasoner': 'deepseek-reasoner',
  'deepseek/deepseek-v4-pro': 'deepseek-v4-pro',
  'deepseek/deepseek-v4-flash': 'deepseek-v4-flash',
  'qwen/qwen3.6-plus': 'qwen3.6-plus',
  'qwen/qwen3.6-27b': 'qwen3.6-27b',
  'qwen/qwen3.6-35b-a3b': 'qwen3.6-35b-a3b',
};

export const normalizeModelForProvider = (provider: AIProvider, model: string): string => {
  if (provider === 'shopaikey') return SHOPAIKEY_MODEL_ALIASES[model] || model;
  return model;
};

export const isModelAllowedForProvider = (provider: AIProvider, model: string): boolean => {
  const normalizedModel = normalizeModelForProvider(provider, model);
  if (!normalizedModel) return false;
  if (provider === 'google') return normalizedModel.startsWith('gemini-');
  return true;
};

export const getProviderFallbackModel = (provider: AIProvider): string => {
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
    normalized.includes('gemini-3-flash') ||
    normalized.includes('gemini-3.1') ||
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
