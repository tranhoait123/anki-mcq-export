import { describe, expect, it } from 'vitest';
import {
  getModelGroups,
  getModelValues,
  getProviderFallbackModel,
  getModelTokenProfile,
  getShopAIKeyVerifiedModelGroups,
  coerceModelForProvider,
  coerceModelForProviderInput,
  getModelLifecycleWarning,
  isVisionCapableModel,
  isLegacyGeminiModel,
  isModelAllowedForProvider,
  isShopAIKeyDeepSeekModel,
  isShopAIKeyGeminiModel,
  isShopAIKeyOpenAIModel,
  isShopAIKeyOpenAIResponsesModel,
  normalizeModelForProvider,
} from './models';

describe('AI model registry', () => {
  it('keeps existing Google models and adds newest Gemini models', () => {
    const values = getModelValues('google');

    expect(values).toContain('gemini-3.1-pro-preview');
    expect(values).toContain('gemini-3.1-flash-lite-preview');
    expect(values).toContain('gemini-2.5-pro');
    expect(values).toContain('gemini-2.5-flash');
    expect(values).toContain('gemini-2.0-flash');
    expect(values).toContain('gemini-pro-latest');
    expect(values).toContain('gemini-flash-latest');
    expect(values).toContain('gemini-3-flash-preview');
    expect(values).toContain('gemini-2.5-flash-lite');
  });

  it('keeps existing OpenRouter models and adds newest provider families', () => {
    const values = getModelValues('openrouter');

    expect(values).toContain('google/gemini-3.1-pro-preview');
    expect(values).toContain('openai/gpt-4o');
    expect(values).toContain('deepseek/deepseek-chat');
    expect(values).toContain('deepseek/deepseek-r1');
    expect(values).toContain('openai/gpt-5.4-pro');
    expect(values).toContain('openai/gpt-5.4');
    expect(values).toContain('openai/gpt-5.5');
    expect(values).toContain('openai/gpt-5.5-pro');
    expect(values).toContain('~openai/gpt-latest');
    expect(values).toContain('~google/gemini-pro-latest');
    expect(values).toContain('~google/gemini-flash-latest');
    expect(values).toContain('~anthropic/claude-sonnet-latest');
    expect(values).toContain('x-ai/grok-4.3');
    expect(values).toContain('qwen/qwen3.6-flash');
    expect(values).toContain('qwen/qwen3.5-plus-20260420');
    expect(values).toContain('deepseek/deepseek-v4-pro');
    expect(values).toContain('anthropic/claude-opus-4.7');
    expect(values).toContain('anthropic/claude-sonnet-4.6');
    expect(values).toContain('anthropic/claude-haiku-4.5');
    expect(values).toContain('google/gemini-3-flash-preview');
    expect(values).toContain('google/gemini-2.5-flash-lite');
    expect(values).not.toContain('deepseek/deepseek-reasoner');
    expect(values).toContain('moonshotai/kimi-k2.6');
    expect(values).toContain('z-ai/glm-5.1');
    expect(values).toContain('qwen/qwen3.6-plus');
  });

  it('keeps ShopAIKey OpenAI-compatible and Gemini models without Claude entries', () => {
    const values = getModelValues('shopaikey');

    expect(values).toContain('o3-pro');
    expect(values).toContain('deepseek-v3.2');
    expect(values).toContain('gpt-5.5');
    expect(values).toContain('gemini-3.1-pro-preview');
    expect(values).toContain('gemini-3.1-flash-lite-preview');
    expect(values).toContain('deepseek-v4-pro');
    expect(values).toContain('deepseek-v4-flash');
    expect(values).toContain('qwen3.6-plus');
    expect(values).toContain('qwen3.6-27b');
    expect(values).toContain('qwen3.6-35b-a3b');
    expect(values).toContain('grok-4-20-reasoning');
    expect(values).toContain('MiniMax-M2.7');
    expect(values).toContain('mimo-v2.5-pro');
    expect(values).toContain('gpt-5.4-mini');
    expect(values).toContain('gpt-5.4-nano');
    expect(values).toContain('gpt-5-nano');
    expect(values).toContain('deepseek-reasoner');
    expect(values).not.toContain('openai/gpt-5.4-mini');
    expect(values).not.toContain('anthropic/claude-sonnet-4.6');
    expect(values.some(value => value.toLowerCase().includes('claude'))).toBe(false);
  });

  it('renders newest groups first for every provider', () => {
    expect(getModelGroups('google')[0].label).toBe('Mới nhất 2026');
    expect(getModelGroups('shopaikey')[0].label).toBe('OpenAI-compatible qua ShopAIKey');
    expect(getModelGroups('openrouter')[0].label).toBe('Mới nhất 2026');
  });

  it('uses provider-specific fallback models', () => {
    expect(getProviderFallbackModel('google')).toBe('gemini-3.1-flash-lite-preview');
    expect(getProviderFallbackModel('google', 'gemini-2.5-flash-lite')).toBe('gemini-2.5-flash-lite');
    expect(getProviderFallbackModel('shopaikey')).toBe('gemini-3.1-flash-lite-preview');
    expect(getProviderFallbackModel('openrouter')).toBe('google/gemini-2.5-flash');
  });

  it('does not reject DeepSeek for OpenRouter while rejecting non-Gemini for Google providers', () => {
    expect(isModelAllowedForProvider('openrouter', 'deepseek/deepseek-chat')).toBe(true);
    expect(isModelAllowedForProvider('shopaikey', 'deepseek/deepseek-v3.2')).toBe(true);
    expect(isModelAllowedForProvider('openrouter', 'custom/vendor-model')).toBe(true);
    expect(isModelAllowedForProvider('google', 'deepseek/deepseek-chat')).toBe(false);
  });

  it('coerces provider-incompatible models before runtime requests', () => {
    expect(coerceModelForProvider('google', 'deepseek/deepseek-v3.2')).toBe('gemini-3.1-flash-lite-preview');
    expect(coerceModelForProvider('openrouter', 'deepseek/deepseek-v3.2')).toBe('deepseek/deepseek-v3.2');
    expect(coerceModelForProvider('shopaikey', 'deepseek/deepseek-v3.2')).toBe('deepseek-v3.2');
  });

  it('flags legacy Gemini model choices without blocking compatible provider coercion', () => {
    expect(isLegacyGeminiModel('gemini-2.0-flash')).toBe(true);
    expect(isLegacyGeminiModel('google/gemini-2.0-flash-001')).toBe(true);
    expect(isLegacyGeminiModel('gemini-3-pro-preview')).toBe(true);
    expect(isLegacyGeminiModel('gemini-3-flash-preview')).toBe(false);
    expect(isLegacyGeminiModel('gemini-3.1-flash-lite-preview')).toBe(false);

    expect(getModelLifecycleWarning('google', 'gemini-2.0-flash')).toContain('MODEL_LIFECYCLE_WARNING');
    expect(getModelLifecycleWarning('openrouter', 'google/gemini-2.0-flash')).toContain('MODEL_LIFECYCLE_WARNING');
    expect(getModelLifecycleWarning('google', 'gemini-3.1-flash-lite-preview')).toBeNull();
  });

  it('surfaces provider mismatch through the lifecycle guardrail', () => {
    expect(getModelLifecycleWarning('google', 'openai/gpt-5.4')).toContain('MODEL_PROVIDER_MISMATCH');
    expect(getModelLifecycleWarning('openrouter', 'openai/gpt-5.4')).toBeNull();
  });

  it('keeps ShopAIKey DeepSeek direct for image or PDF input instead of silently falling back', () => {
    expect(isVisionCapableModel('openrouter', 'deepseek/deepseek-chat')).toBe(false);
    expect(isVisionCapableModel('openrouter', 'deepseek/deepseek-v4-pro')).toBe(false);
    expect(isVisionCapableModel('openrouter', 'x-ai/grok-4.3')).toBe(true);
    expect(isVisionCapableModel('shopaikey', 'grok-4-20-reasoning')).toBe(false);
    expect(isVisionCapableModel('openrouter', '~google/gemini-pro-latest')).toBe(true);
    expect(isVisionCapableModel('openrouter', 'qwen/qwen3.6-flash')).toBe(true);
    expect(isVisionCapableModel('shopaikey', 'gemini-3.1-pro-preview')).toBe(true);
    expect(isVisionCapableModel('shopaikey', 'qwen3.6-27b')).toBe(true);
    expect(isVisionCapableModel('shopaikey', 'gpt-5.4-mini')).toBe(true);
    expect(coerceModelForProviderInput('openrouter', 'deepseek/deepseek-chat', true)).toBe('google/gemini-2.5-flash');
    expect(coerceModelForProviderInput('shopaikey', 'deepseek-v4-pro', true)).toBe('deepseek-v4-pro');
    expect(coerceModelForProviderInput('shopaikey', 'deepseek-v4-flash', true)).toBe('deepseek-v4-flash');
    expect(coerceModelForProviderInput('shopaikey', 'deepseek/deepseek-v3.2', true)).toBe('deepseek-v3.2');
    expect(isShopAIKeyDeepSeekModel('deepseek-v4-pro')).toBe(true);
    expect(isShopAIKeyDeepSeekModel('deepseek/deepseek-v4-flash')).toBe(true);
    expect(coerceModelForProviderInput('openrouter', 'deepseek/deepseek-chat', false)).toBe('deepseek/deepseek-chat');
  });

  it('normalizes legacy OpenRouter-style ShopAIKey model ids to official ShopAIKey ids', () => {
    expect(normalizeModelForProvider('shopaikey', 'openai/gpt-5.4-mini')).toBe('gpt-5.4-mini');
    expect(normalizeModelForProvider('shopaikey', 'openai/gpt-5.5')).toBe('gpt-5.5');
    expect(normalizeModelForProvider('shopaikey', 'openai/gpt-5-nano')).toBe('gpt-5-nano');
    expect(normalizeModelForProvider('shopaikey', 'google/gemini-3.1-pro-preview')).toBe('gemini-3.1-pro-preview');
    expect(normalizeModelForProvider('shopaikey', 'anthropic/claude-opus-4.7')).toBe('anthropic/claude-opus-4.7');
    expect(normalizeModelForProvider('shopaikey', 'deepseek/deepseek-reasoner')).toBe('deepseek-reasoner');
    expect(normalizeModelForProvider('shopaikey', 'deepseek/deepseek-v4-pro')).toBe('deepseek-v4-pro');
    expect(normalizeModelForProvider('shopaikey', 'qwen/qwen3.6-35b-a3b')).toBe('qwen3.6-35b-a3b');
    expect(normalizeModelForProvider('openrouter', 'openai/gpt-5.4-mini')).toBe('openai/gpt-5.4-mini');
  });

  it('detects ShopAIKey Gemini vs OpenAI-compatible runtime families', () => {
    expect(isShopAIKeyGeminiModel('gemini-3.1-flash-lite-preview')).toBe(true);
    expect(isShopAIKeyGeminiModel('google/gemini-3.1-pro-preview')).toBe(true);
    expect(isShopAIKeyGeminiModel('gpt-5-nano')).toBe(false);
    expect(isShopAIKeyOpenAIModel('gpt-5-nano')).toBe(true);
    expect(isShopAIKeyOpenAIModel('openai/gpt-5.4-mini')).toBe(true);
    expect(isShopAIKeyOpenAIModel('deepseek-v4-pro')).toBe(true);
    expect(isShopAIKeyOpenAIModel('qwen3.6-plus')).toBe(true);
    expect(isShopAIKeyOpenAIModel('grok-4-20-reasoning')).toBe(true);
    expect(isShopAIKeyOpenAIModel('MiniMax-M2.7')).toBe(true);
    expect(isShopAIKeyOpenAIModel('mimo-v2.5-pro')).toBe(true);
    expect(isShopAIKeyOpenAIResponsesModel('gemini-3.1-flash-lite-preview')).toBe(false);
  });

  it('builds ShopAIKey model groups only from verified API model ids', () => {
    const groups = getShopAIKeyVerifiedModelGroups([
      'openai/gpt-5.4-mini',
      'deepseek-v3.2',
      'not-in-static-list',
      'gpt-5.4-mini',
    ]);
    const values = groups.flatMap(group => group.options.map(option => option.value));

    expect(groups[0].label).toBe('ShopAIKey models đã xác minh từ API');
    expect(values).toEqual(['deepseek-v3.2', 'gpt-5.4-mini', 'not-in-static-list']);
    expect(groups[0].options.find(option => option.value === 'gpt-5.4-mini')?.label).toContain('GPT-5.4 Mini');
    expect(groups[0].options.find(option => option.value === 'not-in-static-list')?.label).toBe('not-in-static-list');
  });

  it('returns token profiles for adaptive batching by model family', () => {
    expect(getModelTokenProfile('google', 'gemini-2.5-flash-lite')).toMatchObject({
      inputLimit: 1048576,
      outputLimit: 65536,
      safeOutputBudget: 15000,
      maxQuestionsPerBatch: 10,
    });
    expect(getModelTokenProfile('openrouter', 'google/gemini-3-flash-preview')).toMatchObject({
      safeOutputBudget: 15000,
      maxQuestionsPerBatch: 10,
    });
    expect(getModelTokenProfile('google', 'gemini-3.1-flash-lite-preview')).toMatchObject({
      safeOutputBudget: 15000,
      maxQuestionsPerBatch: 10,
    });
    expect(getModelTokenProfile('openrouter', '~google/gemini-pro-latest')).toMatchObject({
      safeOutputBudget: 15000,
      maxQuestionsPerBatch: 10,
    });
    expect(getModelTokenProfile('openrouter', 'openai/gpt-5-mini')).toMatchObject({
      inputLimit: 400000,
      outputLimit: 128000,
      safeOutputBudget: 65536,
      maxQuestionsPerBatch: 10,
    });
    expect(getModelTokenProfile('openrouter', '~openai/gpt-latest')).toMatchObject({
      safeOutputBudget: 65536,
      maxQuestionsPerBatch: 10,
    });
    expect(getModelTokenProfile('openrouter', 'x-ai/grok-4.3')).toMatchObject({
      safeOutputBudget: 15000,
      maxQuestionsPerBatch: 10,
    });
    expect(getModelTokenProfile('shopaikey', 'deepseek-v4-pro')).toMatchObject({
      safeOutputBudget: 15000,
      maxQuestionsPerBatch: 10,
    });
    expect(getModelTokenProfile('shopaikey', 'MiniMax-M2.7')).toMatchObject({
      safeOutputBudget: 15000,
      maxQuestionsPerBatch: 10,
    });
    expect(getModelTokenProfile('openrouter', 'custom/vendor-model')).toMatchObject({
      safeOutputBudget: 15000,
      maxQuestionsPerBatch: 10,
    });
  });
});
