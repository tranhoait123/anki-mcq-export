
export interface Explanation {
  core: string;      // Đáp án cốt lõi
  evidence: string;  // Bằng chứng tài liệu
  analysis: string;  // Phân tích sâu
  warning: string;   // Lưu ý
}

export interface MCQ {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: Explanation; // Chuyển từ string sang object cấu trúc
  source: string;
  difficulty: string;
  depthAnalysis: string;
}

export interface GeneratedResponse {
  questions: {
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: Explanation;
    source: string;
    difficulty: string;
    depthAnalysis: string;
  }[];
  duplicates?: DuplicateInfo[];
  failedBatches?: number[];
  failedBatchDetails?: BatchFailureInfo[];
  autoSkippedCount: number;
}

export type BatchFailureKind = 'format' | 'empty' | 'rateLimit' | 'serverBusy' | 'auth' | 'fatal';

export interface BatchFailureInfo {
  index: number;
  label: string;
  kind: BatchFailureKind;
  stage: 'normal' | 'rescue' | 'split';
  message: string;
  advice: string;
}

export interface DuplicateInfo {
  id: string;  // Unique ID for stable restore
  question: string;
  reason: string;
  matchedWith: string;
  score?: number;
  fieldScores?: {
    question: number;
    optionsBySlot: number;
    optionsAsSet: number;
    composite: number;
  };
  // Full question data for restore functionality
  fullData: {
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: Explanation;
    source: string;
    difficulty: string;
    depthAnalysis: string;
  };
  matchedData?: MCQ; // The existing MCQ that it matched with
}

export interface AnalysisResult {
  topic: string;
  estimatedCount: number;
  questionRange: string;
  confidence: string;
}

export interface AuditResult {
  status: 'warning' | 'success';
  missingPercentage: number;
  reasons: string[];
  problematicSections: string[];
  advice: string;
}

export interface UploadedFile {
  id: string; // Unique ID for tracking
  name: string;
  type: string;
  content: string;
  plainText?: string;
  nativeText?: string;
  structuredText?: string;
  nativeMcqCount?: number;
  structuredMcqCount?: number;
  docxImageCount?: number;
  docxImageParts?: {
    name: string;
    mimeType: string;
    content: string;
    index: number;
  }[];
  docxMode?: 'native' | 'structuredFallback' | 'hybrid' | 'textFallback' | 'visionRecommended';
  docxNotice?: string;
  pdfMode?: 'vision' | 'safeHybrid' | 'textOnlyCandidate';
  pdfTextMcqCount?: number;
  pdfTextBatchCount?: number;
  pdfVisionBatchCount?: number;
  pdfNotice?: string;
  size?: number; // Added to fix lint error
  isProcessing?: boolean;
  progress?: number;
}

export type ProgressCallback = (message: string, count: number) => void;
export type BatchCallback = (newQuestions: MCQ[]) => void;
export type ProcessingState = 'running' | 'pausing' | 'paused';
export type ProcessingPhase = 'initial' | 'fallback' | 'rescue' | 'retryFailed';
export type ProcessingSessionStatus = 'idle' | 'running' | 'paused' | 'interrupted' | 'completed' | 'discarded';

export interface ProcessingCheckpoint {
  batchIndex: number;
  totalTopLevelBatches: number;
  completedBatchIndices: number[];
  failedBatchIndices: number[];
  failedBatchDetails: BatchFailureInfo[];
  questionsSnapshot: MCQ[];
  duplicatesSnapshot: DuplicateInfo[];
  autoSkippedCount: number;
  currentCount: number;
}

export interface ProcessingSession {
  id: 'current';
  status: ProcessingSessionStatus;
  phase: ProcessingPhase;
  createdAt: number;
  updatedAt: number;
  filesFingerprint: string;
  forcedOcrMode?: 'gemini' | 'tesseract';
  settingsSnapshot: AppSettings;
  analysisSnapshot: AnalysisResult | null;
  totalTopLevelBatches: number;
  completedBatchIndices: number[];
  failedBatchIndices: number[];
  failedBatchDetails: BatchFailureInfo[];
  duplicatesSnapshot: DuplicateInfo[];
  autoSkippedCount: number;
  currentCount: number;
  resumeRetryIndices?: number[];
  mcqsSnapshot?: MCQ[];
  phaseQuestionsSnapshot?: MCQ[];
  phaseDuplicatesSnapshot?: DuplicateInfo[];
  phaseAutoSkippedCount?: number;
  phaseCurrentCount?: number;
  phaseComparisonBaselineCount?: number;
  phaseComparisonFailedBatchIndices?: number[];
  phaseComparisonFailedBatchDetails?: BatchFailureInfo[];
}

export interface ProcessingController {
  requestPause: () => void;
  resume: () => void;
  getState: () => ProcessingState;
  isPaused: () => boolean;
  isPauseRequested: () => boolean;
  waitIfPaused: () => Promise<void>;
}

export interface AppSettings {
  apiKey: string;
  shopAIKeyKey: string;
  openRouterKey?: string;
  vertexProjectId?: string;
  vertexLocation?: string;
  vertexAccessToken?: string;
  provider: 'google' | 'shopaikey' | 'openrouter' | 'vertexai';
  model: string;
  customPrompt: string;
  skipAnalysis?: boolean;
  concurrencyLimit?: number;
  adaptiveBatching?: boolean;
  batchingMode?: 'safe';
}
