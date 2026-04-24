import { AppSettings, GeneratedResponse, MCQ, ProcessingPhase, ProcessingSessionStatus, UploadedFile } from '../types';
import { coerceModelForProvider, DEFAULT_GEMINI_MODEL, isModelAllowedForProvider } from './models';

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
  const getNum = (str: string) => {
    const m = str.match(/(\d+)/);
    return m ? parseInt(m[1]) : 999999;
  };
  return [...items].sort((a, b) => getNum(a.question) - getNum(b.question));
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

export const normalizePersistedSettings = (settings: AppSettings): AppSettings => {
  const persistedSettings = { ...settings };

  if (!persistedSettings.provider) persistedSettings.provider = 'google';

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
  if (persistedSettings.vertexProjectId === undefined) persistedSettings.vertexProjectId = '';
  if (persistedSettings.vertexLocation === undefined) persistedSettings.vertexLocation = 'us-central1';
  if (persistedSettings.vertexAccessToken === undefined) persistedSettings.vertexAccessToken = '';
  if (persistedSettings.skipAnalysis === undefined) persistedSettings.skipAnalysis = true;
  if (persistedSettings.concurrencyLimit === undefined) persistedSettings.concurrencyLimit = 1;
  if (persistedSettings.adaptiveBatching === undefined) persistedSettings.adaptiveBatching = true;
  if (persistedSettings.batchingMode === undefined) persistedSettings.batchingMode = 'safe';

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
