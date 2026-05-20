import { describe, expect, it } from 'vitest';
import { cleanText, filterUniqueVisibleMcqs, formatSessionPhase, getPersistableFiles, mergeSortedMcqs, normalizePersistedSettings, sortMcqsByQuestionNumber, summarizeBatchFailures } from './appHelpers';
import { MCQ } from '../types';

const mcq = (question: string): MCQ => ({
  id: question,
  question,
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: 'A',
  explanation: { core: '', evidence: '', analysis: '', warning: '' },
  source: '',
  difficulty: '',
  depthAnalysis: '',
});

describe('app helpers', () => {
  it('keeps question sorting behavior numeric and stable for unnumbered items', () => {
    expect(sortMcqsByQuestionNumber([mcq('Câu 10'), mcq('Câu 2'), mcq('Không số')]).map(item => item.question))
      .toEqual(['Câu 2', 'Câu 10', 'Không số']);
  });

  it('merges incoming sorted MCQs without resorting the existing list from scratch', () => {
    const merged = mergeSortedMcqs(
      [mcq('Câu 1'), mcq('Câu 5'), mcq('Không số')],
      [mcq('Câu 3'), mcq('Câu 2')]
    );

    expect(merged.map(item => item.question)).toEqual(['Câu 1', 'Câu 2', 'Câu 3', 'Câu 5', 'Không số']);
  });

  it('filters visible appends by exact identity without fuzzy duplicate scanning', () => {
    const existing = [mcq('Câu 1: Nội dung đã có')];
    const duplicate = { ...mcq('  câu 1: nội dung đã có  '), id: 'different-stream-id' };
    const fresh = mcq('Câu 2: Nội dung mới');

    expect(filterUniqueVisibleMcqs([duplicate, fresh, fresh], existing).map(item => item.question))
      .toEqual(['Câu 2: Nội dung mới']);
  });

  it('cleans question and option labels for export', () => {
    expect(cleanText('Câu 12: Nội dung', 'question')).toBe('Nội dung');
    expect(cleanText('B. Đáp án', 'option')).toBe('Đáp án');
  });

  it('filters only completed files for persistence', () => {
    expect(getPersistableFiles([
      { id: '1', name: 'ready.txt', type: 'text/plain', content: 'ok', progress: 10 },
      { id: '2', name: 'loading.txt', type: 'text/plain', content: 'ok', isProcessing: true },
      { id: '3', name: 'empty.txt', type: 'text/plain', content: '' },
    ])).toEqual([{ id: '1', name: 'ready.txt', type: 'text/plain', content: 'ok', progress: 100, isProcessing: false }]);
  });

  it('formats processing phases for resume UI', () => {
    expect(formatSessionPhase('initial')).toBe('Trích xuất chính');
    expect(formatSessionPhase('fallback')).toBe('Fallback OCR');
    expect(formatSessionPhase('rescue')).toBe('Tự cứu batch lỗi');
    expect(formatSessionPhase('retryFailed')).toBe('Quét lại batch lỗi');
  });

  it('summarizes batch failures by reason and advice', () => {
    expect(summarizeBatchFailures([
      { index: 1, label: 'Batch 1', kind: 'format', stage: 'normal', message: 'JSON lỗi', advice: 'Thử lại.' },
      { index: 2, label: 'Batch 2', kind: 'format', stage: 'normal', message: 'JSON lỗi', advice: 'Thử lại.' },
    ], [1, 2])).toContain('Batch 1, Batch 2: JSON lỗi');
  });

  it('migrates retired provider settings to Google defaults without keeping retired fields', () => {
    const retiredPrefix = 'ver' + 'tex';
    const retiredProvider = `${retiredPrefix}ai`;
    const legacySettings = {
      provider: retiredProvider,
      model: 'openai/gpt-5.4',
      apiKey: 'google-key',
      shopAIKeyKey: 'shop-key',
      openRouterKey: 'router-key',
      [`${retiredPrefix}ProjectId`]: 'old-project',
      [`${retiredPrefix}Location`]: 'us-central1',
      [`${retiredPrefix}AccessToken`]: 'old-token',
      customPrompt: 'prompt',
    };
    const normalized = normalizePersistedSettings(legacySettings as any);

    expect(normalized.provider).toBe('google');
    expect(normalized.model).toBe('gemini-3.1-flash-lite-preview');
    expect(normalized.projectLibraryEnabled).toBe(true);
    expect('realtimePreviewEnabled' in normalized).toBe(false);
    expect(`${retiredPrefix}ProjectId` in normalized).toBe(false);
    expect(`${retiredPrefix}Location` in normalized).toBe(false);
    expect(`${retiredPrefix}AccessToken` in normalized).toBe(false);
  });

  it('defaults project library on while preserving an explicit off preference', () => {
    expect(normalizePersistedSettings({
      provider: 'google',
      model: 'gemini-3.1-flash-lite-preview',
    }).projectLibraryEnabled).toBe(true);

    expect(normalizePersistedSettings({
      provider: 'google',
      model: 'gemini-3.1-flash-lite-preview',
      projectLibraryEnabled: false,
    }).projectLibraryEnabled).toBe(false);
  });

  it('drops removed realtime preview preference from persisted settings', () => {
    const normalized = normalizePersistedSettings({
      provider: 'google',
      model: 'gemini-3.1-flash-lite-preview',
      realtimePreviewEnabled: false,
    } as any);

    expect('realtimePreviewEnabled' in normalized).toBe(false);
  });

  it('defaults Google RPM guard on and normalizes custom limits', () => {
    expect(normalizePersistedSettings({
      provider: 'google',
      model: 'gemini-3.1-flash-lite-preview',
    })).toMatchObject({
      googleRpmLimiterEnabled: true,
      googleRpmLimitPerMinute: 30,
    });

    expect(normalizePersistedSettings({
      provider: 'google',
      model: 'gemini-3.1-flash-lite-preview',
      googleRpmLimiterEnabled: false,
      googleRpmLimitPerMinute: 30.4,
    })).toMatchObject({
      googleRpmLimiterEnabled: false,
      googleRpmLimitPerMinute: 30,
    });

    expect(normalizePersistedSettings({
      provider: 'google',
      model: 'gemini-3.1-flash-lite-preview',
      googleRpmLimitPerMinute: 9999,
    }).googleRpmLimitPerMinute).toBe(600);
  });
});
