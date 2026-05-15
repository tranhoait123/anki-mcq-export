import { AppSettings, GeneratedResponse, MCQ, ProcessingPhase, ProcessingSessionStatus, UploadedFile } from '../types';
import { coerceModelForProvider, DEFAULT_GEMINI_MODEL, isModelAllowedForProvider } from './models';

type LegacyPersistedSettings = Omit<Partial<AppSettings>, 'provider'> & {
  provider?: AppSettings['provider'] | string;
};

const RETIRED_PROVIDER_PREFIX = 'ver' + 'tex';
const RETIRED_PROVIDER_ID = `${RETIRED_PROVIDER_PREFIX}ai`;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  apiKey: '',
  shopAIKeyKey: '',
  provider: 'google',
  model: 'gemini-3.1-flash-lite-preview',
  customPrompt: '',
  skipAnalysis: true,
  concurrencyLimit: 1,
  adaptiveBatching: true,
  batchingMode: 'safe',
  projectLibraryEnabled: true,
  realtimePreviewEnabled: true,
};

export const isDocxFile = (file?: UploadedFile | null) =>
  !!file && (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || file.name.toLowerCase().endsWith('.docx')
  );

export const getPersistableFiles = (files: UploadedFile[]): UploadedFile[] =>
  files
    .filter((file) => !file.isProcessing && Boolean(file.content))
    .map((file) => ({ ...file, isProcessing: false, progress: 100 }));

export const sortMcqsByQuestionNumber = (items: MCQ[]): MCQ[] => {
  if (items.length <= 1) return [...items];
  const mapped = items.map((item, i) => ({
    index: i,
    value: item,
    sortNum: getQuestionSortNumber(item.question)
  }));
  mapped.sort((a, b) => a.sortNum - b.sortNum || a.index - b.index);
  return mapped.map(el => el.value);
};

export const getQuestionSortNumber = (str: string): number => {
  const match = str.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 999999;
};

export const mergeSortedMcqs = (existing: MCQ[], incoming: MCQ[]): MCQ[] => {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return sortMcqsByQuestionNumber(incoming);

  const sortedIncoming = sortMcqsByQuestionNumber(incoming);
  
  const numCache = new Map<any, number>();
  const getNum = (q: any) => {
    let num = numCache.get(q);
    if (num === undefined) {
      num = getQuestionSortNumber(q.question);
      numCache.set(q, num);
    }
    return num;
  };

  const merged: MCQ[] = [];
  let existingIndex = 0;
  let incomingIndex = 0;

  while (existingIndex < existing.length && incomingIndex < sortedIncoming.length) {
    const existingItem = existing[existingIndex];
    const incomingItem = sortedIncoming[incomingIndex];
    if (getNum(existingItem) <= getNum(incomingItem)) {
      merged.push(existingItem);
      existingIndex++;
    } else {
      merged.push(incomingItem);
      incomingIndex++;
    }
  }

  return [
    ...merged,
    ...existing.slice(existingIndex),
    ...sortedIncoming.slice(incomingIndex),
  ];
};

const normalizeVisibleMcqIdentityPart = (value: unknown): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export const getVisibleMcqIdentity = (mcq: Partial<MCQ>): string => [
  mcq.question,
  ...(Array.isArray(mcq.options) ? mcq.options : []),
  mcq.correctAnswer,
  mcq.source,
].map(normalizeVisibleMcqIdentityPart).join('\u0001');

export const filterUniqueVisibleMcqs = (incoming: MCQ[], existing: MCQ[]): MCQ[] => {
  if (incoming.length === 0) return [];
  const existingIds = new Set(existing.map(item => item.id).filter(Boolean));
  const existingIdentities = new Set(existing.map(getVisibleMcqIdentity).filter(Boolean));
  const unique: MCQ[] = [];

  for (const item of incoming) {
    const identity = getVisibleMcqIdentity(item);
    if ((item.id && existingIds.has(item.id)) || (identity && existingIdentities.has(identity))) continue;
    unique.push(item);
    if (item.id) existingIds.add(item.id);
    if (identity) existingIdentities.add(identity);
  }

  return unique;
};

export const isResumableStatus = (status: ProcessingSessionStatus) =>
  status === 'running' || status === 'paused' || status === 'interrupted';

export const formatSessionPhase = (phase: ProcessingPhase) => {
  if (phase === 'fallback') return 'Fallback OCR';
  if (phase === 'rescue') return 'Tự cứu batch lỗi';
  if (phase === 'retryFailed') return 'Quét lại batch lỗi';
  return 'Trích xuất chính';
};

