
export interface Explanation {
  core: string;      // Đáp án cốt lõi
  evidence: string;  // Bằng chứng tài liệu
  analysis: string;  // Phân tích sâu
  warning: string;   // Lưu ý
}

export interface SourceTrace {
  fileId?: string;
  fileName: string;
  sourceLabel: string;
  pageRange?: {
    start: number;
    end: number;
  };
  batchIndex?: number;
  questionNumber?: number;
  expectedQuestionNumbers?: number[];
  boundaryRisk?: {
    severity: 'none' | 'low' | 'medium' | 'high';
    reasons: string[];
    pageNumbers: number[];
    suggestedRange?: {
      start: number;
      end: number;
    };
    message?: string;
  };
  snippet?: string;
  mode: 'pdfText' | 'pdfVision' | 'docxText' | 'docxImage' | 'image' | 'text' | 'unknown';
}

export interface SharedCaseMetadata {
  applied: boolean;
  confidence: 'explicit';
  stem: string;
  startQuestion: number;
  endQuestion: number;
  sourceLabel?: string;
  pageRange?: {
    start: number;
    end: number;
  };
}

export interface MCQ {
  id: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: Explanation; // Chuyển từ string sang object cấu trúc
  source: string;
  trace?: SourceTrace;
  sharedCase?: SharedCaseMetadata;
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
    sharedCase?: SharedCaseMetadata;
    difficulty: string;
    depthAnalysis: string;
  }[];
  duplicates?: DuplicateInfo[];
  failedBatches?: number[];
  failedBatchDetails?: BatchFailureInfo[];
  autoSkippedCount: number;
}

export type BatchFailureKind = 'format' | 'empty' | 'rateLimit' | 'serverBusy' | 'auth' | 'fatal';

export interface BatchFailureKeyHealth {
  keyNumber: number;
  status: string;
  remainingMs: number;
  inFlightCount: number;
  failureCount: number;
  successCount: number;
  lastError?: string;
}

export interface BatchFailureDiagnostics {
  attempts?: number;
  distinctKeysTried?: number;
  maxKeysPerOperation?: number;
  lastKeyNumber?: number;
  modelName?: string;
  providerStatus?: number;
  retryAfterMs?: number;
  keyHealth?: BatchFailureKeyHealth[];
}

export interface BatchFailureInfo {
  index: number;
  label: string;
  kind: BatchFailureKind;
  stage: 'normal' | 'rescue' | 'split' | 'partial' | 'deferred';
  message: string;
  advice: string;
  missingCount?: number;
  recoveredCount?: number;
  partialRawCount?: number;
  partialAddedCount?: number;
  partialDuplicateCount?: number;
  partialAutoSkippedCount?: number;
  partialUnchangedCount?: number;
  expectedQuestions?: number;
  coverageStatus?: 'complete' | 'missing' | 'unverified' | 'notApplicable';
  coverageConfidence?: 'none' | 'low' | 'medium' | 'high' | 'exact';
  verifiedExpectedCount?: number;
  validCoveredCount?: number;
  tailComplete?: boolean;
  diagnostics?: BatchFailureDiagnostics;
}

export interface DuplicateInfo {
  id: string;  // Unique ID for stable restore
  question: string;
  reason: string;
  matchedWith: string;
  score?: number;
  fieldScores?: {
    question: number;
    questionTokenSort?: number;
    questionPartial?: number;
    optionsBySlot: number;
    optionsAsSet: number;
    composite: number;
    intentMismatch?: boolean;
    intentReviewRequired?: boolean;
    objectiveTail?: number | null;
    sharedClinicalStem?: number | null;
    clinicalObjectiveMismatch?: boolean;
  };
  evidence?: {
    decisionLabel: string;
    riskFlags: string[];
    answerConflict: boolean;
    sameQuestionNumber: boolean;
    optionsScore: number;
    optionSignatureMatch: boolean;
  };
  // Full question data for restore functionality
  fullData: {
    question: string;
    options: string[];
    correctAnswer: string;
    explanation: Explanation;
    source: string;
    trace?: SourceTrace;
    sharedCase?: SharedCaseMetadata;
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
  contentHash?: string;
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
  snapshotKind?: 'metadata' | 'full';
  questionsSnapshot?: MCQ[];
  duplicatesSnapshot?: DuplicateInfo[];
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
  shopAIKeyEndpoint?: 'direct' | 'api';
  shopAIKeyOpenAIRoute?: 'chat' | 'responses';
  openRouterKey?: string;
  provider: 'google' | 'shopaikey' | 'openrouter';
  model: string;
  customPrompt: string;
  skipAnalysis?: boolean;
  concurrencyLimit?: number;
  adaptiveBatching?: boolean;
  batchingMode?: 'safe';
  projectLibraryEnabled?: boolean;
  mainBatchOnlyRescue?: boolean;
  visionPagesPerBatch?: number;
  autoGroupClinicalCases?: boolean;
  googleRpmLimiterEnabled?: boolean;
  googleRpmLimitPerMinute?: number;
  pdfVisionQuality?: 'standard' | 'high';
  enableContextCaching?: boolean;
}

export interface ProjectSettingsSummary {
  provider: AppSettings['provider'];
  model: string;
  shopAIKeyEndpoint?: AppSettings['shopAIKeyEndpoint'];
  shopAIKeyOpenAIRoute?: AppSettings['shopAIKeyOpenAIRoute'];
  skipAnalysis?: boolean;
  concurrencyLimit?: number;
  adaptiveBatching?: boolean;
  projectLibraryEnabled?: boolean;
  mainBatchOnlyRescue?: boolean;
  visionPagesPerBatch?: number;
  autoGroupClinicalCases?: boolean;
  googleRpmLimiterEnabled?: boolean;
  googleRpmLimitPerMinute?: number;
  pdfVisionQuality?: AppSettings['pdfVisionQuality'];
  enableContextCaching?: boolean;
  hasCustomPrompt: boolean;
}

export interface ProjectStats {
  questionCount: number;
  duplicateCount: number;
  fileCount: number;
  estimatedCount?: number;
  difficultyCounts: Record<string, number>;
}

export interface StudyProject {
  id: string;
  name: string;
  filesFingerprint: string;
  createdAt: number;
  updatedAt: number;
  files: UploadedFile[];
  mcqs: MCQ[];
  duplicates: DuplicateInfo[];
  analysis: AnalysisResult | null;
  settingsSummary: ProjectSettingsSummary;
  stats: ProjectStats;
}

export type StudyProjectSummary = Pick<
  StudyProject,
  'id' | 'name' | 'filesFingerprint' | 'createdAt' | 'updatedAt' | 'settingsSummary' | 'stats'
>;

export interface ProjectComparisonItem {
  id: string;
  question: string;
  source?: string;
}

export interface ProjectChangedAnswerItem {
  id: string;
  question: string;
  previousAnswer: string;
  currentAnswer: string;
}

export interface ProjectLikelyDuplicateItem {
  id: string;
  question: string;
  matchedWith: string;
  score?: number;
}

export interface ProjectComparison {
  added: ProjectComparisonItem[];
  removed: ProjectComparisonItem[];
  changedAnswers: ProjectChangedAnswerItem[];
  likelyDuplicates: ProjectLikelyDuplicateItem[];
  skippedLikelyDuplicateScan?: boolean;
}
