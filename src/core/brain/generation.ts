import { UploadedFile, ProgressCallback, BatchCallback, AppSettings, MCQ, DuplicateInfo, BatchFailureInfo, BatchFailureDiagnostics, SourceTrace } from "../../types";
import { coerceModelForProvider, coerceModelForProviderInput, getModelTokenProfile, getProviderFallbackModel, getProviderModelMismatchMessage, isShopAIKeyDeepSeekModel } from '../../utils/models';
import { analyzePdfTextLayer, convertPdfToImages, estimatePdfQuestionMarkers, splitPdfRangeForVisionRecovery, type PdfQuestionMarkerEstimate, type PdfVisionRecoveryDirection } from '../../utils/pdfProcessor';
import {
  classifyBatchError,
  describeBatchError,
  getRetryDecision,
  getRetryProfile,
  shouldSplitForError,
  splitTextIntoNaturalParts,
} from '../../utils/retryStrategy';
import { splitNativeMcqTextIntoBatches } from '../docxNative';
import {
  buildSourceSnippet,
  formatPageRangeLabel,
  getAdaptiveTextCharBudget,
  getAdaptiveVisionPagesPerChunk,
  buildPartialSalvageRecoveryParts,
  getFileTextContent,
  getNativeBatchExpectedCount,
  getNativePartBatches,
  getStructuredQuestionBatchSize,
  getTrustedSourceLabel,
  inferCompletedBatchIndicesFromExistingQuestions,
  joinSourceLabel,
  splitStructuredPartByBatchSize,
} from './batching';
import { BatchPostprocessInput, BatchPostprocessResult } from './batchPostprocess';
import { createBatchPostprocessor } from './batchPostprocessor';
import {
  translateErrorForUser,
} from './providerErrors';
import {
  callOpenAICompatibleProvider,
  getOpenAICompatibleRuntimeApiKeys,
  isOpenAICompatibleRuntime,
  toOpenAIContentFromPart,
} from './openAiProvider';
import {
  buildGoogleBatchMessage,
  createGoogleGenAIClient,
  getGoogleRuntimeApiKeys,
  getGoogleRuntimeBaseUrl,
  getPdfVisionCoverageSchema,
  getModelConfig,
  getQuestionSchema,
} from './googleProvider';
import {
  executeWithUserRotation,
  userKeyRotator,
} from './retryExecutor';
import { db } from '../db';
import {
  getPdfPageCount,
  getPdfPageRanges,
  splitPdfByRanges,
} from './pdfChunking';
import {
  getOrSetContextCache,
  hashApiKey,
  resetContextCacheSession,
} from './contextCache';
import {
  getGoogleRequestRateLimitOptions,
  isGoogleRpmLimiterEnabled,
} from './requestRateLimiter';
import {
  extractQuestionNumber,
  GenerateQuestionsOptions,
  partsRequireVision,
  waitWithController,
} from './generationHelpers';
import { SYSTEM_INSTRUCTION_EXTRACT, SYSTEM_INSTRUCTION_RESCUE } from './prompts';
import { measureSync } from '../../utils/performance';
import { buildMCQFingerprint } from '../../utils/dedupe';
import { parseJsonFromModelText } from './parsing';

const FULL_CHECKPOINT_INTERVAL_MS = 30000;
const KEY_CONSERVATION_PRESSURE_WINDOW_MS = 60 * 1000;
const MAX_IMMEDIATE_RECOVERY_PARTS = 3;
const DEFERRED_RECOVERY_MIN_SETTLE_MS = 1000;
const DEFERRED_RECOVERY_MAX_RETRIES = 2;

const hasInlineVisionInput = (part: any): boolean =>
  Boolean(part?.inlineData) || (Array.isArray(part?.inlineDataParts) && part.inlineDataParts.length > 0);

const getShopAIKeyDeepSeekTextOnlyError = (labels: string[]): Error => {
  const sample = labels.slice(0, 5).join(', ');
  const suffix = sample ? ` Batch chưa có text/OCR: ${sample}.` : '';
  return new Error(`SHOPAIKEY_DEEPSEEK_VISION_GROUP_UNSUPPORTED: DeepSeek ShopAIKey nằm trong group Cheap API nên app không gửi ảnh/PDF scan thô để tránh gateway route sang group Gemini.${suffix} Hãy dùng file text/OCR hoặc chọn model vision khác.`);
};

export const prepareShopAIKeyDeepSeekTextOnlyParts = (parts: any[]): any[] => {
  const missingTextLabels: string[] = [];
  const nextParts = parts.map((part, index) => {
    if (!hasInlineVisionInput(part)) return part;
    const text = typeof part?.text === 'string' ? part.text.trim() : '';
    if (!text) {
      missingTextLabels.push(part?.sourceLabel || `Batch ${index + 1}`);
      return part;
    }
    return {
      ...part,
      inlineData: undefined,
      inlineDataParts: undefined,
      sourceMode: part.sourceMode === 'pdfVision' ? 'pdfText' : part.sourceMode,
      shopAIKeyDeepSeekTextOnly: true,
    };
  });

  if (missingTextLabels.length > 0) {
    throw getShopAIKeyDeepSeekTextOnlyError(missingTextLabels);
  }
  return nextParts;
};

const getNowMs = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

export const getRecoveredMissingQuestionCount = (
  beforeBatchCount: number,
  afterBatchCount: number,
  missingCount: number
): number => Math.min(Math.max(0, missingCount), Math.max(0, afterBatchCount - beforeBatchCount));

export const buildCompletedBatchSnapshot = <Question, Duplicate>(
  existingQuestions: Question[] = [],
  existingDuplicates: Duplicate[] = [],
  existingAutoSkippedCount = 0,
  batchQuestions: Map<number, Question[]>,
  batchDuplicates: Map<number, Duplicate[]>,
  batchAutoSkipped: Map<number, number>,
  completedBatchNumbers: number[]
) => {
  const questionList = [...existingQuestions];
  const duplicateList = [...existingDuplicates];
  let safeAutoSkippedCount = existingAutoSkippedCount;
  const existingQuestionIndexById = new Map<string, number>();
  questionList.forEach((question, index) => {
    const id = (question as any)?.id;
    if (id && !existingQuestionIndexById.has(id)) existingQuestionIndexById.set(id, index);
  });
  const upsertQuestion = (question: Question) => {
    const id = (question as any)?.id;
    const existingIndex = id ? existingQuestionIndexById.get(id) : undefined;
    if (existingIndex !== undefined) {
      questionList[existingIndex] = question;
      return;
    }
    questionList.push(question);
  };

  completedBatchNumbers
    .slice()
    .sort((a, b) => a - b)
    .forEach((batchNumber) => {
      (batchQuestions.get(batchNumber) || []).forEach(upsertQuestion);
      duplicateList.push(...(batchDuplicates.get(batchNumber) || []));
      safeAutoSkippedCount += batchAutoSkipped.get(batchNumber) || 0;
    });

  return {
    questionsSnapshot: questionList,
    duplicatesSnapshot: duplicateList,
    autoSkippedCount: safeAutoSkippedCount,
  };
};

export const splitRecoveryPartsForImmediateRun = <T,>(
  recoveryParts: T[],
  immediateLimit: number
): { immediateParts: T[]; deferredParts: T[] } => {
  const limit = Math.max(0, Math.min(Math.floor(immediateLimit), recoveryParts.length));
  return {
    immediateParts: recoveryParts.slice(0, limit),
    deferredParts: recoveryParts.slice(limit),
  };
};

export type RecoveryEligibility = 'strong' | 'medium' | 'weak';

export interface RecoveryPolicy {
  allowEmpty: boolean;
  eligibility: RecoveryEligibility;
  expectedCountReliable: boolean;
  maxRecoveryRequests: number;
  reason: string;
  shouldRecoverMissing: boolean;
  shouldSplitEmpty: boolean;
}

const OPTION_MARKER_PATTERN = /(?:^|\n)\s*(?:[A-Ha-h]|[①-⑧])[\).:\-]\s+\S/g;
export type PdfVisionCoverageStatus = 'complete' | 'missing' | 'unverified' | 'notApplicable';

export interface PdfVisionCoverageAssessment {
  status: PdfVisionCoverageStatus;
  confidence: 'none' | 'low' | 'medium' | 'high' | 'exact';
  expectedCount: number;
  validCoveredCount: number;
  tailComplete?: boolean;
  missingLikely?: boolean;
  reason: string;
  coveredQuestionNumbers: number[];
}

export interface RescueEfficiencyStats {
  rawCount: number;
  addedCount: number;
  duplicateCount: number;
  autoSkippedCount: number;
  unchangedCount: number;
}

type ExpectedQuestionEvidence = {
  confidence: 'none' | 'low' | 'medium' | 'high' | 'exact';
  count: number;
  numbers?: number[];
  reliable: boolean;
  reason: string;
  source: 'structured-blocks' | 'pdf-text-layer-markers' | 'none';
};

export const countOptionMarkersForRecoveryEvidence = (text: string = ''): number => (
  String(text || '').match(OPTION_MARKER_PATTERN)?.length || 0
);

const isUsablePdfMarkerEstimate = (estimate?: Pick<PdfQuestionMarkerEstimate, 'confidence' | 'count'> | null): boolean =>
  Boolean(estimate && estimate.count > 0 && (estimate.confidence === 'medium' || estimate.confidence === 'high'));

const buildPdfMarkerExpectedEvidence = (estimate?: PdfQuestionMarkerEstimate | null): ExpectedQuestionEvidence => ({
  confidence: estimate?.confidence || 'none',
  count: estimate?.count || 0,
  numbers: estimate?.numbers || [],
  reliable: false,
  reason: estimate?.reason || 'Không có text-layer marker đủ tin để ước lượng số câu.',
  source: estimate && estimate.count > 0 ? 'pdf-text-layer-markers' : 'none',
});

const buildStructuredExpectedEvidence = (count: number, reason = 'Số câu lấy từ block structured đã tách sẵn.'): ExpectedQuestionEvidence => ({
  confidence: count > 0 ? 'exact' : 'none',
  count: Math.max(0, count),
  numbers: [],
  reliable: count > 0,
  reason,
  source: count > 0 ? 'structured-blocks' : 'none',
});

export const isDuplicateHeavyRescue = (
  stats: RescueEfficiencyStats,
  threshold = 0.9
): boolean => {
  const rawCount = Math.max(0, Number(stats.rawCount || 0));
  if (rawCount <= 0) return false;
  if (Math.max(0, Number(stats.addedCount || 0)) > 0) return false;
  const nonProductiveCount = Math.max(0, Number(stats.duplicateCount || 0)) +
    Math.max(0, Number(stats.autoSkippedCount || 0)) +
    Math.max(0, Number(stats.unchangedCount || 0));
  return nonProductiveCount / rawCount >= threshold;
};

const normalizeCoverageSourceLabel = (value: string = ''): string =>
  String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

const normalizeCoverageAnswer = (value: string = ''): string =>
  String(value || '').trim().match(/^[A-E]/i)?.[0]?.toUpperCase() || String(value || '').trim();

const getCoverageQuestionNumber = (question: Partial<MCQ>): number | null => {
  const traceNumber = Number(question.trace?.questionNumber);
  if (Number.isFinite(traceNumber) && traceNumber > 0) return Math.floor(traceNumber);
  return extractQuestionNumber(question.question || '');
};

const isRangeWithin = (
  child?: { start: number; end: number },
  parent?: { start: number; end: number }
): boolean => {
  if (!child || !parent) return false;
  return child.start >= parent.start && child.end <= parent.end;
};

const isQuestionInCoverageScope = (question: Partial<MCQ>, part: any): boolean => {
  const partFileId = String(part?.trace?.fileId || '').trim();
  const questionFileId = String(question.trace?.fileId || '').trim();
  if (partFileId && questionFileId && partFileId !== questionFileId) return false;

  const trustedSource = normalizeCoverageSourceLabel(getTrustedSourceLabel(part));
  const questionSource = normalizeCoverageSourceLabel(question.source || question.trace?.sourceLabel || '');
  if (trustedSource && questionSource === trustedSource) return true;

  if (part?.sourceMode !== 'pdfVision') return false;
  const partFileName = normalizeCoverageSourceLabel(part?.trace?.fileName || part?.pdfFileName || '');
  const questionFileName = normalizeCoverageSourceLabel(question.trace?.fileName || '');
  return Boolean(
    partFileName &&
    questionFileName === partFileName &&
    isRangeWithin(question.trace?.pageRange, part.trace?.pageRange)
  );
};

