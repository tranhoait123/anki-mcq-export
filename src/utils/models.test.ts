import { describe, expect, it } from 'vitest';
import {
  getModelGroups,
  getModelValues,
  getProviderFallbackModel,
  coerceModelForProvider,
  coerceModelForProviderInput,
  isVisionCapableModel,
  isModelAllowedForProvider,
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
    expect(values).toContain('gemini-3-flash-preview');
    expect(values).toContain('gemini-2.5-flash-lite');
  });

  it('keeps existing Vertex models and adds newest Gemini models', () => {
    const values = getModelValues('vertexai');

    expect(values).toContain('gemini-2.0-pro-exp-0205');
    expect(values).toContain('gemini-2.0-flash-001');
    expect(values).toContain('gemini-2.0-flash-lite-preview-02-05');
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

  it('keeps existing ShopAIKey models and appends OpenAI-compatible newest models', () => {
    const values = getModelValues('shopaikey');

    expect(values).toContain('o3-pro');
    expect(values).toContain('claude-sonnet-4-20250514');
    expect(values).toContain('deepseek-v3.2');
    expect(values).toContain('gpt-5.4-mini');
    expect(values).toContain('gpt-5.4-nano');
    expect(values).toContain('claude-sonnet-4-6');
    expect(values).toContain('deepseek-reasoner');
    expect(values).not.toContain('openai/gpt-5.4-mini');
    expect(values).not.toContain('anthropic/claude-sonnet-4.6');
  });

  it('renders newest groups first for every provider', () => {
    expect(getModelGroups('google')[0].label).toBe('Mới nhất 2026');
    expect(getModelGroups('shopaikey')[0].label).toBe('Mới nhất 2026');
    expect(getModelGroups('openrouter')[0].label).toBe('Mới nhất 2026');
    expect(getModelGroups('vertexai')[0].label).toBe('Mới nhất 2026');
  });

  it('uses provider-specific fallback models', () => {
    expect(getProviderFallbackModel('google')).toBe('gemini-2.5-flash');
    expect(getProviderFallbackModel('vertexai')).toBe('gemini-2.5-flash');
    expect(getProviderFallbackModel('shopaikey')).toBe('gemini-2.5-flash');
    expect(getProviderFallbackModel('openrouter')).toBe('google/gemini-2.5-flash');
  });

  it('does not reject DeepSeek for OpenRouter while rejecting non-Gemini for Google providers', () => {
    expect(isModelAllowedForProvider('openrouter', 'deepseek/deepseek-chat')).toBe(true);
    expect(isModelAllowedForProvider('shopaikey', 'deepseek/deepseek-v3.2')).toBe(true);
    expect(isModelAllowedForProvider('openrouter', 'custom/vendor-model')).toBe(true);
    expect(isModelAllowedForProvider('google', 'deepseek/deepseek-chat')).toBe(false);
    expect(isModelAllowedForProvider('vertexai', 'openai/gpt-5.4')).toBe(false);
  });

  it('coerces provider-incompatible models before runtime requests', () => {
    expect(coerceModelForProvider('google', 'deepseek/deepseek-v3.2')).toBe('gemini-3.1-flash-lite-preview');
    expect(coerceModelForProvider('vertexai', 'openai/gpt-5.4')).toBe('gemini-3.1-flash-lite-preview');
    expect(coerceModelForProvider('openrouter', 'deepseek/deepseek-v3.2')).toBe('deepseek/deepseek-v3.2');
    expect(coerceModelForProvider('shopaikey', 'deepseek/deepseek-v3.2')).toBe('deepseek-v3.2');
  });

  it('coerces text-only gateway models to vision fallbacks for image or PDF input', () => {
    expect(isVisionCapableModel('openrouter', 'deepseek/deepseek-chat')).toBe(false);
    expect(isVisionCapableModel('shopaikey', 'gpt-5.4-mini')).toBe(true);
    expect(coerceModelForProviderInput('openrouter', 'deepseek/deepseek-chat', true)).toBe('google/gemini-2.5-flash');
    expect(coerceModelForProviderInput('shopaikey', 'deepseek/deepseek-v3.2', true)).toBe('gemini-2.5-flash');
    expect(coerceModelForProviderInput('openrouter', 'deepseek/deepseek-chat', false)).toBe('deepseek/deepseek-chat');
  });

  it('normalizes legacy OpenRouter-style ShopAIKey model ids to official ShopAIKey ids', () => {
    expect(normalizeModelForProvider('shopaikey', 'openai/gpt-5.4-mini')).toBe('gpt-5.4-mini');
    expect(normalizeModelForProvider('shopaikey', 'anthropic/claude-opus-4.7')).toBe('claude-opus-4-7');
    expect(normalizeModelForProvider('shopaikey', 'deepseek/deepseek-reasoner')).toBe('deepseek-reasoner');
    expect(normalizeModelForProvider('openrouter', 'openai/gpt-5.4-mini')).toBe('openai/gpt-5.4-mini');
  });
});