export const cleanText = (text: string, type: 'question' | 'option') => {
  if (!text) return '';
  let cleaned = text.trim();
  if (type === 'question') {
    cleaned = cleaned.replace(/^(?:Câu|Question|Bài)\s*\d+[:.]\s*/i, '');
    cleaned = cleaned.replace(/^\d+[:.]\s*/, '');
  } else {
    cleaned = cleaned.replace(/^[A-Ea-e][:.)]\s*/, '');
  }
  return cleaned;
};

const normalizeProvider = (provider?: string): AppSettings['provider'] => {
  if (provider === 'shopaikey' || provider === 'openrouter' || provider === 'google') return provider;
  return 'google';
};

export const normalizePersistedSettings = (settings: LegacyPersistedSettings): AppSettings => {
  const wasRetiredProvider = settings.provider === RETIRED_PROVIDER_ID;
  const settingsWithoutRetiredFields = Object.fromEntries(
    Object.entries(settings).filter(([key]) => !key.toLowerCase().startsWith(RETIRED_PROVIDER_PREFIX))
  ) as Partial<AppSettings>;
  const persistedSettings: AppSettings = {
    ...DEFAULT_APP_SETTINGS,
    ...settingsWithoutRetiredFields,
    provider: normalizeProvider(settings.provider),
    model: settings.model || DEFAULT_GEMINI_MODEL,
  };

  if (wasRetiredProvider) {
    persistedSettings.model = DEFAULT_GEMINI_MODEL;
  }

  if (persistedSettings.model?.includes('gemini-1.5')) persistedSettings.model = 'gemini-2.5-flash';
  if (persistedSettings.model === 'gemini-3-flash' || persistedSettings.model === 'gemini-3-flash-preview') persistedSettings.model = 'gemini-3-flash-preview';
  if (persistedSettings.model === 'gemini-3-pro' || persistedSettings.model === 'gemini-3-pro-preview') persistedSettings.model = 'gemini-3.1-pro-preview';
  if (persistedSettings.model === 'gemini-3.1-flash-lite') persistedSettings.model = 'gemini-3.1-flash-lite-preview';

  if (!persistedSettings.model || !isModelAllowedForProvider(persistedSettings.provider, persistedSettings.model)) {
    console.warn('🛡️ Detected missing or provider-incompatible model. Resetting to Gemini 3.1 Flash-Lite.');
    persistedSettings.model = coerceModelForProvider(persistedSettings.provider, persistedSettings.model || DEFAULT_GEMINI_MODEL);
  }

  if (persistedSettings.shopAIKeyKey === undefined) persistedSettings.shopAIKeyKey = '';
  if (persistedSettings.openRouterKey === undefined) persistedSettings.openRouterKey = '';
  if (persistedSettings.skipAnalysis === undefined) persistedSettings.skipAnalysis = true;
  if (persistedSettings.concurrencyLimit === undefined) persistedSettings.concurrencyLimit = 1;
  if (persistedSettings.adaptiveBatching === undefined) persistedSettings.adaptiveBatching = true;
  if (persistedSettings.batchingMode === undefined) persistedSettings.batchingMode = 'safe';
  if (persistedSettings.projectLibraryEnabled === undefined) persistedSettings.projectLibraryEnabled = true;
  if (persistedSettings.realtimePreviewEnabled === undefined) persistedSettings.realtimePreviewEnabled = true;

  return persistedSettings;
};

export const summarizeBatchFailures = (
  details?: GeneratedResponse['failedBatchDetails'],
  failedBatches: number[] = []
) => {
  if (!details || details.length === 0) {
    return `Phần lỗi: ${failedBatches.join(', ')}. Lý do chưa xác định rõ; hãy thử quét lại phần lỗi hoặc đổi model nếu lặp lại.`;
  }

  const labelsByReason: Record<string, string[]> = {};
  for (const detail of details) {
    const label = detail.label || String(detail.index);
    labelsByReason[detail.message] = labelsByReason[detail.message] || [];
    if (!labelsByReason[detail.message].includes(label)) labelsByReason[detail.message].push(label);
  }

  const reasons = Object.entries(labelsByReason)
    .map(([message, labels]) => `${labels.join(', ')}: ${message}`)
    .join(' • ');
  const advice = Array.from(new Set(details.map(detail => detail.advice))).slice(0, 2).join(' ');
  return `${reasons}. ${advice}`;
};