const isValidCoveredMcq = (question: Partial<MCQ>, part: any): boolean => {
  if (!isQuestionInCoverageScope(question, part)) return false;

  const questionText = String(question.question || '').replace(/\s+/g, ' ').trim();
  const options = Array.isArray(question.options) ? question.options.filter(option => String(option || '').trim()) : [];
  const answer = normalizeCoverageAnswer(question.correctAnswer || '');
  if (questionText.length < 8) return false;
  if (/[,:;(\[{]\s*$/.test(questionText)) return false;
  if (options.length < 2) return false;
  if (!answer) return false;
  return true;
};

const buildCoverageIdentity = (question: Partial<MCQ>): string => {
  const questionNumber = getCoverageQuestionNumber(question);
  const fileName = question.trace?.fileName || '';
  if (questionNumber && fileName) return `qnum:${fileName.toLowerCase()}:${questionNumber}`;
  return `fp:${buildMCQFingerprint(question)}`;
};

export const evaluatePdfVisionCoverage = (
  part: any,
  questions: MCQ[],
  verifier?: Partial<Pick<PdfVisionCoverageAssessment, 'expectedCount' | 'tailComplete' | 'confidence' | 'missingLikely' | 'reason'> & { questionNumbers?: number[] }>
): PdfVisionCoverageAssessment => {
  if (part?.sourceMode !== 'pdfVision') {
    return {
      status: 'notApplicable',
      confidence: 'none',
      expectedCount: 0,
      validCoveredCount: 0,
      reason: 'Không phải PDF Vision batch.',
      coveredQuestionNumbers: [],
    };
  }

  const coverageKeys = new Set<string>();
  const coveredNumbers = new Set<number>();
  questions.forEach((question) => {
    if (!isValidCoveredMcq(question, part)) return;
    coverageKeys.add(buildCoverageIdentity(question));
    const questionNumber = getCoverageQuestionNumber(question);
    if (questionNumber) coveredNumbers.add(questionNumber);
  });

  const validCoveredCount = coverageKeys.size;
  const coveredQuestionNumbers = Array.from(coveredNumbers).sort((a, b) => a - b);
  const evidence = part?.expectedQuestionEvidence;
  const evidenceConfidence = String(evidence?.confidence || 'none') as PdfVisionCoverageAssessment['confidence'];
  const evidenceNumbers = Array.isArray(evidence?.numbers)
    ? evidence.numbers.filter((value: number) => Number.isFinite(value) && value > 0)
    : [];
  const evidenceCount = Number(evidence?.count || part?.expectedQuestions || 0);
  const evidenceUsable = evidenceCount > 0 && (evidenceConfidence === 'medium' || evidenceConfidence === 'high' || evidenceConfidence === 'exact');

  if (evidenceUsable) {
    const hasAllExpectedNumbers = evidenceNumbers.length === 0 || evidenceNumbers.every((number: number) => coveredNumbers.has(number));
    const complete = validCoveredCount >= evidenceCount && hasAllExpectedNumbers;
    return {
      status: complete ? 'complete' : 'missing',
      confidence: evidenceConfidence === 'exact' ? 'exact' : 'high',
      expectedCount: evidenceCount,
      validCoveredCount,
      tailComplete: complete,
      missingLikely: !complete,
      reason: complete
        ? 'Local text-layer/advisory evidence đã được phủ đủ bởi câu hợp lệ hiện có.'
        : 'Local text-layer/advisory evidence vẫn còn thiếu câu hợp lệ.',
      coveredQuestionNumbers,
    };
  }

  const verifiedExpectedCount = Math.max(0, Math.floor(Number(verifier?.expectedCount || 0)));
  const verifierConfidence = (verifier?.confidence || 'none') as PdfVisionCoverageAssessment['confidence'];
  if (verifiedExpectedCount > 0) {
    const verifierNumbers = Array.isArray((verifier as any)?.questionNumbers)
      ? (verifier as any).questionNumbers.filter((value: number) => Number.isFinite(value) && value > 0)
      : [];
    const hasAllVerifierNumbers = verifierNumbers.length === 0 || verifierNumbers.every((number: number) => coveredNumbers.has(number));
    const verifiedTailComplete = verifier?.tailComplete === true;
    const verifiedMissingLikely = verifier?.missingLikely === true;
    const verifierReason = verifier?.reason || '';
    const complete = verifierConfidence === 'high' &&
      verifiedTailComplete &&
      !verifiedMissingLikely &&
      validCoveredCount >= verifiedExpectedCount &&
      hasAllVerifierNumbers;
    return {
      status: complete ? 'complete' : (verifiedMissingLikely || validCoveredCount < verifiedExpectedCount || !hasAllVerifierNumbers ? 'missing' : 'unverified'),
      confidence: verifierConfidence,
      expectedCount: verifiedExpectedCount,
      validCoveredCount,
      tailComplete: verifiedTailComplete,
      missingLikely: verifiedMissingLikely,
      reason: verifierReason || (complete ? 'AI verifier xác nhận đủ coverage.' : 'AI verifier chưa xác nhận đủ coverage hoặc thiếu số câu verifier thấy.'),
      coveredQuestionNumbers,
    };
  }

  return {
    status: 'unverified',
    confidence: 'none',
    expectedCount: 0,
    validCoveredCount,
    reason: validCoveredCount > 0
      ? 'Có câu đã salvage nhưng chưa có expected count đáng tin để xác minh đủ.'
      : 'Chưa có câu hợp lệ nào để xác minh coverage.',
    coveredQuestionNumbers,
  };
};

export const shouldPreferTailFirstPdfVisionRetry = (
  part: any,
  assessment: PdfVisionCoverageAssessment,
  expectedQuestionsReliable = false
): boolean => Boolean(
  part?.sourceMode === 'pdfVision' &&
  part?.pdfDataUrl &&
  part?.trace?.pageRange &&
  !part?.partialRecovery &&
  !part?.deferredRecovery &&
  !expectedQuestionsReliable &&
  assessment.validCoveredCount > 0 &&
  assessment.status !== 'complete'
);

export const isGoogleKeyConservationActive = (
  provider: AppSettings['provider'],
  hasRecentProviderPressure: boolean
): boolean => provider === 'google' && hasRecentProviderPressure;

export const shouldHoldDeferredRecoveryForPressure = (
  provider: AppSettings['provider'],
  hasRecentProviderPressure: boolean,
  deferredRecoveryCount: number
): boolean => provider === 'google' && hasRecentProviderPressure && deferredRecoveryCount > 0;

export const getRecoveryPolicyForPart = (
  part: any,
  expectedQuestions: number = 0,
  mainBatchOnlyRescue: boolean = false
): RecoveryPolicy => {
  const text = String(part?.text || '');
  const isVision = part?.sourceMode === 'pdfVision';
  const isSuspect = Boolean(part?.textLayerSuspect);
  const nativeExpectedCount = isVision ? 0 : getNativeBatchExpectedCount(text);
  const expectedCount = Math.max(0, Number(expectedQuestions || part?.expectedQuestions || nativeExpectedCount || 0));
  const markerEstimate = isSuspect
    ? null
    : part?.expectedQuestionEvidence?.source === 'pdf-text-layer-markers'
    ? { confidence: part.expectedQuestionEvidence.confidence, count: part.expectedQuestionEvidence.count }
    : estimatePdfQuestionMarkers(text);
  const optionMarkerCount = isSuspect ? 0 : countOptionMarkersForRecoveryEvidence(text);
  const hasStructuredEvidence = expectedCount > 0 && (
    Boolean(part?.nativeMcqBatch) ||
    Boolean(part?.structuredMcqBatch) ||
    part?.sourceMode === 'pdfText' ||
    nativeExpectedCount > 0
  );

  if (mainBatchOnlyRescue) {
    return {
      allowEmpty: true,
      eligibility: 'weak',
      expectedCountReliable: hasStructuredEvidence,
      maxRecoveryRequests: 0,
      reason: 'main-batch-only-enforced',
      shouldRecoverMissing: false,
      shouldSplitEmpty: false,
    };
  }

  if (hasStructuredEvidence) {
    return {
      allowEmpty: false,
      eligibility: 'strong',
      expectedCountReliable: true,
      maxRecoveryRequests: 3,
      reason: 'structured-count',
      shouldRecoverMissing: true,
      shouldSplitEmpty: true,
    };
  }

  if (part?.sourceMode === 'pdfVision') {
    const hasMediumEvidence = (expectedCount > 0 && isUsablePdfMarkerEstimate(markerEstimate)) ||
      (!isSuspect && (
        isUsablePdfMarkerEstimate(markerEstimate) ||
        optionMarkerCount >= 3
      ));
    if (hasMediumEvidence) {
      return {
        allowEmpty: false,
        eligibility: 'medium',
        expectedCountReliable: false,
        maxRecoveryRequests: 1,
        reason: 'pdf-vision-marker',
        shouldRecoverMissing: true,
        shouldSplitEmpty: true,
      };
    }
  }

  return {
    allowEmpty: true,
    eligibility: 'weak',
    expectedCountReliable: false,
    maxRecoveryRequests: 0,
    reason: expectedCount <= 0 ? 'no-expected-count-or-marker' : 'weak-local-evidence',
    shouldRecoverMissing: false,
    shouldSplitEmpty: false,
  };
};

export const generateQuestions = async (
  files: UploadedFile[],
  settings: AppSettings,
  _limit: number = 0,
  onProgress?: ProgressCallback,
  _expectedCount: number = 0,
  onBatchComplete?: BatchCallback,
  retryIndices?: number[],
  isAdvancedMode: boolean = false,
  options: GenerateQuestionsOptions = {}
): Promise<{ questions: MCQ[], duplicates: DuplicateInfo[], failedBatches: number[], failedBatchDetails: BatchFailureInfo[], autoSkippedCount: number }> => {
  let batchPostprocessor: ReturnType<typeof createBatchPostprocessor> | null = null;
  try {
    const mismatchMessage = getProviderModelMismatchMessage(settings.provider, settings.model);
    let runtimeSettings = mismatchMessage ? { ...settings, model: coerceModelForProvider(settings.provider, settings.model) } : settings;
    const providerSafeModel = coerceModelForProvider(runtimeSettings.provider, runtimeSettings.model);
    if (providerSafeModel !== runtimeSettings.model) runtimeSettings = { ...runtimeSettings, model: providerSafeModel };
    const retryProfile = getRetryProfile(options.retryProfile || (isAdvancedMode ? 'rescue' : 'normal'));
    const isRescueMode = retryProfile.name === 'rescue';
    const controller = options.controller;
    const requestedConcurrency = Math.max(1, runtimeSettings.concurrencyLimit || 1);
    
    userKeyRotator.init(
      isOpenAICompatibleRuntime(runtimeSettings)
        ? getOpenAICompatibleRuntimeApiKeys(runtimeSettings)
        : getGoogleRuntimeApiKeys(runtimeSettings),
      requestedConcurrency
    );
    
    // Tải trạng thái sức khỏe key từ DB sau khi init để không bị resetState làm mất dữ liệu
    const savedHealth = await db.getKeyHealth();
    if (savedHealth) userKeyRotator.importHealthState(savedHealth);
    const adaptiveBatching = runtimeSettings.adaptiveBatching !== false;
    const tokenProfile = getModelTokenProfile(runtimeSettings.provider, runtimeSettings.model);
    let adaptiveQuestionCap = getStructuredQuestionBatchSize(tokenProfile, adaptiveBatching);
    let adaptiveLargeBatchFailures = 0;
    const visionPagesPerChunk = runtimeSettings.visionPagesPerBatch || getAdaptiveVisionPagesPerChunk(tokenProfile, adaptiveBatching);
    const textCharBudget = getAdaptiveTextCharBudget(tokenProfile, adaptiveBatching);
    // Reset session-level caching flag cho mỗi phiên mới
    resetContextCacheSession();
    // Note: Mỗi batch tự tạo GoogleGenAI instance riêng trong processBatch/executeWithUserRotation
    // Không cần tạo `ai` ở đây cho Google provider (dead code đã bị xóa)

    // --- STEP 1: PRE-PROCESS & NORMALIZE ---
    let allParts: any[] = [];
    const sessionCache: Record<string, Promise<string | null>> = {};

    if (onProgress) onProgress("Đang tính toán số lượng Batch và chuẩn bị quét dữ liệu...", 0);

    // [Step 1: Splitting Logic]
    const buildTrace = (
      file: UploadedFile,
      sourceLabel: string,
      mode: SourceTrace['mode'],
      extras: Partial<SourceTrace> = {},
      textForSnippet = ''
    ): SourceTrace => ({
      fileId: file.id,
      fileName: file.name,
      sourceLabel,
      mode,
      ...extras,
      snippet: extras.snippet || buildSourceSnippet(textForSnippet),
    });

    for (const file of files) {
      await controller?.waitIfPaused();

      if (file.type === 'application/pdf') {
        const rawBase64 = file.content.includes(',') ? file.content.split(',')[1] : file.content;
        const pdfDataUrl = file.content.startsWith('data:') ? file.content : `data:application/pdf;base64,${file.content}`;
        try {
          if (onProgress) onProgress(`Đang kiểm tra text layer PDF "${file.name}"...`, 0);
          const pdfTextAnalysis = await analyzePdfTextLayer(
            pdfDataUrl,
            visionPagesPerChunk,
            1,
            adaptiveQuestionCap,
            runtimeSettings.autoGroupClinicalCases !== false
          );
          if (pdfTextAnalysis.textBatches.length > 0) {
            pdfTextAnalysis.textBatches.forEach((batch, batchIndex) => {
              const sourceLabel = joinSourceLabel(file.name, formatPageRangeLabel(batch.pageRange), `Nhóm ${batchIndex + 1}`);
              const text = `[TÀI LIỆU PDF TEXT STRUCTURED: "${file.name}" (Trang ${batch.pageRange.start}-${batch.pageRange.end}, Nhóm ${batchIndex + 1}/${pdfTextAnalysis.textBatches.length})]\n\n${batch.text}`;
              allParts.push({
                text,
                nativeMcqBatch: true,
                structuredMcqBatch: true,
                sourceMode: 'pdfText',
                sourceLabel,
                trace: buildTrace(file, sourceLabel, 'pdfText', { pageRange: batch.pageRange, batchIndex: batchIndex + 1 }, text),
                expectedQuestionEvidence: buildStructuredExpectedEvidence(batch.expectedQuestions, 'PDF text layer đã được tách thành block MCQ structured.'),
                expectedQuestionsReliable: true,
                expectedQuestions: batch.expectedQuestions,
              });
            });
          }

          const visionRanges = pdfTextAnalysis.visionPageRanges;
          if (visionRanges.length > 0) {
            if (onProgress) onProgress(`PDF hybrid: ${pdfTextAnalysis.textBatches.length} batch text, ${visionRanges.length} batch Vision.`, 0);
            if (isOpenAICompatibleRuntime(runtimeSettings)) {
              for (const range of visionRanges) {
                const images = await convertPdfToImages(pdfDataUrl, range, { quality: runtimeSettings.pdfVisionQuality ?? 'high' });
                const sourceLabel = joinSourceLabel(file.name, formatPageRangeLabel(range));
                const rangePages = pdfTextAnalysis.pages.slice(range.start - 1, range.end);
                const rangeText = rangePages.map((page) => page.text).join('\n\n');
                
                const allPagesGoodText = rangePages.length > 0 && rangePages.every((page) => page.quality === 'goodText');
                const markerEstimate = allPagesGoodText ? estimatePdfQuestionMarkers(rangeText) : null;
                const expectedQuestions = isUsablePdfMarkerEstimate(markerEstimate) ? markerEstimate!.count : 0;
                const expectedQuestionEvidence = buildPdfMarkerExpectedEvidence(markerEstimate);
                
                allParts.push({
                  inlineDataParts: images.map((imageBase64) => ({
                    mimeType: 'image/jpeg',
                    data: imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64,
                  })),
                  sourceMode: 'pdfVision',
                  sourceLabel,
                  text: rangeText,
                  pdfDataUrl,
                  rawPdfBase64: rawBase64,
                  pdfFileName: file.name,
                  pdfTextPages: rangePages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
                  pdfVisionQuality: 'standard',
                  trace: buildTrace(file, sourceLabel, 'pdfVision', {
                    pageRange: range,
                    boundaryRisk: range.boundaryRisk,
                    expectedQuestionNumbers: expectedQuestionEvidence.numbers,
                  }, rangeText),
                  textLayerSuspect: !allPagesGoodText,
                  boundaryRisk: range.boundaryRisk,
                  expectedQuestionEvidence,
                  expectedQuestionsReliable: false,
                  ...(expectedQuestions > 0 ? { expectedQuestions } : {}),
                });
              }
            } else {
              const pdfChunks = await splitPdfByRanges(rawBase64, visionRanges);
              pdfChunks.forEach((chunkBase64, chunkIndex) => {
                const range = visionRanges[chunkIndex];
                const sourceLabel = joinSourceLabel(file.name, range ? formatPageRangeLabel(range) : '');
                const rangePages = range ? pdfTextAnalysis.pages.slice(range.start - 1, range.end) : [];
                const rangeText = rangePages.map((page) => page.text).join('\n\n');
                
                const allPagesGoodText = rangePages.length > 0 && rangePages.every((page) => page.quality === 'goodText');
                const markerEstimate = allPagesGoodText ? estimatePdfQuestionMarkers(rangeText) : null;
                const expectedQuestions = isUsablePdfMarkerEstimate(markerEstimate) ? markerEstimate!.count : 0;
                const expectedQuestionEvidence = buildPdfMarkerExpectedEvidence(markerEstimate);

                allParts.push({
                  inlineData: { mimeType: 'application/pdf', data: chunkBase64 },
                  sourceMode: 'pdfVision',
                  sourceLabel,
                  text: rangeText,
                  pdfDataUrl,
                  rawPdfBase64: rawBase64,
                  pdfFileName: file.name,
                  pdfTextPages: rangePages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
                  pdfVisionQuality: 'standard',
                  trace: buildTrace(file, sourceLabel, 'pdfVision', {
                    pageRange: range,
                    boundaryRisk: range.boundaryRisk,
                    expectedQuestionNumbers: expectedQuestionEvidence.numbers,
                  }, rangeText),
                  textLayerSuspect: !allPagesGoodText,
                  boundaryRisk: range.boundaryRisk,
                  expectedQuestionEvidence,
                  expectedQuestionsReliable: false,
                  ...(expectedQuestions > 0 ? { expectedQuestions } : {}),
                });
              });
            }
          }
        } catch (splitError) {
          console.info('PDF safe hybrid fallback to legacy vision:', splitError);
          const legacyRanges = getPdfPageRanges(await getPdfPageCount(rawBase64), visionPagesPerChunk, 1);
          if (isOpenAICompatibleRuntime(runtimeSettings)) {
            for (const range of legacyRanges) {
              const images = await convertPdfToImages(pdfDataUrl, range, { quality: runtimeSettings.pdfVisionQuality ?? 'high' });
              const sourceLabel = joinSourceLabel(file.name, formatPageRangeLabel(range));
              allParts.push({
                inlineDataParts: images.map((imageBase64) => ({
                  mimeType: 'image/jpeg',
                  data: imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64,
                })),
                sourceMode: 'pdfVision',
                sourceLabel,
                pdfDataUrl,
                rawPdfBase64: rawBase64,
                pdfFileName: file.name,
                pdfVisionQuality: 'standard',
                boundaryRisk: range.boundaryRisk,
                expectedQuestionEvidence: buildPdfMarkerExpectedEvidence(null),
                expectedQuestionsReliable: false,
                trace: buildTrace(file, sourceLabel, 'pdfVision', { pageRange: range, boundaryRisk: range.boundaryRisk }),
              });
            }
          } else {
            const pdfChunks = await splitPdfByRanges(rawBase64, legacyRanges);
            pdfChunks.forEach((chunkBase64, chunkIndex) => {
              const range = legacyRanges[chunkIndex];
              const sourceLabel = joinSourceLabel(file.name, range ? formatPageRangeLabel(range) : '');
              allParts.push({
                inlineData: { mimeType: 'application/pdf', data: chunkBase64 },
                sourceMode: 'pdfVision',
                sourceLabel,
                pdfDataUrl,
                rawPdfBase64: rawBase64,
                pdfFileName: file.name,
                pdfVisionQuality: 'standard',
                boundaryRisk: range.boundaryRisk,
                expectedQuestionEvidence: buildPdfMarkerExpectedEvidence(null),
                expectedQuestionsReliable: false,
                trace: buildTrace(file, sourceLabel, 'pdfVision', { pageRange: range, boundaryRisk: range.boundaryRisk }),
              });
            });
          }
        }
      } else if (file.type.startsWith('image/')) {
        const sourceLabel = file.name;
        allParts.push({
          inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content },
          sourceLabel,
          trace: buildTrace(file, sourceLabel, 'image'),
        });
      } else if (file.docxImageParts?.length) {
        const docxMcqText = file.nativeText?.trim() || file.structuredText?.trim() || '';
        const docxBatches = splitNativeMcqTextIntoBatches(docxMcqText, adaptiveQuestionCap);
        if (docxBatches.length > 0) {
          docxBatches.forEach((text, batchIndex) => {
            const sourceLabel = joinSourceLabel(file.name, `Nhóm ${batchIndex + 1}`);
            const expectedQuestions = getNativeBatchExpectedCount(text);
            allParts.push({
              text: `[TÀI LIỆU DOCX ${file.nativeText?.trim() ? 'NATIVE' : 'STRUCTURED'}: "${file.name}" (Nhóm ${batchIndex + 1}/${docxBatches.length})]\n\n${text}`,
              nativeMcqBatch: true,
              sourceLabel,
              trace: buildTrace(file, sourceLabel, 'docxText', { batchIndex: batchIndex + 1 }, text),
              expectedQuestionEvidence: buildStructuredExpectedEvidence(expectedQuestions, 'DOCX native/structured batch đã được tách thành block MCQ.'),
              expectedQuestionsReliable: true,
              expectedQuestions,
            });
          });
        }
        file.docxImageParts.forEach((image) => {
          const sourceLabel = joinSourceLabel(file.name, `Ảnh ${image.index}`);
          allParts.push({
            inlineData: { mimeType: image.mimeType, data: image.content.includes(',') ? image.content.split(',')[1] : image.content },
            sourceMode: 'docxImage',
            docxImageLabel: `[DOCX IMAGE: "${file.name}" - Ảnh ${image.index} (${image.name})]`,
            sourceLabel,
            trace: buildTrace(file, sourceLabel, 'docxImage', { batchIndex: image.index }),
          });
        });
      } else if (file.nativeText?.trim() || file.structuredText?.trim()) {
        const docxMcqText = file.nativeText?.trim() || file.structuredText?.trim() || '';
        const docxBatches = splitNativeMcqTextIntoBatches(docxMcqText, adaptiveQuestionCap);
        if (docxBatches.length > 0) {
          docxBatches.forEach((text, batchIndex) => {
            const sourceLabel = joinSourceLabel(file.name, `Nhóm ${batchIndex + 1}`);
            const expectedQuestions = getNativeBatchExpectedCount(text);
            allParts.push({
              text: `[TÀI LIỆU DOCX ${file.nativeText?.trim() ? 'NATIVE' : 'STRUCTURED'}: "${file.name}" (Nhóm ${batchIndex + 1}/${docxBatches.length})]\n\n${text}`,
              nativeMcqBatch: true,
              sourceLabel,
              trace: buildTrace(file, sourceLabel, 'docxText', { batchIndex: batchIndex + 1 }, text),
              expectedQuestionEvidence: buildStructuredExpectedEvidence(expectedQuestions, 'DOCX native/structured batch đã được tách thành block MCQ.'),
              expectedQuestionsReliable: true,
              expectedQuestions,
            });
          });
        } else {
          const sourceLabel = file.name;
          allParts.push({
            text: `[TÀI LIỆU: "${file.name}" (DOCX structured fallback)]\n\n${docxMcqText}`,
            sourceLabel,
            trace: buildTrace(file, sourceLabel, 'docxText', undefined, docxMcqText),
          });
        }
      } else {
        const MAX_CHARS = textCharBudget;
        const OVERLAP = 1000;
        let offset = 0;
        let partIdx = 1;
        const textContent = getFileTextContent(file);
        while (offset < textContent.length) {
          const currentPart = partIdx++;
          const sourceLabel = textContent.length <= MAX_CHARS ? file.name : joinSourceLabel(file.name, `Phần ${currentPart}`);
          const text = `[TÀI LIỆU: "${file.name}" (Phần ${currentPart})]\n\n` + textContent.substring(offset, offset + MAX_CHARS);
          allParts.push({
            text,
            sourceLabel,
            trace: buildTrace(file, sourceLabel, 'text', { batchIndex: currentPart }, text),
          });
          offset += (MAX_CHARS - OVERLAP);
          if (offset >= textContent.length - OVERLAP) {
            if (offset < textContent.length) {
              const sourceLabel = joinSourceLabel(file.name, 'Phần cuối');
              const text = `[TÀI LIỆU: "${file.name}" (Phần cuối)]\n\n` + textContent.substring(offset, textContent.length);
              allParts.push({
                text,
                sourceLabel,
                trace: buildTrace(file, sourceLabel, 'text', { batchIndex: currentPart + 1 }, text),
              });
            }
            break;
          }
        }
      }
    }

    if (allParts.length === 0) {
      return { questions: [], duplicates: [], failedBatches: [], failedBatchDetails: [], autoSkippedCount: 0 };
    }

    if (runtimeSettings.provider === 'shopaikey' && isShopAIKeyDeepSeekModel(runtimeSettings.model) && partsRequireVision(allParts)) {
      allParts = prepareShopAIKeyDeepSeekTextOnlyParts(allParts);
      if (onProgress) {
        onProgress('DeepSeek ShopAIKey dùng Cheap API: chuyển batch có text/OCR sang text-only, không gửi ảnh thô để tránh route sang Gemini group.', 0);
      }
    }

    if (isOpenAICompatibleRuntime(runtimeSettings)) {
      const coercedModel = coerceModelForProviderInput(runtimeSettings.provider, runtimeSettings.model, partsRequireVision(allParts));
      if (coercedModel !== runtimeSettings.model) {
        console.warn(`🛡️ ${runtimeSettings.provider}: model ${runtimeSettings.model} không phù hợp với input ảnh/PDF. Đổi sang ${coercedModel}.`);
        runtimeSettings = { ...runtimeSettings, model: coercedModel };
      }
    }

    const questionSchema = getQuestionSchema();

    let allQuestions: any[] = [...(options.existingQuestions || [])];
    let allDuplicates: any[] = [...(options.existingDuplicates || [])];
    let failedBatches: number[] = [];
    let failedBatchDetails: BatchFailureInfo[] = [];
    let duplicateCounter = 0;
    let autoSkippedCount = options.existingAutoSkippedCount || 0;
    let rescueCompleted = 0;
    const rescueTotal = retryIndices?.length || 0;
    const shouldInferCompletedBatchIndices = Boolean(
      options.resumeMode &&
      !options.skipInferredCompletedBatches &&
      !(retryIndices && retryIndices.length > 0)
    );
    const inferredCompletedBatchIndices = shouldInferCompletedBatchIndices
      ? inferCompletedBatchIndicesFromExistingQuestions(allParts, options.existingQuestions || [])
      : [];
    const deprioritizedBatchSet = new Set<number>(
      (options.deprioritizedBatchIndices || [])
        .filter((batchNumber) => Number.isFinite(batchNumber) && batchNumber > 0)
        .map((batchNumber) => Math.floor(batchNumber))
    );
    const skippedBatchSet = new Set(
      [
        ...(options.completedBatchIndices || []),
        ...inferredCompletedBatchIndices,
      ].filter((batchNumber) => !deprioritizedBatchSet.has(batchNumber))
    );
    const inferredOnlyBatchIndices = inferredCompletedBatchIndices.filter(
      index => !(options.completedBatchIndices || []).includes(index) && !deprioritizedBatchSet.has(index)
    );
    if (inferredOnlyBatchIndices.length > 0) {
      console.warn(`↩️ Resume: inferred ${inferredOnlyBatchIndices.length} already-restored batch(es) from saved SOURCE_LABEL snapshots. Skipping re-scan: ${inferredOnlyBatchIndices.join(', ')}`);
    }
    const phaseBatchNumbers = retryIndices && retryIndices.length > 0
      ? [...retryIndices]
      : Array.from({ length: allParts.length }, (_, idx) => idx + 1);
    const totalTopLevelBatches = phaseBatchNumbers.length;
    const batchQuestions = new Map<number, MCQ[]>();
    const batchDuplicates = new Map<number, DuplicateInfo[]>();
    const batchAutoSkipped = new Map<number, number>();
    const batchCoverageKeys = new Map<number, Set<string>>();
    const recoveryBudgets = new Map<string, number>();
    type DeferredRecoveryItem = {
      index: number;
      topLevelIndex: number;
      label: string;
      stage: Extract<BatchFailureInfo['stage'], 'partial' | 'split'>;
      parts: any[];
      missingCount: number;
      expectedQuestions: number;
      expectedQuestionsReliable: boolean;
      beforeCoverageCount: number;
      recoveryBudgetKey?: string;
      reasonError?: any;
      forceJsonRepair: boolean;
      depth: number;
    };
    const deferredRecoveryQueue: DeferredRecoveryItem[] = [];
    batchPostprocessor = createBatchPostprocessor();
    await batchPostprocessor.start(allQuestions, allDuplicates);
    const checkpointBatchInterval = Math.max(1, options.checkpointBatchInterval || 1);
    const checkpointIntervalMs = Math.max(0, options.checkpointIntervalMs || 0);
    const getPhaseCompletedCount = (completedBatchNumbers: number[]) => {
      const completedSet = new Set(completedBatchNumbers);
      return phaseBatchNumbers.filter(batchNumber => completedSet.has(batchNumber)).length;
    };
    let lastCheckpointCompletedCount = getPhaseCompletedCount(Array.from(skippedBatchSet));
    let lastCheckpointAt = Date.now();
    let lastFullCheckpointAt = 0;

    const appendBatchQuestions = (batchNumber: number, questions: MCQ[]) => {
      if (questions.length === 0) return;
      const current = batchQuestions.get(batchNumber) || [];
      batchQuestions.set(batchNumber, [...current, ...questions]);
    };

    const appendBatchDuplicates = (batchNumber: number, duplicates: DuplicateInfo[]) => {
      if (duplicates.length === 0) return;
      const current = batchDuplicates.get(batchNumber) || [];
      batchDuplicates.set(batchNumber, [...current, ...duplicates]);
    };

    const incrementBatchAutoSkipped = (batchNumber: number, count: number) => {
      if (count <= 0) return;
      batchAutoSkipped.set(batchNumber, (batchAutoSkipped.get(batchNumber) || 0) + count);
    };

    const getBatchProgressNumbers = (): number[] => {
      const progressed = new Set<number>();
      batchQuestions.forEach((questions, batchNumber) => {
        if (questions.length > 0) progressed.add(batchNumber);
      });
      batchDuplicates.forEach((duplicates, batchNumber) => {
        if (duplicates.length > 0) progressed.add(batchNumber);
      });
      batchAutoSkipped.forEach((count, batchNumber) => {
        if (count > 0) progressed.add(batchNumber);
      });
      return Array.from(progressed);
    };

    const getSnapshotBatchNumbers = (completedBatchNumbers: number[]): number[] => (
      Array.from(new Set([
        ...completedBatchNumbers,
        ...getBatchProgressNumbers(),
      ])).sort((a, b) => a - b)
    );

    const getBatchCoverageSet = (batchNumber: number) => {
      let coverage = batchCoverageKeys.get(batchNumber);
      if (!coverage) {
        coverage = new Set<string>();
        batchCoverageKeys.set(batchNumber, coverage);
      }
      return coverage;
    };

    const markBatchCoverageKeys = (batchNumber: number, coverageKeys: string[]) => {
      if (coverageKeys.length === 0) return;
      const coverage = getBatchCoverageSet(batchNumber);
      coverageKeys.forEach((key) => {
        if (key) coverage.add(key);
      });
    };

    const getBatchCoveredQuestionCount = (batchNumber: number): number =>
      batchCoverageKeys.get(batchNumber)?.size || 0;

    const buildCheckpointSnapshot = (completedBatchNumbers: number[]) => (
      measureSync(`generation.buildCheckpointSnapshot(${completedBatchNumbers.length}/${totalTopLevelBatches})`, () => {
        const snapshotBatchNumbers = getSnapshotBatchNumbers(completedBatchNumbers);
        const snapshot = buildCompletedBatchSnapshot(
          options.existingQuestions || [],
          options.existingDuplicates || [],
          options.existingAutoSkippedCount || 0,
          batchQuestions,
          batchDuplicates,
          batchAutoSkipped,
          snapshotBatchNumbers
        );
        const questionList = snapshot.questionsSnapshot;

        if (questionList.length > 1) {
          const numCache = new Map<any, number>();
          const getNum = (q: any) => {
            let num = numCache.get(q);
            if (num === undefined) {
              num = extractQuestionNumber(q.question) ?? 999999;
              numCache.set(q, num);
            }
            return num;
          };
          questionList.sort((a, b) => getNum(a) - getNum(b));
        }

        return {
          questionsSnapshot: questionList,
          duplicatesSnapshot: snapshot.duplicatesSnapshot,
          autoSkippedCount: snapshot.autoSkippedCount,
        };
      })
    );

    const emitCheckpoint = (batchIndex: number, completedBatchIndices: number[], forceFullSnapshot = false) => {
      if (!options.onCheckpoint) return;
      const now = Date.now();
      const shouldBuildFullSnapshot = !options.lightweightCheckpoints && (
        forceFullSnapshot || now - lastFullCheckpointAt >= FULL_CHECKPOINT_INTERVAL_MS
      );
      const checkpointSnapshot = shouldBuildFullSnapshot ? buildCheckpointSnapshot(completedBatchIndices) : null;
      lastCheckpointCompletedCount = getPhaseCompletedCount(completedBatchIndices);
      lastCheckpointAt = now;
      if (shouldBuildFullSnapshot) lastFullCheckpointAt = now;
      options.onCheckpoint({
        batchIndex,
        totalTopLevelBatches,
        completedBatchIndices,
        failedBatchIndices: Array.from(new Set(failedBatches)).sort((a, b) => a - b),
        failedBatchDetails: [...failedBatchDetails].sort((a, b) => a.index - b.index || a.label.localeCompare(b.label)),
        snapshotKind: shouldBuildFullSnapshot ? 'full' : 'metadata',
        questionsSnapshot: checkpointSnapshot?.questionsSnapshot,
        duplicatesSnapshot: checkpointSnapshot?.duplicatesSnapshot,
        autoSkippedCount: checkpointSnapshot?.autoSkippedCount ?? autoSkippedCount,
        currentCount: checkpointSnapshot?.questionsSnapshot.length ?? allQuestions.length,
      });
    };

    const mapKeyHealthDiagnostics = (items: any[] | undefined): BatchFailureDiagnostics['keyHealth'] | undefined => {
      if (!Array.isArray(items) || items.length === 0) return undefined;
      return items.map(item => ({
        keyNumber: Number(item.keyNumber || 0),
        status: String(item.status || 'unknown'),
        remainingMs: Number.isFinite(Number(item.remainingMs)) ? Number(item.remainingMs) : 0,
        inFlightCount: Number(item.inFlightCount || 0),
        failureCount: Number(item.failureCount || 0),
        successCount: Number(item.successCount || 0),
        lastError: item.lastError,
      }));
    };

    const buildBatchFailureDiagnostics = (error: any): BatchFailureInfo['diagnostics'] | undefined => {
      const retryDiagnostics = error?.retryDiagnostics || {};
      const keyHealth = runtimeSettings.provider === 'google'
        ? mapKeyHealthDiagnostics(userKeyRotator.getKeyHealthSnapshot())
        : mapKeyHealthDiagnostics(retryDiagnostics.keyHealth);
      const diagnostics: BatchFailureInfo['diagnostics'] = {
        attempts: retryDiagnostics.attempts,
        distinctKeysTried: retryDiagnostics.distinctKeysTried,
        maxKeysPerOperation: retryDiagnostics.maxKeysPerOperation,
        lastKeyNumber: retryDiagnostics.lastKeyNumber,
        modelName: retryDiagnostics.modelName,
        providerStatus: retryDiagnostics.providerStatus,
        retryAfterMs: retryDiagnostics.retryAfterMs,
        keyHealth,
      };
      return Object.values(diagnostics).some(value => value !== undefined) ? diagnostics : undefined;
    };

    const recordBatchFailure = (
      index: number,
      label: string,
      error: any,
      stage: BatchFailureInfo['stage'],
      extras: Partial<Pick<BatchFailureInfo,
        'missingCount' |
        'recoveredCount' |
        'partialRawCount' |
        'partialAddedCount' |
        'partialDuplicateCount' |
        'partialAutoSkippedCount' |
        'partialUnchangedCount' |
        'expectedQuestions' |
        'coverageStatus' |
        'coverageConfidence' |
        'verifiedExpectedCount' |
        'validCoveredCount' |
        'tailComplete' |
        'diagnostics'
      >> = {}
    ) => {
      const batchNumber = index + 1;
      const detail = describeBatchError(error, retryProfile.name);
      const { diagnostics: extraDiagnostics, ...failureExtras } = extras;
      const diagnostics = extraDiagnostics || buildBatchFailureDiagnostics(error);
      const nextDetail = {
        index: batchNumber,
        label,
        kind: detail.kind,
        stage,
        message: detail.message,
        advice: detail.advice,
        ...failureExtras,
        ...(diagnostics ? { diagnostics } : {}),
      };
      const hasQuestions = getBatchCoveredQuestionCount(batchNumber) > 0;
      const isPartialOrRescueSuccess = (stage === 'partial' || stage === 'rescue' || stage === 'deferred') && hasQuestions;
      if (!isPartialOrRescueSuccess) {
        if (!failedBatches.includes(batchNumber)) failedBatches.push(batchNumber);
      } else {
        // If it was previously added (e.g. from an earlier empty try), but now successfully has questions,
        // we can remove it from failedBatches since it completed successfully now.
        failedBatches = failedBatches.filter(item => item !== batchNumber);
      }
      const existingIndex = failedBatchDetails.findIndex(item => item.index === batchNumber && item.label === label && item.stage === stage);
      if (existingIndex >= 0) {
        failedBatchDetails[existingIndex] = nextDetail;
      } else {
        failedBatchDetails.push(nextDetail);
      }
    };

    const clearBatchFailure = (batchNumber: number, label: string, stage: BatchFailureInfo['stage']) => {
      failedBatchDetails = failedBatchDetails.filter(item => !(item.index === batchNumber && item.label === label && item.stage === stage));
      if (!failedBatchDetails.some(item => item.index === batchNumber)) {
        failedBatches = failedBatches.filter(item => item !== batchNumber);
      }
    };

    // --- STEP 2: BATCH PROCESSING ---
    const getConcurrencyLimit = () => {
      if (isRescueMode) return 1;
      return runtimeSettings.provider === 'google'
        ? userKeyRotator.getRecommendedConcurrency(requestedConcurrency)
        : requestedConcurrency;
    };

    const totalBatches = totalTopLevelBatches;
    const stableFallbackModel = getProviderFallbackModel(runtimeSettings.provider, runtimeSettings.model);
    const extractionModel = isAdvancedMode || isRescueMode ? stableFallbackModel : runtimeSettings.model;

    const runPartsWithLimit = async <T,>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> => {
      const concurrency = Math.max(1, limit);
      const queue = items.map((item, idx) => ({ item, index: idx + 1 }));
      let nextIndex = 0;

      const runners = Array(concurrency).fill(null).map(async () => {
        while (nextIndex < queue.length) {
          const task = queue[nextIndex++];
          if (!task) break;
          await controller?.waitIfPaused();
          try {
            await worker(task.item, task.index);
          } catch (e) {
            console.error(`Sub-task Runner Error [${task.index}]:`, e);
          }
        }
      });
      await Promise.all(runners);
    };

    const getSplitConcurrencyLimit = () => {
      const hasVision = allParts.some(p => p.sourceMode === 'pdfVision' || p.sourceMode === 'image');
      if (hasVision || isRescueMode || isGoogleKeyConservationActive(runtimeSettings.provider, userKeyRotator.hasRecentProviderPressure())) return 1;
      return Math.max(1, Math.min(getConcurrencyLimit(), 2));
    };

    const isKeyConservationActive = () => isGoogleKeyConservationActive(
      runtimeSettings.provider,
      userKeyRotator.hasRecentProviderPressure(KEY_CONSERVATION_PRESSURE_WINDOW_MS)
    );

    const getImmediateRecoveryPartLimit = (recoveryPolicy: RecoveryPolicy) => (
      isKeyConservationActive()
        ? 0
        : Math.min(recoveryPolicy.maxRecoveryRequests, isRescueMode ? 1 : MAX_IMMEDIATE_RECOVERY_PARTS)
    );

    const createProviderPressureDeferredError = () => Object.assign(
      new Error('PROVIDER_PRESSURE_DEFERRED_RECOVERY: Provider đang nóng; giữ phần thiếu để quét lại sau cooldown.'),
      {
        retryKind: 'serverBusy',
        retryCause: 'serverBusy',
      }
    );

    const enqueueDeferredRecovery = (item: DeferredRecoveryItem) => {
      if (item.parts.length === 0) return;
      // Ensure missingCount is at least 1 to prevent silent discard of rate-limited batches
      const safeMissingCount = Math.max(1, item.missingCount || 1);
      const safeItem = { ...item, missingCount: safeMissingCount };
      deferredRecoveryQueue.push(safeItem);
      const failureError = safeItem.reasonError || new Error(`Thiếu ${safeMissingCount}/${safeItem.expectedQuestions || '?'} câu; đang chờ provider hạ nhiệt để cứu phần thiếu.`);
      recordBatchFailure(safeItem.index, safeItem.label, failureError, safeItem.stage, {
        missingCount: safeMissingCount,
        recoveredCount: 0,
      });
      console.info(`Batch ${safeItem.label}: Queued ${safeItem.parts.length} deferred recovery part(s) after provider pressure/limit.`);
    };

    const getAdvisoryPdfExpectedCount = (part: any): number => {
      const evidence = part?.expectedQuestionEvidence;
      if (evidence?.source === 'pdf-text-layer-markers' && isUsablePdfMarkerEstimate(evidence)) {
        return Math.max(0, Number(evidence.count || 0));
      }
      const estimate = estimatePdfQuestionMarkers(part?.text || '');
      return isUsablePdfMarkerEstimate(estimate) ? estimate.count : 0;
    };

    const buildSeenQuestionFingerprints = (questions: Array<{ question?: string }>): string =>
      questions
        .map((question, idx) => `${idx + 1}. ${String(question.question || '').replace(/\s+/g, ' ').trim().slice(0, 140)}`)
        .filter(line => line.length > 3)
        .join('\n');

    const getPdfVisionRangeText = (part: any, range: { start: number; end: number }): string => {
      const textPages = Array.isArray(part.pdfTextPages) ? part.pdfTextPages : [];
      const rangeText = textPages
        .filter((page: any) => page.pageNumber >= range.start && page.pageNumber <= range.end)
        .map((page: any) => page.text)
        .filter(Boolean)
        .join('\n\n');
      return rangeText || part.text || '';
    };

    const getPdfVisionRangePageCount = (range: any): number => {
      if (!range) return 0;
      const start = Math.max(1, Math.floor(Number(range.start) || 0));
      const end = Math.max(start, Math.floor(Number(range.end) || 0));
      return Math.max(0, end - start + 1);
    };

    const buildPdfVisionRecoveryParts = async (
      part: any,
      salvagedQuestions: Array<{ question?: string }>,
      missingCount: number,
      maxParts: number = Number.POSITIVE_INFINITY,
      direction: PdfVisionRecoveryDirection = 'forward'
    ): Promise<any[]> => {
      const sourceRange = part.trace?.pageRange;
      if (part.sourceMode !== 'pdfVision' || !part.pdfDataUrl || !sourceRange) return [];
      if (maxParts <= 0) return [];

      const ranges = splitPdfRangeForVisionRecovery(sourceRange, direction);
      const existingQuestionFingerprints = buildSeenQuestionFingerprints(salvagedQuestions);
      const fileName = part.pdfFileName || part.trace?.fileName || getTrustedSourceLabel(part).split('|')[0] || 'PDF';
      const recoveryParts: any[] = [];

      const getPageCoveredCount = (p: number): number => {
        const candidateQuestions = salvagedQuestions.filter((q: any) => {
          const qRange = q.trace?.pageRange;
          if (!qRange) return false;
          return p >= qRange.start && p <= qRange.end;
        });

        let count = 0;
        for (const q of candidateQuestions as any[]) {
          const qRange = q.trace?.pageRange;
          if (!qRange) continue;
          if (qRange.start === qRange.end) {
            if (qRange.start === p) {
              count++;
            }
          } else {
            const qNum = getCoverageQuestionNumber(q);
            if (qNum) {
              const pText = getPdfVisionRangeText(part, { start: p, end: p });
              const pEstimate = estimatePdfQuestionMarkers(pText);
              if (pEstimate.numbers?.includes(qNum)) {
                count++;
                continue;
              }

              let matchedOther = false;
              for (let otherP = qRange.start; otherP <= qRange.end; otherP++) {
                if (otherP === p) continue;
                const otherText = getPdfVisionRangeText(part, { start: otherP, end: otherP });
                const otherEstimate = estimatePdfQuestionMarkers(otherText);
                if (otherEstimate.numbers?.includes(qNum)) {
                  matchedOther = true;
                  break;
                }
              }
              if (matchedOther) {
                continue;
              }
            }

            if (qRange.start === p) {
              count++;
            }
          }
        }
        return count;
      };

      for (const range of ranges) {
        if (recoveryParts.length >= maxParts) break;

        const rangeStart = range.start;
        const rangeEnd = range.end;
        const activePagesInRange: number[] = [];

        for (let p = rangeStart; p <= rangeEnd; p++) {
          const pageText = getPdfVisionRangeText(part, { start: p, end: p });
          const markerEstimate = estimatePdfQuestionMarkers(pageText);
          const expectedFromText = isUsablePdfMarkerEstimate(markerEstimate) ? markerEstimate.count : 0;
          const salvagedOnPage = getPageCoveredCount(p);

          const isPageCompleted = expectedFromText > 0 && salvagedOnPage >= expectedFromText && salvagedOnPage > 0;
          if (!isPageCompleted) {
            activePagesInRange.push(p);
          } else {
            console.info(`[Vision Incremental Exclusion] Page ${p} of file "${fileName}" is fully resolved (${salvagedOnPage}/${expectedFromText} questions). Excluding from recovery.`);
          }
        }

        if (activePagesInRange.length === 0) {
          console.info(`[Vision Incremental Exclusion] Skipping entire recovery range ${range.start}-${range.end} because all pages are completed.`);
          continue;
        }

        const activeStart = Math.min(...activePagesInRange);
        const activeEnd = Math.max(...activePagesInRange);
        const activeRange = { start: activeStart, end: activeEnd };

        const rangeText = getPdfVisionRangeText(part, activeRange);
        const markerEstimate = estimatePdfQuestionMarkers(rangeText);
        const expectedFromText = isUsablePdfMarkerEstimate(markerEstimate) ? markerEstimate.count : 0;
        
        const parentHasReliableCount = part.expectedQuestionsReliable === true && typeof part.expectedQuestions === 'number' && part.expectedQuestions > 0;
        const expectedQuestions = parentHasReliableCount 
          ? Math.max(1, Math.min(missingCount, expectedFromText || missingCount))
          : 0;

        const images: string[] = [];
        for (const p of activePagesInRange) {
          const pageImages = await convertPdfToImages(part.pdfDataUrl, { start: p, end: p }, { quality: 'high' });
          images.push(...pageImages);
        }

        const sourceLabel = joinSourceLabel(fileName, formatPageRangeLabel(activeRange));
        recoveryParts.push({
          ...part,
          inlineData: undefined,
          inlineDataParts: images.map((imageBase64) => ({
            mimeType: 'image/jpeg',
            data: imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64,
          })),
          text: rangeText,
          sourceLabel,
          trace: {
            ...(part.trace || {}),
            fileName,
            sourceLabel,
            mode: 'pdfVision',
            pageRange: activeRange,
            boundaryRisk: part.boundaryRisk || part.trace?.boundaryRisk,
            expectedQuestionNumbers: part.expectedQuestionEvidence?.numbers || part.trace?.expectedQuestionNumbers,
            snippet: buildSourceSnippet(rangeText),
          },
          expectedQuestions,
          expectedQuestionEvidence: parentHasReliableCount
            ? buildStructuredExpectedEvidence(expectedQuestions, 'Recovery kế thừa expected đáng tin từ parent structured.')
            : buildPdfMarkerExpectedEvidence(markerEstimate),
          expectedQuestionsReliable: parentHasReliableCount,
          partialRecovery: true,
          recoveryAttemptedFromPartial: true,
          forceMissingOnly: true,
          existingQuestionFingerprints,
          pdfVisionQuality: 'high',
          pdfVisionRecoveryDirection: direction,
        });
      }

      return recoveryParts;
    };

    const toCoverageFailureExtras = (assessment: PdfVisionCoverageAssessment) => ({
      coverageStatus: assessment.status,
      coverageConfidence: assessment.confidence,
      verifiedExpectedCount: assessment.expectedCount,
      validCoveredCount: assessment.validCoveredCount,
      tailComplete: assessment.tailComplete,
    });

    const parseCoverageVerifierResult = (text: string): Partial<PdfVisionCoverageAssessment> & { questionNumbers?: number[] } => {
      const parsed = parseJsonFromModelText<any>(text);
      const confidence = String(parsed?.confidence || 'none').toLowerCase();
      return {
        expectedCount: Math.max(0, Math.floor(Number(parsed?.expectedCount || 0))),
        confidence: confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : 'none',
        tailComplete: parsed?.tailComplete === true,
        missingLikely: parsed?.missingLikely === true,
        reason: String(parsed?.reason || '').slice(0, 240),
        questionNumbers: Array.isArray(parsed?.questionNumbers)
          ? parsed.questionNumbers.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
          : [],
      };
    };

    const verifyPdfVisionCoverageWithAi = async (part: any, localAssessment: PdfVisionCoverageAssessment): Promise<PdfVisionCoverageAssessment> => {
      if (part?.sourceMode !== 'pdfVision' || localAssessment.validCoveredCount <= 0) return localAssessment;

      if ((part as any).aiVerifierCalled) {
        return {
          ...localAssessment,
          status: 'unverified',
          confidence: localAssessment.confidence === 'exact' ? 'exact' : 'none',
          reason: 'Bỏ qua AI verifier (đã gọi 1 lần tối đa để tiết kiệm token).',
        };
      }

      const sourceLabel = getTrustedSourceLabel(part);
      const existingNumbers = localAssessment.coveredQuestionNumbers.length > 0
        ? localAssessment.coveredQuestionNumbers.join(', ')
        : 'không có số câu đáng tin';
      const verifierPrompt = [
        `SOURCE_LABEL: ${sourceLabel}`,
        'Bạn là bộ kiểm định coverage PDF Vision, KHÔNG trích xuất đáp án, KHÔNG tạo câu hỏi mới.',
        'Nhiệm vụ: nhìn đúng trang/range ảnh hiện tại và chỉ đếm số câu hỏi trắc nghiệm MCQ thực sự có trong phạm vi này, đặc biệt kiểm tra phần cuối trang/range/cột phải có bị thiếu câu không.',
        `Hiện app đã lưu ${localAssessment.validCoveredCount} câu hợp lệ cho SOURCE_LABEL này. Số câu đã lưu nếu đọc được: ${existingNumbers}.`,
        'Trả JSON duy nhất theo schema: expectedCount, questionNumbers, tailComplete, confidence, missingLikely, reason.',
        'Chỉ đặt confidence="high" khi bạn chắc chắn đã nhìn hết toàn bộ range và tail không còn câu bị bỏ sót. Nếu ảnh mờ/cắt/không chắc, dùng medium hoặc low và missingLikely=true nếu có nguy cơ thiếu.',
      ].join('\n');

      try {
        const verifierResult = await (isOpenAICompatibleRuntime(runtimeSettings)
          ? executeWithUserRotation(
              extractionModel,
              async (currentKey, activeModel, attemptContext) => {
                const messages = [
                  { role: 'system', content: 'Return strict JSON only. Count PDF Vision MCQ coverage; do not extract questions.' },
                  { role: 'user', content: [{ type: 'text', text: verifierPrompt }, ...toOpenAIContentFromPart(part)] },
                ];
                const text = await callOpenAICompatibleProvider(runtimeSettings, activeModel, messages, true, {
                  apiKeyOverride: currentKey,
                  signal: attemptContext.signal,
                  timeoutMs: attemptContext.timeoutMs,
                });
                return { ...parseCoverageVerifierResult(text), usedApiKey: currentKey };
              },
              undefined,
              stableFallbackModel,
              retryProfile,
              controller
            )
          : executeWithUserRotation(
              extractionModel,
              async (currentKey, activeModel, attemptContext) => {
                if (!activeModel.startsWith('gemini-')) throw new Error(mismatchMessage || getProviderModelMismatchMessage('google', activeModel) || `MODEL_PROVIDER_MISMATCH: ${activeModel}`);
                const aiInstance = createGoogleGenAIClient(runtimeSettings, currentKey);
                const activeProfile = getModelTokenProfile(runtimeSettings.provider, activeModel);
                const config = getModelConfig(
                  currentKey,
                  'Return strict JSON only. Count PDF Vision MCQ coverage; do not extract questions.',
                  getPdfVisionCoverageSchema(),
                  activeModel,
                  undefined,
                  Math.min(1024, activeProfile.safeOutputBudget),
                  {
                    timeoutMs: attemptContext.timeoutMs,
                    signal: attemptContext.signal,
                    baseUrl: getGoogleRuntimeBaseUrl(runtimeSettings),
                  }
                );
                const chat = aiInstance.chats.create(config);
                const result = await chat.sendMessage({ message: buildGoogleBatchMessage(part, verifierPrompt) });
                return { ...parseCoverageVerifierResult(result.text || ''), usedApiKey: currentKey };
              },
              runtimeSettings.provider === 'google' ? userKeyRotator.getKeyForBatch() : '',
              stableFallbackModel,
              retryProfile,
              controller,
              getGoogleRequestRateLimitOptions(runtimeSettings)
            )
        );
        const result = evaluatePdfVisionCoverage(part, allQuestions, verifierResult);
        (part as any).aiVerifierCalled = true;
        return result;
      } catch (error) {
        console.warn(`Batch ${sourceLabel}: Coverage verifier failed; keeping conservative retry path.`, error);
        return {
          ...localAssessment,
          status: 'unverified',
          confidence: localAssessment.confidence === 'exact' ? 'exact' : 'none',
          reason: 'Coverage verifier không chạy được; giữ đường retry an toàn.',
        };
      }
    };

    const shouldUseAiCoverageVerifier = (): boolean => isRescueMode || Boolean(retryIndices && retryIndices.length > 0);

    const evaluatePdfVisionCoverageGate = async (part: any, allowAiVerifier = shouldUseAiCoverageVerifier()): Promise<PdfVisionCoverageAssessment> => {
      const localAssessment = evaluatePdfVisionCoverage(part, allQuestions);
      if (localAssessment.status === 'complete') return localAssessment;
      if (localAssessment.confidence === 'exact' || localAssessment.confidence === 'high') return localAssessment;
      if (!allowAiVerifier || part?.sourceMode !== 'pdfVision' || localAssessment.validCoveredCount <= 0) return localAssessment;
      return verifyPdfVisionCoverageWithAi(part, localAssessment);
    };

    const maybeSkipPdfVisionRetryByCoverage = async (
      part: any,
      index: number,
      label: string,
      stage: BatchFailureInfo['stage'],
      precomputedAssessment?: PdfVisionCoverageAssessment
    ): Promise<boolean> => {
      if (part?.sourceMode !== 'pdfVision') return false;
      const assessment = precomputedAssessment || await evaluatePdfVisionCoverageGate(part);
      if (assessment.status !== 'complete') return false;

      const batchNumber = index + 1;
      clearBatchFailure(batchNumber, label, stage);
      skippedBatchSet.add(batchNumber);
      console.info(`✅ Batch ${label}: Coverage gate xác nhận đủ ${assessment.validCoveredCount}/${assessment.expectedCount || assessment.validCoveredCount} câu; bỏ qua retry PDF Vision.`);
      if (onProgress) {
        onProgress(`Batch ${label} đã được xác minh đủ câu; bỏ qua quét lại để tiết kiệm request.`, allQuestions.length);
      }
      return true;
    };

    const getExistingQuestionsForPart = (part: any): MCQ[] => {
      return allQuestions.filter((question) => isQuestionInCoverageScope(question, part));
    };

    const runTailFirstPdfVisionProbe = async (
      part: any,
      index: number,
      label: string,
      preTailAssessment: PdfVisionCoverageAssessment
    ): Promise<boolean> => {
      const recoveryParts = await buildPdfVisionRecoveryParts(
        part,
        getExistingQuestionsForPart(part),
        1,
        1,
        'tailFirst'
      );
      if (recoveryParts.length === 0) return false;

      const topLevelBatchNumber = index + 1;
      const beforeTailQuestionCount = allQuestions.length;
      console.info(`Batch ${label}: Có ${preTailAssessment.validCoveredCount} câu đã lưu; ưu tiên tail-first probe trước khi quét lại full range.`);
      if (onProgress) {
        onProgress(`Đang kiểm tra phần cuối Batch ${label} trước khi quét lại toàn bộ...`, allQuestions.length);
      }

      await runPartsWithLimit(
        recoveryParts,
        1,
        (recoveryPart, i) => processBatch(recoveryPart, index, 1, true, index, i, label)
      );

      const tailAddedQuestionCount = Math.max(0, allQuestions.length - beforeTailQuestionCount);
      if (tailAddedQuestionCount > 0) {
        (part as any).aiVerifierCalled = false;
      }
      const postTailAssessment = tailAddedQuestionCount > 0
        ? await evaluatePdfVisionCoverageGate(part)
        : preTailAssessment;
      if (postTailAssessment.status === 'complete') {
        clearBatchFailure(topLevelBatchNumber, label, 'rescue');
        clearBatchFailure(topLevelBatchNumber, label, 'partial');
        skippedBatchSet.add(topLevelBatchNumber);
        console.info(`✅ Batch ${label}: Tail-first probe xác nhận đủ coverage (${postTailAssessment.validCoveredCount}/${postTailAssessment.expectedCount || postTailAssessment.validCoveredCount}).`);
        return true;
      }

      recordBatchFailure(index, label, new Error(
        tailAddedQuestionCount > 0
          ? `Tail-first probe thêm ${tailAddedQuestionCount} câu nhưng verifier chưa xác nhận đủ; giữ batch lỗi để tránh bỏ sót.`
          : 'Tail-first probe không thêm câu mới; dùng kết quả verifier trước đó và giữ batch lỗi thay vì quét full range lặp lại.'
      ), 'rescue', {
        recoveredCount: tailAddedQuestionCount,
        ...toCoverageFailureExtras(postTailAssessment),
      });
      console.info(`Batch ${label}: Tail-first probe ${tailAddedQuestionCount > 0 ? `thêm ${tailAddedQuestionCount} câu` : 'không thêm câu mới'} nhưng coverage chưa đủ chắc; dừng trước full retry.`);
      return true;
    };

    // Hàm xử lý Batch chính có khả năng Đệ quy (Subdivision)
    const processBatch = async (part: any, index: number, depth: number = 0, forceJsonRepair: boolean = false, topLevelIndex: number = index, subIndex: number = 0, labelPrefix: string = `${index + 1}`) => {
      const batchLabel = depth === 0 ? labelPrefix : `${labelPrefix}${String.fromCharCode(96 + depth)}.${subIndex + 1}`;
      let createPostprocessInputForPartial: ((fullText: string) => BatchPostprocessInput) | null = null;
      let handlePostprocessResultForPartial: ((postprocessResult: BatchPostprocessResult, salvageReasonError?: any) => Promise<boolean>) | null = null;

      try {
        await controller?.waitIfPaused();

        const expectedAtStart = part.sourceMode === 'pdfVision'
          ? (part.expectedQuestions || 0)
          : (part.expectedQuestions || getNativeBatchExpectedCount(part.text || ''));
        const currentScale = userKeyRotator.getAdaptiveBatchScale();
        const effectiveCap = adaptiveBatching ? Math.max(2, Math.floor(adaptiveQuestionCap * currentScale)) : adaptiveQuestionCap;

        // 1. Adaptive Splitting cho dữ liệu cấu trúc (DOCX Native/PDF Structured)
        if (adaptiveBatching && depth < retryProfile.maxDepth && part.nativeMcqBatch && expectedAtStart > effectiveCap) {
          const cappedParts = splitStructuredPartByBatchSize(part, effectiveCap);
          if (cappedParts.length > 1) {
            if (currentScale < 1.0) console.info(`🔄 Adaptive Scaling (${currentScale}x): Chủ động chia Batch ${batchLabel} thành ${cappedParts.length} phần nhỏ hơn (${effectiveCap} câu/phần)...`);
            await runPartsWithLimit(cappedParts, getSplitConcurrencyLimit(), (p, i) => processBatch(p, index, depth + 1, forceJsonRepair, topLevelIndex, i, batchLabel));
            return;
          }
        }

        // 2. Adaptive Splitting cho dữ liệu văn bản thuần (Text-only)
        const canAttemptSubdivision = depth < retryProfile.maxDepth;
        if (adaptiveBatching && canAttemptSubdivision && part.text && part.sourceMode !== 'pdfVision' && currentScale <= 0.5 && part.text.length > (retryProfile.splitThresholdChars * 2)) {
           const splitPartsCount = currentScale <= 0.25 ? 4 : 2;
           const chunks = splitTextIntoNaturalParts(part.text, splitPartsCount, retryProfile.splitThresholdChars);
           if (chunks.length > 1) {
              console.info(`🔄 Adaptive Scaling (${currentScale}x): Chủ động chia Batch TEXT ${batchLabel} thành ${chunks.length} phần để giảm áp lực...`);
              const subParts = chunks.map((chunk) => ({
                ...part,
                text: chunk,
                sourceLabel: part.sourceLabel,
                expectedQuestions: 0, // Sẽ được đếm lại trong processBatch đệ quy
              }));
              await runPartsWithLimit(subParts, getSplitConcurrencyLimit(), (p, i) => processBatch(p, index, depth + 1, forceJsonRepair, topLevelIndex, i, batchLabel));
              return;
           }
        }

        if (onProgress) {
          if (isRescueMode) {
            onProgress(`Đang cứu ${Math.min(rescueCompleted + 1, Math.max(1, rescueTotal))}/${Math.max(1, rescueTotal)} phần lỗi • đã thêm ${allQuestions.length} câu${depth > 0 ? ' • đang chia nhỏ' : ''}`, allQuestions.length);
          } else {
            onProgress(`Quét Batch ${batchLabel}/${totalBatches}${depth > 0 ? ' (Đang chia nhỏ)' : ''}...`, allQuestions.length);
          }
        }
        await waitWithController(Math.random() * (isRescueMode ? 250 : 800), controller);

        // Per-batch key assignment: Mỗi batch nhận key riêng theo round-robin
        const batchStartingKey = runtimeSettings.provider === 'google' ? userKeyRotator.getKeyForBatch() : '';
        const expectedQuestions = expectedAtStart;
        const recoveryPolicy = getRecoveryPolicyForPart(part, expectedQuestions, runtimeSettings.mainBatchOnlyRescue);
        const hasReliableExpectedCount = recoveryPolicy.expectedCountReliable && expectedQuestions > 0;
        const topLevelBatchNumber = topLevelIndex + 1;
        const isTargetedRetryBatch = Boolean(retryIndices?.includes(topLevelBatchNumber));
        const recoveryBudgetKey = typeof part.recoveryBudgetKey === 'string' ? part.recoveryBudgetKey : '';
        const createPostprocessInput = (fullText: string): BatchPostprocessInput => ({
          allowEmpty: recoveryPolicy.allowEmpty,
          batchIndex: index,
          duplicateCounterStart: duplicateCounter,
          enforceExpectedCount: recoveryPolicy.expectedCountReliable,
          expectedQuestions,
          fullText,
          partMeta: {
            sourceLabel: part.sourceLabel,
            sourceMode: part.sourceMode,
            text: part.text,
            trace: part.trace,
          },
          recoveryBudgetRemaining: recoveryBudgetKey ? (recoveryBudgets.get(recoveryBudgetKey) || 0) : null,
          replaceSeededSourceDuplicates: Boolean(retryIndices?.includes(topLevelBatchNumber)),
          topLevelBatchNumber,
        });
        createPostprocessInputForPartial = createPostprocessInput;
        const sourceInstruction = `SOURCE_LABEL: ${getTrustedSourceLabel(part)}\nBắt buộc trường "source" của mọi câu hỏi trong batch này phải copy y nguyên SOURCE_LABEL. CHỈ được trích xuất câu hỏi nằm trong đúng SOURCE_LABEL của batch hiện tại. Nếu tài liệu/cache còn chứa phần khác, bỏ qua hoàn toàn các câu ngoài phạm vi SOURCE_LABEL này dù nội dung rất giống. Không tự bịa tên đề, năm, chương, trang, file đáp án hoặc nguồn khác.`;
        const structuredSourceLabel = part.sourceMode === 'pdfText' ? 'PDF TEXT STRUCTURED' : 'DOCX';
        const hasStructuredExpectedBlocks = expectedQuestions > 0 && (part.nativeMcqBatch || part.structuredMcqBatch || part.sourceMode === 'pdfText');
        const repairInstruction = forceJsonRepair
          ? 'LƯU Ý SỬA JSON: Lần trước batch này bị lỗi định dạng hoặc thiếu câu. Hãy trả về JSON hợp lệ tuyệt đối, đóng đủ mọi ngoặc, không markdown, không giải thích ngoài JSON.'
          : '';
        const isTailFirstPdfVisionRecovery = part.sourceMode === 'pdfVision' && part.pdfVisionRecoveryDirection === 'tailFirst';
        const partialRecoveryInstruction = part.partialRecovery
          ? `LƯU Ý CỨU PHẦN THIẾU: Đây là lượt quét lại có chọn lọc. Chỉ trả về những câu còn thiếu/chưa có trong danh sách đã lưu. Nếu nội dung dưới đây trùng với câu đã lưu, bỏ qua và không tạo bản sao.${isTailFirstPdfVisionRecovery ? '\nPDF Vision tail rescue: ưu tiên đọc từ cuối phạm vi/trang cuối/cột phải lên để tìm câu bị mất do stream bị cắt, nhưng khi trả JSON vẫn sắp xếp câu theo thứ tự gốc trong tài liệu.' : ''}${part.existingQuestionFingerprints ? `\nCác câu đã lưu để tránh lặp:\n${part.existingQuestionFingerprints}` : ''}`
          : '';
        const nativePrompt = hasStructuredExpectedBlocks
          ? `NỘI DUNG ${structuredSourceLabel} ĐÃ ĐƯỢC TÁCH SẴN THÀNH ${expectedQuestions} BLOCK CÂU. Mỗi block <<<MCQ n>>> là đúng 1 câu hoặc 1 mục câu hỏi trong tài liệu. Option có ký hiệu ✅ là đáp án đúng lấy từ marker trong tài liệu; TUYỆT ĐỐI không đổi đáp án này. Nếu block có A/B/C/D thì trích đúng các lựa chọn đó. Nếu block chỉ có Question và Answer/Notes, hãy giữ nguyên câu hỏi, dùng Answer/Notes làm đáp án/giải thích, và chỉ tạo lựa chọn nhiễu khi tài liệu không cung cấp đủ options. Hãy trả về ĐÚNG ${expectedQuestions} câu theo cùng thứ tự, không bỏ câu nào.`
          : '';
        const imagePrompt = part.sourceMode === 'docxImage'
          ? `${part.docxImageLabel || '[DOCX IMAGE]'}\nẢnh này được nhúng trong file Word và CÓ THỂ chứa câu hỏi trắc nghiệm. Hãy phóng to/đọc kỹ toàn bộ chữ trong ảnh. Nếu ảnh chứa MCQ, hãy trích xuất đầy đủ mọi câu hỏi, lựa chọn và đáp án nếu nhìn thấy. ${forceJsonRepair ? 'Lần trước ảnh này trả rỗng hoặc lỗi; chỉ trả {"questions":[]} nếu bạn chắc chắn ảnh hoàn toàn không có câu hỏi trắc nghiệm.' : 'Nếu ảnh chỉ là minh họa và KHÔNG chứa câu hỏi trắc nghiệm, hãy trả về chính xác {"questions":[]}.'}`
          : '';
        const boundaryRisk = part.boundaryRisk || part.trace?.boundaryRisk;
        const expectedQuestionNumbers = Array.isArray(part.expectedQuestionEvidence?.numbers) && part.expectedQuestionEvidence.numbers.length > 0
          ? part.expectedQuestionEvidence.numbers
          : (Array.isArray(part.trace?.expectedQuestionNumbers) ? part.trace.expectedQuestionNumbers : []);
        const boundaryPrompt = boundaryRisk && (boundaryRisk.severity === 'medium' || boundaryRisk.severity === 'high')
          ? ` CẢNH BÁO BIÊN TRANG: range này được mở rộng vì có nguy cơ câu hỏi/tình huống/options bị cắt qua trang (${boundaryRisk.reasons.join(', ')}). Hãy đọc kỹ cuối trang trước và đầu trang sau, nối đầy đủ câu bị tách trang, không bỏ câu chỉ vì stem/options nằm ở hai trang khác nhau.`
          : '';
        const expectedNumbersPrompt = expectedQuestionNumbers.length > 0
          ? ` Text layer thấy các marker câu hỏi: ${expectedQuestionNumbers.join(', ')}. Đây chỉ là gợi ý, nhưng nếu ảnh thật có các câu này thì phải trích đủ và giữ nhãn nguyên bản trong trường question (VD: "Câu ${expectedQuestionNumbers[0]}: ...").`
          : '';
        const visionPrompt = (part.sourceMode === 'pdfVision' || part.inlineData || (Array.isArray(part.inlineDataParts) && part.inlineDataParts.length > 0))
          ? `[CHỈ THỊ QUAN TRỌNG CHO PHẦN ẢNH/VISION]: Tài liệu hiện tại đang được xử lý ở chế độ quét Vision (ảnh chụp/PDF scan). Hãy đọc cực kỳ chậm và tỉ mỉ từng dòng, từng góc của trang ảnh này. Hãy đếm thầm xem có chính xác bao nhiêu câu hỏi trắc nghiệm (MCQ) xuất hiện trên trang. Bạn phải trích xuất ĐẦY ĐỦ TRĂM PHẦN TRĂM câu hỏi, không được bỏ sót bất kỳ câu nào dù là câu ngắn, câu tình huống hay câu ở cuối trang. Đọc theo thứ tự trang từ trên xuống dưới; chú ý câu ở cuối trang, bảng, layout 2 cột và lựa chọn nằm sát mép.${part.sourceMode === 'pdfVision' && expectedQuestions > 0 ? ` Text layer gợi ý có khoảng ${expectedQuestions} câu trong phạm vi này; nếu thấy khác, hãy ưu tiên đọc ảnh thật kỹ nhưng không được bỏ sót câu đã có marker.` : ''}${expectedNumbersPrompt}${boundaryPrompt}${part.pdfVisionQuality === 'high' ? ' Đây là lượt cứu thiếu với ảnh nét hơn và phạm vi nhỏ hơn; chỉ trả các câu còn thiếu/chưa có trong danh sách đã lưu.' : ''}${isTailFirstPdfVisionRecovery ? ' Vì đây là tail rescue sau stream bị cắt, hãy soi kỹ phần cuối trang, trang cuối trong range, cột phải và các dòng sát mép trước; sau đó trả kết quả theo thứ tự đọc tự nhiên của tài liệu.' : ''}`
          : '';
        const extractionCommand = part.partialRecovery
          ? `CHỈ TRÍCH XUẤT CÁC CÂU CÒN THIẾU trong phần cứu này. Không trả lại câu đã có, không mở rộng ra ngoài block/trang được cung cấp (Phần ${batchLabel}).`
          : `HÃY QUÉT TOÀN BỘ NỘI DUNG TÀI LIỆU NÀY. Trích xuất TẤT CẢ câu hỏi trắc nghiệm tìm thấy (Phần ${batchLabel}).`;
        const scanPrompt = `${repairInstruction ? `${repairInstruction}\n\n` : ''}${partialRecoveryInstruction ? `${partialRecoveryInstruction}\n\n` : ''}${sourceInstruction}\n\n${nativePrompt ? `${nativePrompt}\n\n` : ''}${imagePrompt ? `${imagePrompt}\n\n` : ''}${visionPrompt ? `${visionPrompt}\n\n` : ''}${extractionCommand}`;

        const handlePostprocessResult = async (postprocessResult: BatchPostprocessResult, salvageReasonError?: any): Promise<boolean> => {
          if (postprocessResult.rawQuestions.length === 0) return false;

          const rawNewQs = postprocessResult.rawQuestions;
          const newQs = postprocessResult.newQuestions;
          const batchNewDuplicates = postprocessResult.duplicates;
          const batchNewAutoSkipped = postprocessResult.autoSkippedCount;
          const salvagedPartial = postprocessResult.salvagedPartial;
          const missingCount = postprocessResult.missingCount;
          duplicateCounter += postprocessResult.duplicateCounterDelta;
          markBatchCoverageKeys(topLevelBatchNumber, postprocessResult.coverageKeys);
          if (recoveryBudgetKey && typeof postprocessResult.recoveryBudgetRemaining === 'number') {
            recoveryBudgets.set(recoveryBudgetKey, postprocessResult.recoveryBudgetRemaining);
          }
          const partialDuplicateCount = batchNewDuplicates.length;
          const partialAutoSkippedCount = batchNewAutoSkipped;
          const partialUnchangedCount = Math.max(0, rawNewQs.length - newQs.length - partialDuplicateCount - partialAutoSkippedCount);
          const expectedLabel = hasReliableExpectedCount
            ? String(expectedQuestions)
            : expectedQuestions > 0
            ? `${expectedQuestions} advisory`
            : 'unknown';
          const partialNoAddReason = newQs.length > 0
            ? ''
            : partialDuplicateCount > 0
            ? 'duplicate'
            : partialAutoSkippedCount > 0
            ? 'auto-skip'
            : partialUnchangedCount > 0
            ? 'không có câu mới sau dedupe'
            : 'không có câu mới';
          const partialStats = `raw=${rawNewQs.length}, added=${newQs.length}, duplicates=${partialDuplicateCount}, autoSkipped=${partialAutoSkippedCount}, unchanged=${partialUnchangedCount}, expected=${expectedLabel}`;

          if (batchNewDuplicates.length > 0) {
            allDuplicates.push(...batchNewDuplicates);
            appendBatchDuplicates(topLevelBatchNumber, batchNewDuplicates);
          }
          if (batchNewAutoSkipped > 0) {
            autoSkippedCount += batchNewAutoSkipped;
            incrementBatchAutoSkipped(topLevelBatchNumber, batchNewAutoSkipped);
          }
          if (newQs.length > 0) {
            allQuestions.push(...newQs);
            appendBatchQuestions(topLevelBatchNumber, newQs);
            if (onProgress) {
              const subInfo = depth > 0 ? ` [Phần ${batchLabel.split(/[0-9]+/)[1] || batchLabel}]` : '';
              onProgress(`Đang quét Batch ${depth === 0 ? batchLabel : index + 1}${subInfo}/${totalBatches}... đã tìm thấy ${allQuestions.length} câu`, allQuestions.length);
            }
            if (onBatchComplete) onBatchComplete(newQs);
          }

          if (newQs.length > 0 || depth > 0) {
            console.info(`✅ Batch ${batchLabel}: Hoàn tất (Tìm thấy ${newQs.length} câu, tổng cộng: ${allQuestions.length}).`);
          }

          if (salvagedPartial) {
            console.info(`Batch ${batchLabel}: Partial salvage ${partialStats}${partialNoAddReason ? `; ${partialNoAddReason}.` : '.'}`);
          }

          const duplicateHeavyRescue = isDuplicateHeavyRescue({
            rawCount: rawNewQs.length,
            addedCount: newQs.length,
            duplicateCount: partialDuplicateCount,
            autoSkippedCount: partialAutoSkippedCount,
            unchangedCount: partialUnchangedCount,
          });
          if (
            duplicateHeavyRescue &&
            part.sourceMode === 'pdfVision' &&
            !hasReliableExpectedCount &&
            (depth === 0 || part.deferredRecovery) &&
            (isTargetedRetryBatch || isRescueMode || part.deferredRecovery)
          ) {
            const assessment = await evaluatePdfVisionCoverageGate(part);
            if (assessment.status === 'complete') {
              clearBatchFailure(topLevelBatchNumber, batchLabel, part.deferredRecovery ? 'deferred' : (isTargetedRetryBatch ? 'rescue' : 'partial'));
              skippedBatchSet.add(topLevelBatchNumber);
              console.info(`✅ Batch ${batchLabel}: Retry PDF Vision trả toàn trùng vì coverage đã đủ theo verifier.`);
            } else if (depth === 0 && !part.deferredRecovery) {
              recordBatchFailure(index, batchLabel, new Error('Retry PDF Vision trả gần như toàn câu trùng/không đổi; đã chuyển sang kiểm tra coverage/tail và giữ lỗi vì verifier chưa chắc.'), isTargetedRetryBatch ? 'rescue' : 'partial', {
                recoveredCount: 0,
                partialRawCount: rawNewQs.length,
                partialAddedCount: newQs.length,
                partialDuplicateCount,
                partialAutoSkippedCount,
                partialUnchangedCount,
                expectedQuestions,
                ...toCoverageFailureExtras(assessment),
              });
              console.info(`Batch ${batchLabel}: Duplicate-heavy rescue (${partialStats}); dừng retry sâu/full scan để tránh đốt request vào vùng đã đọc.`);
            }
            return true;
          }

          if (salvagedPartial && !hasReliableExpectedCount && !part.deferredRecovery && depth === 0) {
            recordBatchFailure(index, batchLabel, salvageReasonError || new Error(`Đã thêm ${newQs.length}/${rawNewQs.length} câu từ phản hồi bị cắt nhưng chưa xác minh đủ vì không có số câu kỳ vọng đáng tin.`), 'partial', {
              recoveredCount: newQs.length,
              partialRawCount: rawNewQs.length,
              partialAddedCount: newQs.length,
              partialDuplicateCount,
              partialAutoSkippedCount,
              partialUnchangedCount,
              expectedQuestions,
            });
            console.info(`Batch ${batchLabel}: Đã thêm ${newQs.length}/${rawNewQs.length} câu từ partial salvage nhưng chưa biết đủ tổng; giữ batch trong danh sách quét lại.`);
          }

          if (salvagedPartial && missingCount > 0 && !part.deferredRecovery) {
            const missingRatio = hasReliableExpectedCount ? missingCount / expectedQuestions : 0;
            const canRecoverPdfVision = recoveryPolicy.shouldRecoverMissing && part.sourceMode === 'pdfVision' && !part.partialRecovery && part.pdfDataUrl;
            const canRecoverPartial = recoveryPolicy.shouldRecoverMissing && recoveryPolicy.maxRecoveryRequests > 0;
            if (missingRatio > 0.4 && !canRecoverPdfVision && !isKeyConservationActive()) {
              if (postprocessResult.usedApiKey) {
                userKeyRotator.markKeyResult(postprocessResult.usedApiKey, {
                  kind: 'formatError',
                  error: new Error(`Thiếu ${missingCount} câu (>${Math.round(missingRatio * 100)}%)`),
                });
                db.saveKeyHealth(userKeyRotator.exportHealthState()).catch(err =>
                  console.error('Failed to save key health during salvage format error:', err)
                );
              }
              throw new Error(`AI_FORMAT_ERROR_PARTIAL_SALVAGE: Đã cứu ${rawNewQs.length} câu hợp lệ nhưng còn thiếu khoảng ${missingCount} câu (>${Math.round(missingRatio * 100)}%).`);
            } else if (!part.partialRecovery && canRecoverPartial) {
              console.info(`Batch ${batchLabel}: Salvage lấy được ${rawNewQs.length}/${expectedQuestions} câu (thiếu ${missingCount}). Đang cứu chọn lọc phần thiếu.`);
              const topLevelBatchNumber = topLevelIndex + 1;
              const beforeRecoveryCount = getBatchCoveredQuestionCount(topLevelBatchNumber);
              const recoveryParts = canRecoverPdfVision
                ? await buildPdfVisionRecoveryParts(part, rawNewQs, missingCount, recoveryPolicy.maxRecoveryRequests, 'tailFirst')
                : part.nativeMcqBatch
                ? buildPartialSalvageRecoveryParts(part, rawNewQs, missingCount <= 2 ? 1 : 2)
                : [{
                    ...part,
                    partialRecovery: true,
                    recoveryAttemptedFromPartial: true,
                    forceMissingOnly: true,
                    expectedQuestions: missingCount,
                    expectedQuestionsReliable: recoveryPolicy.expectedCountReliable,
                    existingQuestionFingerprints: buildSeenQuestionFingerprints(rawNewQs),
                  }];

              if (recoveryParts.length > 0) {
                const budgetedRecoveryParts = recoveryParts.slice(0, recoveryPolicy.maxRecoveryRequests);
                const recoveryPartLimit = getImmediateRecoveryPartLimit(recoveryPolicy);
                const { immediateParts, deferredParts } = splitRecoveryPartsForImmediateRun(budgetedRecoveryParts, recoveryPartLimit);
                if (budgetedRecoveryParts.length < recoveryParts.length) {
                  console.info(`Batch ${batchLabel}: Cắt cứu chọn lọc còn ${budgetedRecoveryParts.length}/${recoveryParts.length} phần theo evidence budget (${recoveryPolicy.eligibility}).`);
                }
                if (immediateParts.length < budgetedRecoveryParts.length) {
                  console.info(`Batch ${batchLabel}: Giới hạn cứu chọn lọc ${immediateParts.length}/${budgetedRecoveryParts.length} phần để bảo toàn API key; phần còn lại sẽ chạy tuần tự sau cooldown.`);
                }
                const recoveryBudgetKey = `batch-${topLevelBatchNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                recoveryBudgets.set(recoveryBudgetKey, missingCount);
                if (immediateParts.length > 0) {
                  await runPartsWithLimit(
                    immediateParts.map((recoveryPart) => ({ ...recoveryPart, recoveryBudgetKey })),
                    getSplitConcurrencyLimit(),
                    (recoveryPart, i) => processBatch(recoveryPart, index, depth + 1, true, topLevelIndex, i, batchLabel)
                  );
                }
                const afterImmediateCount = getBatchCoveredQuestionCount(topLevelBatchNumber);
                const immediatelyRecoveredCount = getRecoveredMissingQuestionCount(beforeRecoveryCount, afterImmediateCount, missingCount);
                const remainingMissingCount = Math.max(0, missingCount - immediatelyRecoveredCount);
                if (deferredParts.length > 0 && remainingMissingCount > 0) {
                  enqueueDeferredRecovery({
                    index,
                    topLevelIndex,
                    label: batchLabel,
                    stage: 'partial',
                    parts: deferredParts,
                    missingCount: remainingMissingCount,
                    expectedQuestions,
                    expectedQuestionsReliable: hasReliableExpectedCount,
                    beforeCoverageCount: afterImmediateCount,
                    recoveryBudgetKey,
                    reasonError: isKeyConservationActive() ? createProviderPressureDeferredError() : undefined,
                    forceJsonRepair: true,
                    depth: depth + 1,
                  });
                } else {
                  recoveryBudgets.delete(recoveryBudgetKey);
                }
              }

              const afterRecoveryCount = getBatchCoveredQuestionCount(topLevelBatchNumber);
              const recoveredCount = getRecoveredMissingQuestionCount(beforeRecoveryCount, afterRecoveryCount, missingCount);
              const hasQueuedDeferredForBatch = deferredRecoveryQueue.some(item => item.topLevelIndex === topLevelIndex && item.label === batchLabel && item.stage === 'partial');
              if (depth === 0 && recoveredCount < missingCount && !hasQueuedDeferredForBatch) {
                recordBatchFailure(index, batchLabel, new Error(`Thiếu ${missingCount - recoveredCount}/${expectedQuestions} câu`), 'partial', {
                  missingCount,
                  recoveredCount,
                  partialRawCount: rawNewQs.length,
                  partialAddedCount: newQs.length,
                  partialDuplicateCount,
                  partialAutoSkippedCount,
                  partialUnchangedCount,
                  expectedQuestions,
                });
              } else if (recoveredCount > 0) {
                console.log(`✅ Batch ${batchLabel}: Recovered ${recoveredCount}/${missingCount} missing question(s) from partial salvage.`);
              }
            } else if (depth === 0) {
              recordBatchFailure(index, batchLabel, new Error(`Thiếu ${missingCount}/${expectedQuestions} câu`), 'partial', {
                missingCount,
                recoveredCount: 0,
                partialRawCount: rawNewQs.length,
                partialAddedCount: newQs.length,
                partialDuplicateCount,
                partialAutoSkippedCount,
                partialUnchangedCount,
                expectedQuestions,
              });
            }
          }

          if (
            salvagedPartial &&
            !hasReliableExpectedCount &&
            rawNewQs.length > 0 &&
            part.sourceMode === 'pdfVision' &&
            !part.partialRecovery &&
            !part.deferredRecovery &&
            depth === 0 &&
            part.pdfDataUrl &&
            getPdfVisionRangePageCount(part.trace?.pageRange) > 1
          ) {
            (part as any).tailRecoveryAttempted = true;
            const recoveryParts = await buildPdfVisionRecoveryParts(part, rawNewQs, 1, 1, 'tailFirst');
            if (recoveryParts.length > 0) {
              console.info(`Batch ${batchLabel}: PDF Vision partial không có expected count; thử tail rescue 1 range cuối để tìm câu bị cắt mà không ép đủ số lượng.`);
              const unknownTailPolicy: RecoveryPolicy = { ...recoveryPolicy, maxRecoveryRequests: 1 };
              const recoveryPartLimit = getImmediateRecoveryPartLimit(unknownTailPolicy);
              const { immediateParts, deferredParts } = splitRecoveryPartsForImmediateRun(recoveryParts, recoveryPartLimit);

              const beforeRecoveryCount = allQuestions.length;
              if (immediateParts.length > 0) {
                await runPartsWithLimit(
                  immediateParts,
                  getSplitConcurrencyLimit(),
                  (recoveryPart, i) => processBatch(recoveryPart, index, depth + 1, true, topLevelIndex, i, batchLabel)
                );
              }

              if (deferredParts.length > 0) {
                enqueueDeferredRecovery({
                  index,
                  topLevelIndex,
                  label: batchLabel,
                  stage: 'partial',
                  parts: deferredParts,
                  missingCount: 1,
                  expectedQuestions: 0,
                  expectedQuestionsReliable: false,
                  beforeCoverageCount: getBatchCoveredQuestionCount(topLevelIndex + 1),
                  reasonError: isKeyConservationActive() ? createProviderPressureDeferredError() : undefined,
                  forceJsonRepair: true,
                  depth: depth + 1,
                });
              }

              if (allQuestions.length > beforeRecoveryCount) {
                (part as any).aiVerifierCalled = false;
              }
              const afterTailAssessment = await evaluatePdfVisionCoverageGate(part);
              if (afterTailAssessment.status === 'complete') {
                clearBatchFailure(topLevelBatchNumber, batchLabel, 'partial');
                skippedBatchSet.add(topLevelBatchNumber);
                console.info(`✅ Batch ${batchLabel}: Tail coverage verifier xác nhận đủ sau rescue nhẹ (${afterTailAssessment.validCoveredCount}/${afterTailAssessment.expectedCount}).`);
              }
            }
          }

          if (
            isTargetedRetryBatch &&
            depth === 0 &&
            !hasReliableExpectedCount &&
            !salvagedPartial &&
            newQs.length === 0
          ) {
            recordBatchFailure(index, batchLabel, new Error(`Quét lại Batch ${batchLabel} không thêm được câu mới và chưa có số câu kỳ vọng đáng tin để xác minh đã đủ.`), 'rescue', {
              recoveredCount: 0,
              partialRawCount: rawNewQs.length,
              partialAddedCount: newQs.length,
              partialDuplicateCount,
              partialAutoSkippedCount,
              partialUnchangedCount,
              expectedQuestions,
            });
            console.info(`Batch ${batchLabel}: Quét lại không thêm câu mới (${partialStats}); giữ batch trong danh sách quét lại vì chưa xác minh đủ.`);
          }

          const advisoryExpectedNumbers = Array.isArray(part.expectedQuestionEvidence?.numbers)
            && (part.expectedQuestionEvidence.confidence === 'medium' || part.expectedQuestionEvidence.confidence === 'high')
            ? part.expectedQuestionEvidence.numbers.filter((value: number) => Number.isFinite(value) && value > 0)
            : [];
          if (
            advisoryExpectedNumbers.length > 0 &&
            part.sourceMode === 'pdfVision' &&
            !part.partialRecovery &&
            !part.deferredRecovery &&
            !salvagedPartial &&
            depth === 0 &&
            part.pdfDataUrl
          ) {
            const recoveredNumbers = new Set(rawNewQs.map((question: MCQ) => question.trace?.questionNumber).filter((value): value is number => Number.isFinite(value)));
            const missingAdvisoryNumbers = advisoryExpectedNumbers.filter((questionNumber: number) => !recoveredNumbers.has(questionNumber));
            if (missingAdvisoryNumbers.length > 0) {
              const beforeRecoveryCount = getBatchCoveredQuestionCount(topLevelBatchNumber);
              (part as any).tailRecoveryAttempted = true;
              const recoveryParts = await buildPdfVisionRecoveryParts(part, rawNewQs, missingAdvisoryNumbers.length, Math.max(1, recoveryPolicy.maxRecoveryRequests || 1), 'tailFirst');
              if (recoveryParts.length > 0) {
                console.info(`Batch ${batchLabel}: PDF Vision advisory markers còn thiếu câu ${missingAdvisoryNumbers.join(', ')}; chạy targeted boundary rescue.`);
                await runPartsWithLimit(
                  recoveryParts.map((recoveryPart) => ({
                    ...recoveryPart,
                    expectedQuestionEvidence: {
                      ...recoveryPart.expectedQuestionEvidence,
                      numbers: missingAdvisoryNumbers,
                      count: missingAdvisoryNumbers.length,
                    },
                    existingQuestionFingerprints: buildSeenQuestionFingerprints(rawNewQs),
                  })),
                  getSplitConcurrencyLimit(),
                  (recoveryPart, i) => processBatch(recoveryPart, index, depth + 1, true, topLevelIndex, i, batchLabel)
                );
              }
              const afterRecoveryCount = getBatchCoveredQuestionCount(topLevelBatchNumber);
              const recoveredCount = getRecoveredMissingQuestionCount(beforeRecoveryCount, afterRecoveryCount, missingAdvisoryNumbers.length);
              if (recoveredCount < missingAdvisoryNumbers.length) {
                recordBatchFailure(index, batchLabel, new Error(`PDF Vision chưa xác minh được marker câu ${missingAdvisoryNumbers.join(', ')} sau targeted rescue.`), 'partial', {
                  missingCount: missingAdvisoryNumbers.length,
                  recoveredCount,
                  partialRawCount: rawNewQs.length,
                  partialAddedCount: newQs.length,
                  partialDuplicateCount,
                  partialAutoSkippedCount,
                  partialUnchangedCount,
                  expectedQuestions: advisoryExpectedNumbers.length,
                });
              }
            }
          }

          return true;
        };
        handlePostprocessResultForPartial = handlePostprocessResult;

        const postprocessResult: BatchPostprocessResult = await (isOpenAICompatibleRuntime(runtimeSettings)
          ? executeWithUserRotation(
              extractionModel,
              async (currentKey, activeModel, attemptContext) => {
                  const isRescueOrRetry = isRescueMode || isTargetedRetryBatch || part.partialRecovery || part.deferredRecovery;
                  const instructionToUse = isRescueOrRetry ? SYSTEM_INSTRUCTION_RESCUE : SYSTEM_INSTRUCTION_EXTRACT;
                  const finalInstruction = runtimeSettings.customPrompt ? `${runtimeSettings.customPrompt}\n\n${instructionToUse}` : instructionToUse;

                  const messages = [
                    { role: "system", content: (isAdvancedMode || forceJsonRepair) ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction },
                    { role: "user", content: [{ type: "text", text: scanPrompt }, ...toOpenAIContentFromPart(part)] }
                  ];

                  const text = await callOpenAICompatibleProvider(runtimeSettings, activeModel, messages, true, {
                    apiKeyOverride: currentKey,
                    signal: attemptContext.signal,
                    timeoutMs: attemptContext.timeoutMs,
                  });
                  const postprocessResult = await batchPostprocessor!.processBatch(createPostprocessInput(text));
                  return { ...postprocessResult, usedApiKey: currentKey };
              }
              ,
              undefined,
              stableFallbackModel,
              retryProfile,
              controller
            )
          : executeWithUserRotation(
              extractionModel,
              async (currentKey, activeModel, attemptContext) => {
                  if (!activeModel.startsWith('gemini-')) throw new Error(mismatchMessage || getProviderModelMismatchMessage('google', activeModel) || `MODEL_PROVIDER_MISMATCH: ${activeModel}`);
                  const aiInstance = createGoogleGenAIClient(runtimeSettings, currentKey);
                  const isRescueOrRetry = isRescueMode || isTargetedRetryBatch || part.partialRecovery || part.deferredRecovery;
                  const instructionToUse = isRescueOrRetry ? SYSTEM_INSTRUCTION_RESCUE : SYSTEM_INSTRUCTION_EXTRACT;
                  const finalInstruction = runtimeSettings.customPrompt ? `${runtimeSettings.customPrompt}\n\n${instructionToUse}` : instructionToUse;
                  // Cache key bao gồm cả modelName để tránh dùng cache của model cũ khi fallback
                  const cacheSessionKey = `${hashApiKey(currentKey)}_${activeModel}`;
                   const hasInlineVisionInput = Boolean(part.inlineData) || (Array.isArray(part.inlineDataParts) && part.inlineDataParts.length > 0);
                  const enableCaching = runtimeSettings.enableContextCaching === true;
                  if (!part.text && !hasInlineVisionInput && !sessionCache[cacheSessionKey] && enableCaching) {
                    sessionCache[cacheSessionKey] = (async () => {
                      try {
                        return await getOrSetContextCache(aiInstance, files, activeModel, finalInstruction, currentKey, {
                          allowCreate: !isGoogleRpmLimiterEnabled(runtimeSettings),
                        });
                      } catch { return null; }
                    })();
                  }
                  const kCacheName = part.text || hasInlineVisionInput || !enableCaching ? null : await sessionCache[cacheSessionKey];
                  const activeProfile = getModelTokenProfile(runtimeSettings.provider, activeModel);
                  const config = getModelConfig(currentKey, (isAdvancedMode || forceJsonRepair) ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction, questionSchema, activeModel, kCacheName || undefined, activeProfile.safeOutputBudget, {
                    timeoutMs: attemptContext.timeoutMs,
                    signal: attemptContext.signal,
                    baseUrl: getGoogleRuntimeBaseUrl(runtimeSettings),
                  });
                  const chat = aiInstance.chats.create(config);
                  const batchPrompt = kCacheName ? `${sourceInstruction}\n\nDựa trên tài liệu đã cache, hãy trích xuất thêm trắc nghiệm cho Phần ${batchLabel}.` : scanPrompt;
                  
                  const resultStream = await chat.sendMessageStream({ message: buildGoogleBatchMessage(part, batchPrompt, kCacheName || undefined) });
                  
                  let fullText = '';
                  let lastStreamHeartbeatAt = getNowMs();

                  try {
                      for await (const chunk of resultStream) {
                          const chunkText = chunk.text || '';
                          fullText += chunkText;
                          const now = getNowMs();
                          if (onProgress && now - lastStreamHeartbeatAt >= 1000) {
                              lastStreamHeartbeatAt = now;
                              const receivedKb = Math.max(1, Math.round(fullText.length / 1024));
                              onProgress(`Quét Batch ${batchLabel}/${totalBatches}${depth > 0 ? ' (Đang chia nhỏ)' : ''}... đã nhận ${receivedKb}KB`, allQuestions.length);
                          }
                      }
                  } catch (streamError: any) {
                      if (fullText.trim()) {
                          streamError.partialText = fullText;
                          console.warn(`Batch ${batchLabel}: Stream interrupted after receiving ${Math.round(fullText.length / 1024)}KB; will try to salvage complete questions before retry/split.`);
                      }
                      throw streamError;
                  }

                  const postprocessResult = await batchPostprocessor!.processBatch(createPostprocessInput(fullText));
                  return { ...postprocessResult, usedApiKey: currentKey };
              },
              batchStartingKey, // Per-batch key assignment
              stableFallbackModel,
              retryProfile,
              controller,
              getGoogleRequestRateLimitOptions(runtimeSettings)
            )
        );

        const handledPostprocess = await handlePostprocessResult(postprocessResult);
        if (
          !handledPostprocess &&
          isTargetedRetryBatch &&
          depth === 0 &&
          !hasReliableExpectedCount
        ) {
          recordBatchFailure(index, batchLabel, new Error(`Quét lại Batch ${batchLabel} trả rỗng và chưa có số câu kỳ vọng đáng tin để xác minh đã đủ.`), 'rescue', {
            recoveredCount: 0,
            partialRawCount: 0,
            partialAddedCount: 0,
            partialDuplicateCount: 0,
            partialAutoSkippedCount: 0,
            partialUnchangedCount: 0,
            expectedQuestions,
          });
          console.info(`Batch ${batchLabel}: Quét lại trả rỗng; giữ batch trong danh sách quét lại vì chưa xác minh đủ.`);
        }
      } catch (e: any) {
        const errorKind = classifyBatchError(e);
        const batchDecision = getRetryDecision(e, retryProfile);
        const expectedQuestions = part.sourceMode === 'pdfVision'
          ? (part.expectedQuestions || 0)
          : (part.expectedQuestions || getNativeBatchExpectedCount(part.text || ''));
        const recoveryPolicy = getRecoveryPolicyForPart(part, expectedQuestions, runtimeSettings.mainBatchOnlyRescue);
        const partialText = typeof e?.partialText === 'string' ? e.partialText : '';
        if (partialText.trim() && createPostprocessInputForPartial && handlePostprocessResultForPartial) {
          try {
            const partialPostprocessResult = await batchPostprocessor!.processBatch(createPostprocessInputForPartial(partialText));
            if (partialPostprocessResult.rawQuestions.length > 0) {
              console.info(`Batch ${batchLabel}: Interrupted response parsed; post-processing partial salvage now.`);
              const handledPartial = await handlePostprocessResultForPartial(partialPostprocessResult, e);
              if (handledPartial) return;
            }
          } catch (partialError) {
            console.warn(`Batch ${batchLabel}: Partial response salvage could not finish; continuing with normal retry/split path.`, partialError);
          }
        }

        if (
          errorKind === 'empty' &&
          recoveryPolicy.eligibility === 'weak' &&
          batchDecision.cause !== 'requestTooLarge'
        ) {
          console.info(`Batch ${batchLabel}: Empty response accepted because local MCQ evidence is weak (${recoveryPolicy.reason}).`);
          return;
        }

        if (
          part.sourceMode === 'pdfVision' &&
          !part.partialRecovery &&
          part.pdfDataUrl &&
          depth === 0 &&
          isKeyConservationActive() &&
          recoveryPolicy.shouldSplitEmpty &&
          recoveryPolicy.maxRecoveryRequests > 0 &&
          shouldSplitForError(errorKind)
        ) {
          const missingCount = Math.max(1, expectedQuestions || getAdvisoryPdfExpectedCount(part) || 1);
          const recoveryParts = await buildPdfVisionRecoveryParts(part, [], missingCount, recoveryPolicy.maxRecoveryRequests);
          if (recoveryParts.length > 0) {
            console.info(`Batch ${batchLabel}: Hoãn cứu PDF Vision vì provider đang bị giới hạn/quá tải; sẽ cứu tuần tự sau cooldown.`);
            enqueueDeferredRecovery({
              index,
              topLevelIndex,
              label: batchLabel,
              stage: 'split',
              parts: recoveryParts,
              missingCount,
              expectedQuestions,
              expectedQuestionsReliable: recoveryPolicy.expectedCountReliable,
              beforeCoverageCount: getBatchCoveredQuestionCount(topLevelIndex + 1),
              reasonError: e,
              forceJsonRepair: true,
              depth: depth + 1,
            });
            return;
          }
        }

        if (
          part.sourceMode === 'pdfVision' &&
          !part.partialRecovery &&
          part.pdfDataUrl &&
          depth === 0 &&
          recoveryPolicy.shouldSplitEmpty &&
          recoveryPolicy.maxRecoveryRequests > 0 &&
          shouldSplitForError(errorKind)
        ) {
          const missingCount = Math.max(1, expectedQuestions || getAdvisoryPdfExpectedCount(part) || 1);
          const recoveryParts = await buildPdfVisionRecoveryParts(part, [], missingCount, recoveryPolicy.maxRecoveryRequests);
          if (recoveryParts.length > 0) {
            console.info(`🔎 PDF Vision batch ${batchLabel} returned ${errorKind}. Retrying with high-quality overlapping page ranges...`);
            await runPartsWithLimit(
              recoveryParts,
              getSplitConcurrencyLimit(),
              (recoveryPart, i) => processBatch(recoveryPart, index, depth + 1, true, topLevelIndex, i, batchLabel)
            );
            return;
          }
        }

        if (part.sourceMode === 'docxImage' && !forceJsonRepair && recoveryPolicy.eligibility !== 'weak' && (errorKind === 'empty' || errorKind === 'format')) {
          console.info(`🔎 DOCX image batch ${batchLabel} returned empty/invalid. Retrying once with stricter Vision prompt...`);
          await processBatch(part, index, depth, true, topLevelIndex, subIndex, labelPrefix);
          return;
        }

        if (!forceJsonRepair && recoveryPolicy.eligibility !== 'weak' && batchDecision.cause !== 'requestTooLarge' && depth === 0 && errorKind === 'format') {
          console.info(`🔧 Batch ${batchLabel} format failed. Retrying full batch with strict JSON repair before splitting...`);
          await processBatch(part, index, depth, true, topLevelIndex, subIndex, labelPrefix);
          return;
        }

        if (adaptiveBatching && forceJsonRepair && depth === 0 && errorKind === 'format' && expectedQuestions > 20) {
          adaptiveLargeBatchFailures++;
          if (adaptiveLargeBatchFailures >= 2 && adaptiveQuestionCap > 20) {
            adaptiveQuestionCap = 20;
            console.info('🛡️ Adaptive batching cap lowered to 20 questions for remaining batches after repeated format failures.');
          }
        }

        const canAttemptSubdivision = !part.deferredRecovery && depth < retryProfile.maxDepth;
        const canUseRecoverySubdivision = recoveryPolicy.shouldSplitEmpty || batchDecision.cause === 'requestTooLarge';
        const nativeParts = part.nativeMcqBatch && canAttemptSubdivision && canUseRecoverySubdivision && shouldSplitForError(errorKind)
          ? getNativePartBatches(part.text || '', adaptiveBatching && forceJsonRepair ? 2 : retryProfile.targetSplitParts)
          : [];
        const canSplitText = canAttemptSubdivision && canUseRecoverySubdivision && part.text && part.sourceMode !== 'pdfVision' && part.text.length > retryProfile.splitThresholdChars && shouldSplitForError(errorKind);
        if (
          isKeyConservationActive() &&
          batchDecision.cause !== 'requestTooLarge' &&
          shouldSplitForError(errorKind) &&
          depth === 0 &&
          canUseRecoverySubdivision &&
          recoveryPolicy.maxRecoveryRequests > 0
        ) {
          const splitPartsCount = adaptiveBatching && forceJsonRepair ? 2 : retryProfile.targetSplitParts;
          const parts = (nativeParts.length > 1
            ? nativeParts.map(text => ({ ...part, text, expectedQuestions: getNativeBatchExpectedCount(text) }))
            : canSplitText
            ? splitTextIntoNaturalParts(part.text, splitPartsCount, retryProfile.splitThresholdChars)
              .map(text => ({ ...part, text }))
            : []
          ).filter(p => p.text?.trim().length > 0);
          const budgetedParts = parts.slice(0, recoveryPolicy.maxRecoveryRequests);

          if (budgetedParts.length > 0) {
            console.info(`Batch ${batchLabel}: Hoãn chia nhỏ vì provider đang bị giới hạn/quá tải; sẽ cứu tuần tự sau cooldown.`);
            enqueueDeferredRecovery({
              index,
              topLevelIndex,
              label: batchLabel,
              stage: 'split',
              parts: budgetedParts,
              missingCount: Math.max(1, expectedQuestions || parts.length),
              expectedQuestions,
              expectedQuestionsReliable: recoveryPolicy.expectedCountReliable,
              beforeCoverageCount: getBatchCoveredQuestionCount(topLevelIndex + 1),
              reasonError: e,
              forceJsonRepair: true,
              depth: depth + 1,
            });
          } else {
            recordBatchFailure(index, batchLabel, e, 'split');
          }
          return;
        }
        if (nativeParts.length > 1 || canSplitText) {
          const splitPartsCount = adaptiveBatching && forceJsonRepair ? 2 : retryProfile.targetSplitParts;
          console.info(`🚀 Batch ${batchLabel} fail (${errorKind}). Triggering NATURAL-SUBDIVISION (${splitPartsCount} parts, Depth ${depth + 1})...`);
          const progressBeforeSplit = allQuestions.length + allDuplicates.length + autoSkippedCount;
          const parts = (nativeParts.length > 1
            ? nativeParts.map(text => ({ ...part, text, expectedQuestions: getNativeBatchExpectedCount(text) }))
            : splitTextIntoNaturalParts(part.text, splitPartsCount, retryProfile.splitThresholdChars)
              .map(text => ({ ...part, text }))
          ).filter(p => p.text.trim().length > 0)
            .slice(0, batchDecision.cause === 'requestTooLarge' ? Number.POSITIVE_INFINITY : Math.max(1, recoveryPolicy.maxRecoveryRequests));

          await runPartsWithLimit(parts, getSplitConcurrencyLimit(), (p, i) => processBatch(p, index, depth + 1, false, topLevelIndex, i, batchLabel));
          const progressAfterSplit = allQuestions.length + allDuplicates.length + autoSkippedCount;
          if (depth === 0 && progressAfterSplit === progressBeforeSplit && !failedBatches.includes(index + 1)) {
            recordBatchFailure(index, batchLabel, e, 'split');
          }
          return;
        }

        const isServerBusyError = batchDecision.cause === 'softRateLimit' || batchDecision.cause === 'serverBusy';
        if (isServerBusyError && !part.deferredRecovery) {
          console.warn(`⚠️ Batch ${batchLabel} tạm lỗi (${errorKind}); đưa vào danh sách cứu hộ trì hoãn.`);
          // Deferred recovery must not re-enqueue itself while provider pressure is active.
          // missingCount fallback to 1 to NEVER silently discard rate-limited batches
          const safeMissingCount = Math.max(1, expectedQuestions || 1);
          enqueueDeferredRecovery({
            index,
            topLevelIndex,
            label: batchLabel,
            stage: 'partial',
            parts: [{ ...part, deferredRecovery: true }],
            missingCount: safeMissingCount,
            expectedQuestions,
            expectedQuestionsReliable: recoveryPolicy.expectedCountReliable,
            beforeCoverageCount: getBatchCoveredQuestionCount(topLevelIndex + 1),
            reasonError: e,
            forceJsonRepair: true,
            depth: 0,
          });
          return;
        }

        console.error(`❌ Batch ${batchLabel} FAILED after all retries & sub-batching (${errorKind}):`, e);
        if (depth === 0 || part.deferredRecovery) {
          recordBatchFailure(topLevelIndex, batchLabel, e, part.deferredRecovery ? 'deferred' : (isRescueMode ? 'rescue' : 'normal'));
        }
        if (onProgress) {
          const detail = describeBatchError(e, retryProfile.name);
          const subInfo = depth > 0 ? ` (Phần ${batchLabel})` : '';
          onProgress(`⚠️ Batch ${depth === 0 ? batchLabel : index + 1}${subInfo} gặp sự cố: ${detail.message}. Đang tìm cách xử lý...`, allQuestions.length);
        }
      } finally {
        if (depth === 0) {
          if (!failedBatches.includes(index + 1)) {
            skippedBatchSet.add(index + 1);
          }
          const completedBatchIndices = Array.from(skippedBatchSet).sort((a, b) => a - b);
          const phaseCompletedCount = getPhaseCompletedCount(completedBatchIndices);
          const now = Date.now();
          const shouldEmitCheckpoint = (
            phaseCompletedCount >= totalBatches ||
            phaseCompletedCount - lastCheckpointCompletedCount >= checkpointBatchInterval ||
            (checkpointIntervalMs > 0 && now - lastCheckpointAt >= checkpointIntervalMs) ||
            failedBatches.includes(index + 1)
          );
          if (shouldEmitCheckpoint) {
            emitCheckpoint(index + 1, completedBatchIndices, phaseCompletedCount >= totalBatches || failedBatches.includes(index + 1));
          }
        }
        if (isRescueMode && depth === 0 && !failedBatches.includes(index + 1)) rescueCompleted++;
      }
    };

    const runDeferredRecoveryQueue = async () => {
      if (deferredRecoveryQueue.length === 0) return;
      const shouldHoldDeferredForPressure = (
        shouldHoldDeferredRecoveryForPressure(
          runtimeSettings.provider,
          userKeyRotator.hasRecentProviderPressure(KEY_CONSERVATION_PRESSURE_WINDOW_MS),
          deferredRecoveryQueue.length
        )
      );
      if (shouldHoldDeferredForPressure) {
        if (onProgress) {
          onProgress(`Provider đang nóng; giữ ${deferredRecoveryQueue.length} phần cứu hộ để quét lại sau thay vì tạo thêm request.`, allQuestions.length);
        }
        while (deferredRecoveryQueue.length > 0) {
          const item = deferredRecoveryQueue.shift()!;
          const topLevelBatchNumber = item.topLevelIndex + 1;
          const currentCoveredCount = getBatchCoveredQuestionCount(topLevelBatchNumber);
          recordBatchFailure(item.index, item.label, item.reasonError || createProviderPressureDeferredError(), item.stage, {
            missingCount: item.missingCount,
            recoveredCount: currentCoveredCount,
            expectedQuestions: item.expectedQuestions,
          });
        }
        return;
      }

      const cooldownDelay = runtimeSettings.provider === 'google'
        ? userKeyRotator.getNextCooldownDelayMs()
        : 0;
      const needsProviderSettle = cooldownDelay > 0 || isKeyConservationActive();
      const settleMs = needsProviderSettle
        ? Math.min(
            Math.max(cooldownDelay, DEFERRED_RECOVERY_MIN_SETTLE_MS),
            retryProfile.singleKeyBackoffCapMs
          )
        : 0;
      if (settleMs > 0 && onProgress) {
        onProgress(`Đang chờ provider hạ nhiệt ${Math.round(settleMs / 1000)}s để cứu ${deferredRecoveryQueue.length} phần thiếu...`, allQuestions.length);
      }
      if (settleMs > 0) {
        await waitWithController(settleMs, controller);
      }

      while (deferredRecoveryQueue.length > 0) {
        await controller?.waitIfPaused();
        const item = deferredRecoveryQueue.shift()!;
        const topLevelBatchNumber = item.topLevelIndex + 1;
        const beforeDeferredCount = getBatchCoveredQuestionCount(topLevelBatchNumber);
        const hasReliableCount = item.expectedQuestionsReliable && typeof item.expectedQuestions === 'number' && item.expectedQuestions > 0;

        if (hasReliableCount) {
          const expectedCount = item.expectedQuestions;
          if (beforeDeferredCount >= expectedCount) {
            clearBatchFailure(topLevelBatchNumber, item.label, item.stage);
            skippedBatchSet.add(topLevelBatchNumber);
            console.log(`✅ Batch ${item.label}: Đã thu hoạch đầy đủ ${beforeDeferredCount}/${expectedCount} câu từ các phần khác. Bỏ qua cứu hộ trì hoãn.`);
            continue;
          }

          const currentMissingCount = Math.max(1, expectedCount - beforeDeferredCount);
          const recoveryBudgetKey = item.recoveryBudgetKey || `deferred-batch-${topLevelBatchNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          recoveryBudgets.set(recoveryBudgetKey, currentMissingCount);

          let deferredAttempt = 0;
          let afterDeferredCount = beforeDeferredCount;
          while (deferredAttempt <= DEFERRED_RECOVERY_MAX_RETRIES) {
            if (deferredAttempt > 0) {
              const retrySettleMs = Math.min(3000 * deferredAttempt, retryProfile.singleKeyBackoffCapMs);
              console.info(`🔄 Batch ${item.label}: Deferred recovery lần ${deferredAttempt + 1}/${DEFERRED_RECOVERY_MAX_RETRIES + 1}, chờ ${Math.round(retrySettleMs / 1000)}s...`);
              if (onProgress) {
                onProgress(`Đang thử lại cứu Batch ${item.label} lần ${deferredAttempt + 1} sau ${Math.round(retrySettleMs / 1000)}s...`, allQuestions.length);
              }
              await waitWithController(retrySettleMs, controller);
            } else if (onProgress) {
              onProgress(`Đang cứu phần thiếu Batch ${item.label} sau cooldown (${item.parts.length} phần, chạy tuần tự)...`, allQuestions.length);
            }

            const attemptBudgetKey = `${recoveryBudgetKey}-attempt${deferredAttempt}`;
            const currentMissingAfterRetries = Math.max(1, expectedCount - getBatchCoveredQuestionCount(topLevelBatchNumber));
            recoveryBudgets.set(attemptBudgetKey, currentMissingAfterRetries);

            await runPartsWithLimit(
              item.parts.map((recoveryPart) => ({
                ...recoveryPart,
                deferredRecovery: true,
                recoveryBudgetKey: attemptBudgetKey,
              })),
              1,
              (recoveryPart, i) => processBatch(recoveryPart, item.index, item.depth, item.forceJsonRepair, item.topLevelIndex, i, item.label)
            );

            recoveryBudgets.delete(attemptBudgetKey);
            afterDeferredCount = getBatchCoveredQuestionCount(topLevelBatchNumber);
            if (afterDeferredCount >= expectedCount) break;
            deferredAttempt++;
          }

          recoveryBudgets.delete(recoveryBudgetKey);
          const actuallyRecovered = Math.max(0, afterDeferredCount - beforeDeferredCount);

          if (afterDeferredCount >= expectedCount) {
            clearBatchFailure(topLevelBatchNumber, item.label, item.stage);
            skippedBatchSet.add(topLevelBatchNumber);
            console.log(`✅ Batch ${item.label}: Cứu hộ trì hoãn thành công! Thu về thêm ${actuallyRecovered} câu (Tổng cộng đạt ${afterDeferredCount}/${expectedCount} câu).`);
          } else {
            recordBatchFailure(item.index, item.label, item.reasonError || new Error(`Thiếu ${expectedCount - afterDeferredCount}/${expectedCount} câu sau deferred recovery (${deferredAttempt + 1} lần thử)`), item.stage, {
              missingCount: expectedCount,
              recoveredCount: afterDeferredCount,
            });
            console.info(`Batch ${item.label}: Cứu hộ trì hoãn chỉ thu về thêm ${actuallyRecovered} câu sau ${deferredAttempt + 1} lần thử, vẫn còn thiếu ${expectedCount - afterDeferredCount}/${expectedCount} câu.`);
          }
        } else {
          // No reliable expected count (e.g. Scanned PDF or Vision-only without good text layer)
          // Run a conservative coverage gate first; if it cannot prove completeness, do one rescue pass only.
          if (item.parts[0]?.sourceMode === 'pdfVision') {
            const skippedByCoverage = await maybeSkipPdfVisionRetryByCoverage(item.parts[0], item.index, item.label, item.stage);
            if (skippedByCoverage) continue;
          }
          const limitedRecoveryParts = item.parts.slice(0, Math.max(1, item.missingCount || 1));
          if (onProgress) {
            onProgress(`Đang cứu Batch ${item.label} sau cooldown (${limitedRecoveryParts.length} phần, chạy tuần tự)...`, allQuestions.length);
          }

          await runPartsWithLimit(
            limitedRecoveryParts.map((recoveryPart) => ({
              ...recoveryPart,
              deferredRecovery: true,
            })),
            1,
            (recoveryPart, i) => processBatch(recoveryPart, item.index, item.depth, item.forceJsonRepair, item.topLevelIndex, i, item.label)
          );

          const afterDeferredCount = getBatchCoveredQuestionCount(topLevelBatchNumber);

          const actuallyRecovered = Math.max(0, afterDeferredCount - beforeDeferredCount);

          if (actuallyRecovered > 0) {
            if (item.parts[0]) {
              (item.parts[0] as any).aiVerifierCalled = false;
            }
            const assessment = item.parts[0]?.sourceMode === 'pdfVision'
              ? await evaluatePdfVisionCoverageGate(item.parts[0])
              : null;
            if (assessment?.status === 'complete') {
              clearBatchFailure(topLevelBatchNumber, item.label, item.stage);
              skippedBatchSet.add(topLevelBatchNumber);
              console.info(`✅ Batch ${item.label}: Cứu hộ trì hoãn thêm ${actuallyRecovered} câu và coverage verifier xác nhận đủ.`);
            } else {
              recordBatchFailure(item.index, item.label, item.reasonError || new Error(`Đã cứu thêm ${actuallyRecovered} câu nhưng chưa xác minh đủ vì không có số câu kỳ vọng đáng tin.`), item.stage, {
                recoveredCount: actuallyRecovered,
                ...(assessment ? toCoverageFailureExtras(assessment) : {}),
              });
              console.info(`Batch ${item.label}: Cứu hộ trì hoãn thu về thêm ${actuallyRecovered} câu nhưng chưa xác minh đủ; giữ batch trong danh sách quét lại.`);
            }
          } else {
            const assessment = item.parts[0]?.sourceMode === 'pdfVision'
              ? await evaluatePdfVisionCoverageGate(item.parts[0])
              : null;
            if (assessment?.status === 'complete') {
              clearBatchFailure(topLevelBatchNumber, item.label, item.stage);
              skippedBatchSet.add(topLevelBatchNumber);
              console.info(`✅ Batch ${item.label}: Deferred rescue không thêm câu mới vì coverage đã đủ theo verifier.`);
              continue;
            }
            recordBatchFailure(item.index, item.label, item.reasonError || new Error('Không thu hoạch được câu nào từ deferred recovery sau 1 lượt giới hạn'), item.stage, {
              missingCount: 1,
              recoveredCount: 0,
              ...(assessment ? toCoverageFailureExtras(assessment) : {}),
            });
            console.info(`Batch ${item.label}: Cứu hộ trì hoãn không thu hoạch thêm được câu nào sau 1 lượt giới hạn.`);
          }
        }
      }
    };

    const getProcessablePartIndexes = (): number[] => {
      const indexes: number[] = [];
      for (let i = 0; i < allParts.length; i++) {
        const batchNumber = i + 1;
        if (skippedBatchSet.has(batchNumber)) {
          // Chỉ log skip nếu không phải đang ở chế độ cứu hộ (để tránh log rác)
          if (!isRescueMode) console.debug(`[Skip] Batch ${batchNumber}: Đã hoàn thành từ trước.`);
          continue;
        }
        if (retryIndices && retryIndices.length > 0 && !retryIndices.includes(batchNumber)) continue;
        indexes.push(i);
      }
      return indexes;
    };

    const runTopLevelPartIndexes = async (partIndexes: number[], limitOverride?: number) => {
      const activePromises = new Set<Promise<void>>();
      for (const partIndex of partIndexes) {
        await controller?.waitIfPaused();
        const part = allParts[partIndex];
        if (retryIndices && retryIndices.includes(partIndex + 1)) {
          const expectedQuestions = part.sourceMode === 'pdfVision'
            ? (part.expectedQuestions || 0)
            : (part.expectedQuestions || getNativeBatchExpectedCount(part.text || ''));
          const recoveryPolicy = getRecoveryPolicyForPart(part, expectedQuestions, runtimeSettings.mainBatchOnlyRescue);
          const coverageAssessment = await evaluatePdfVisionCoverageGate(part);
          const skippedByCoverage = await maybeSkipPdfVisionRetryByCoverage(part, partIndex, String(partIndex + 1), 'rescue', coverageAssessment);
          if (skippedByCoverage) continue;
          if (
            shouldPreferTailFirstPdfVisionRetry(part, coverageAssessment, recoveryPolicy.expectedCountReliable) &&
            !(part as any).tailRecoveryAttempted
          ) {
            const handledByTailProbe = await runTailFirstPdfVisionProbe(part, partIndex, String(partIndex + 1), coverageAssessment);
            if (handledByTailProbe) continue;
          } else if ((part as any).tailRecoveryAttempted) {
            console.info(`Batch ${partIndex + 1}: Bypassing duplicate tail recovery probe (already attempted in main phase).`);
          }
        }
        const p = processBatch(part, partIndex);
        activePromises.add(p);
        void p.then(() => {
          activePromises.delete(p);
        });
        while (activePromises.size >= Math.max(1, limitOverride || getConcurrencyLimit())) {
          await Promise.race(Array.from(activePromises));
        }
      }
      await Promise.all(Array.from(activePromises));
    };

    const processablePartIndexes = getProcessablePartIndexes();
    const shouldDeprioritizeResumeRetries = (options.resumeMode || deprioritizedBatchSet.size > 0) && !(retryIndices && retryIndices.length > 0);
    const lateResumePartIndexes = shouldDeprioritizeResumeRetries
      ? processablePartIndexes.filter(partIndex => deprioritizedBatchSet.has(partIndex + 1))
      : [];
    const primaryPartIndexes = lateResumePartIndexes.length > 0
      ? processablePartIndexes.filter(partIndex => !deprioritizedBatchSet.has(partIndex + 1))
      : processablePartIndexes;

    if (lateResumePartIndexes.length > 0) {
      console.info(`Resume: deferring ${lateResumePartIndexes.length} previously failed batch(es) until fresh batches finish.`);
    }

    await runTopLevelPartIndexes(primaryPartIndexes);

    if (lateResumePartIndexes.length > 0) {
      if (isKeyConservationActive()) {
        if (onProgress) {
          onProgress(`Provider đang nóng; giữ ${lateResumePartIndexes.length} batch lỗi cũ để quét lại sau thay vì đốt key ngay.`, allQuestions.length);
        }
        lateResumePartIndexes.forEach((partIndex) => {
          const batchNumber = partIndex + 1;
          const error: any = new Error('503 Provider vẫn đang quá tải; batch lỗi cũ được giữ lại để quét sau.');
          error.statusCode = 503;
          recordBatchFailure(partIndex, String(batchNumber), error, 'rescue');
        });
      } else {
        if (onProgress) {
          onProgress(`Đang xử lý ${lateResumePartIndexes.length} batch lỗi cũ sau các batch mới (chạy tuần tự để bảo toàn key)...`, allQuestions.length);
        }
        await runTopLevelPartIndexes(lateResumePartIndexes, 1);
      }
    }

    await runDeferredRecoveryQueue();

    if (options.onCheckpoint) {
      const completedBatchIndices = Array.from(skippedBatchSet).sort((a, b) => a - b);
      if (getPhaseCompletedCount(completedBatchIndices) !== lastCheckpointCompletedCount) {
        emitCheckpoint(completedBatchIndices[completedBatchIndices.length - 1] || totalBatches, completedBatchIndices, true);
      }
    }

    const finalCompletedBatchIndices = Array.from(skippedBatchSet).sort((a, b) => a - b);
    const finalSnapshot = buildCheckpointSnapshot(finalCompletedBatchIndices);
    const finalQuestions = finalSnapshot.questionsSnapshot;
    const finalDuplicates = finalSnapshot.duplicatesSnapshot;
    const finalAutoSkippedCount = finalSnapshot.autoSkippedCount;

    if (finalQuestions.length > 1) {
      const numCache = new Map<any, number>();
      const getNum = (q: any) => {
        let num = numCache.get(q);
        if (num === undefined) {
          num = extractQuestionNumber(q.question) ?? 999999;
          numCache.set(q, num);
        }
        return num;
      };
      finalQuestions.sort((a, b) => getNum(a) - getNum(b));
    }

    failedBatches = Array.from(new Set(failedBatches)).sort((a, b) => a - b);
    failedBatchDetails = failedBatchDetails.sort((a, b) => a.index - b.index || a.label.localeCompare(b.label));

    batchPostprocessor?.dispose();
    batchPostprocessor = null;
    console.log(`\n📊 FINAL: ${finalQuestions.length} questions. Auto-skipped: ${finalAutoSkippedCount}. Failed Batches: ${failedBatches.join(', ') || 'None'}`, failedBatchDetails);
    return { questions: finalQuestions, duplicates: finalDuplicates, failedBatches, failedBatchDetails, autoSkippedCount: finalAutoSkippedCount };

  } catch (error: any) {
    batchPostprocessor?.dispose();
    throw new Error(translateErrorForUser(error, 'Trích xuất'));
  }
};
