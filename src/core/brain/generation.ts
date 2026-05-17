import { GoogleGenAI } from "@google/genai";
import { UploadedFile, ProgressCallback, BatchCallback, AppSettings, MCQ, DuplicateInfo, BatchFailureInfo, BatchFailureDiagnostics, SourceTrace } from "../../types";
import { coerceModelForProvider, coerceModelForProviderInput, getModelTokenProfile, getProviderFallbackModel, getProviderModelMismatchMessage } from '../../utils/models';
import { analyzePdfTextLayer, convertPdfToImages, countPdfQuestionMarkers, splitPdfRangeForVisionRecovery } from '../../utils/pdfProcessor';
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
  applyTrustedSourceMetadata,
  buildSourceSnippet,
  estimateTextTokens,
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
import { BatchPostprocessInput, BatchPostprocessResult, applySharedCaseMetadata } from './batchPostprocess';
import { createBatchPostprocessor } from './batchPostprocessor';
import { createStreamingPreviewParser } from './streamingPreviewParser';
import {
  translateErrorForUser,
} from './providerErrors';
import {
  callOpenAICompatibleProvider,
  isOpenAICompatibleProvider,
  toOpenAIContentFromPart,
} from './openAiProvider';
import {
  buildGoogleBatchMessage,
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
  extractQuestionNumber,
  GenerateQuestionsOptions,
  partsRequireVision,
  waitWithController,
} from './generationHelpers';
import { SYSTEM_INSTRUCTION_EXTRACT } from './prompts';
import { hasRecentSlowMetrics, measureSync } from '../../utils/performance';

const STREAM_PREVIEW_PARSE_INTERVAL_MS = 400;
const STREAM_PREVIEW_LONG_TASK_MS = 80;
const STREAM_PREVIEW_MAX_BATCH_EMITS = 120;
const FULL_CHECKPOINT_INTERVAL_MS = 30000;
const KEY_CONSERVATION_PRESSURE_WINDOW_MS = 60 * 1000;
const MAX_IMMEDIATE_RECOVERY_PARTS = 3;
const DEFERRED_RECOVERY_MIN_SETTLE_MS = 1000;

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

  completedBatchNumbers
    .slice()
    .sort((a, b) => a - b)
    .forEach((batchNumber) => {
      questionList.push(...(batchQuestions.get(batchNumber) || []));
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
  maxRecoveryRequests: number;
  reason: string;
  shouldRecoverMissing: boolean;
  shouldSplitEmpty: boolean;
}

const OPTION_MARKER_PATTERN = /(?:^|\n)\s*(?:[A-Ha-h]|[①-⑧])[\).:\-]\s+\S/g;

export const countOptionMarkersForRecoveryEvidence = (text: string = ''): number => (
  String(text || '').match(OPTION_MARKER_PATTERN)?.length || 0
);

export const isGoogleKeyConservationActive = (
  provider: AppSettings['provider'],
  hasRecentProviderPressure: boolean
): boolean => provider === 'google' && hasRecentProviderPressure;

export const getRecoveryPolicyForPart = (
  part: any,
  expectedQuestions: number = 0,
  mainBatchOnlyRescue: boolean = false
): RecoveryPolicy => {
  if (mainBatchOnlyRescue) {
    return {
      allowEmpty: true,
      eligibility: 'weak',
      maxRecoveryRequests: 0,
      reason: 'main-batch-only-enforced',
      shouldRecoverMissing: false,
      shouldSplitEmpty: false,
    };
  }

  const text = String(part?.text || '');
  const isVision = part?.sourceMode === 'pdfVision';
  const isSuspect = Boolean(part?.textLayerSuspect);
  const nativeExpectedCount = isVision ? 0 : getNativeBatchExpectedCount(text);
  const expectedCount = Math.max(0, Number(expectedQuestions || part?.expectedQuestions || nativeExpectedCount || 0));
  const questionMarkerCount = isSuspect ? 0 : countPdfQuestionMarkers(text);
  const optionMarkerCount = isSuspect ? 0 : countOptionMarkersForRecoveryEvidence(text);
  const hasStructuredEvidence = expectedCount > 0 && (
    Boolean(part?.nativeMcqBatch) ||
    Boolean(part?.structuredMcqBatch) ||
    part?.sourceMode === 'pdfText' ||
    nativeExpectedCount > 0
  );

  if (hasStructuredEvidence) {
    return {
      allowEmpty: false,
      eligibility: 'strong',
      maxRecoveryRequests: 3,
      reason: 'structured-count',
      shouldRecoverMissing: true,
      shouldSplitEmpty: true,
    };
  }

  if (part?.sourceMode === 'pdfVision') {
    const hasMediumEvidence = expectedCount > 0 ||
      (!isSuspect && (
        questionMarkerCount > 0 ||
        optionMarkerCount >= 3
      ));
    if (hasMediumEvidence) {
      return {
        allowEmpty: false,
        eligibility: 'medium',
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
    const retryProfile = getRetryProfile(options.retryProfile || (isAdvancedMode ? 'rescue' : 'normal'));
    const isRescueMode = retryProfile.name === 'rescue';
    const controller = options.controller;
    const requestedConcurrency = Math.max(1, runtimeSettings.concurrencyLimit || 1);
    
    userKeyRotator.init(runtimeSettings.apiKey, requestedConcurrency);
    
    // Tải trạng thái sức khỏe key từ DB sau khi init để không bị resetState làm mất dữ liệu
    const savedHealth = await db.getKeyHealth();
    if (savedHealth) userKeyRotator.importHealthState(savedHealth);
    const adaptiveBatching = runtimeSettings.adaptiveBatching !== false;
    const tokenProfile = getModelTokenProfile(runtimeSettings.provider, runtimeSettings.model);
    let adaptiveQuestionCap = getStructuredQuestionBatchSize(tokenProfile, adaptiveBatching);
    let adaptiveLargeBatchFailures = 0;
    const visionPagesPerChunk = getAdaptiveVisionPagesPerChunk(tokenProfile, adaptiveBatching);
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
          const pdfTextAnalysis = await analyzePdfTextLayer(pdfDataUrl, visionPagesPerChunk, 1, adaptiveQuestionCap);
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
                expectedQuestions: batch.expectedQuestions,
              });
            });
          }

          const visionRanges = pdfTextAnalysis.visionPageRanges;
          if (visionRanges.length > 0) {
            if (onProgress) onProgress(`PDF hybrid: ${pdfTextAnalysis.textBatches.length} batch text, ${visionRanges.length} batch Vision.`, 0);
            if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
              for (const range of visionRanges) {
                const images = await convertPdfToImages(pdfDataUrl, range);
                const sourceLabel = joinSourceLabel(file.name, formatPageRangeLabel(range));
                const rangePages = pdfTextAnalysis.pages.slice(range.start - 1, range.end);
                const rangeText = rangePages.map((page) => page.text).join('\n\n');
                
                // Only count expected questions if the pages have good text layer quality!
                const allPagesGoodText = rangePages.length > 0 && rangePages.every((page) => page.quality === 'goodText');
                const expectedQuestions = allPagesGoodText ? countPdfQuestionMarkers(rangeText) : 0;
                
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
                  trace: buildTrace(file, sourceLabel, 'pdfVision', { pageRange: range }, rangeText),
                  textLayerSuspect: !allPagesGoodText,
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
                
                // Only count expected questions if the pages have good text layer quality!
                const allPagesGoodText = rangePages.length > 0 && rangePages.every((page) => page.quality === 'goodText');
                const expectedQuestions = allPagesGoodText ? countPdfQuestionMarkers(rangeText) : 0;

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
                  trace: buildTrace(file, sourceLabel, 'pdfVision', { pageRange: range }, rangeText),
                  textLayerSuspect: !allPagesGoodText,
                  ...(expectedQuestions > 0 ? { expectedQuestions } : {}),
                });
              });
            }
          }
        } catch (splitError) {
          console.info('PDF safe hybrid fallback to legacy vision:', splitError);
          const legacyRanges = getPdfPageRanges(await getPdfPageCount(rawBase64), visionPagesPerChunk, 1);
          if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
            for (const range of legacyRanges) {
              const images = await convertPdfToImages(pdfDataUrl, range);
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
                trace: buildTrace(file, sourceLabel, 'pdfVision', { pageRange: range }),
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
                trace: buildTrace(file, sourceLabel, 'pdfVision', { pageRange: range }),
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
            allParts.push({
              text: `[TÀI LIỆU DOCX ${file.nativeText?.trim() ? 'NATIVE' : 'STRUCTURED'}: "${file.name}" (Nhóm ${batchIndex + 1}/${docxBatches.length})]\n\n${text}`,
              nativeMcqBatch: true,
              sourceLabel,
              trace: buildTrace(file, sourceLabel, 'docxText', { batchIndex: batchIndex + 1 }, text),
              expectedQuestions: getNativeBatchExpectedCount(text),
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
            allParts.push({
              text: `[TÀI LIỆU DOCX ${file.nativeText?.trim() ? 'NATIVE' : 'STRUCTURED'}: "${file.name}" (Nhóm ${batchIndex + 1}/${docxBatches.length})]\n\n${text}`,
              nativeMcqBatch: true,
              sourceLabel,
              trace: buildTrace(file, sourceLabel, 'docxText', { batchIndex: batchIndex + 1 }, text),
              expectedQuestions: getNativeBatchExpectedCount(text),
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

    if (isOpenAICompatibleProvider(runtimeSettings.provider)) {
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
    const skippedBatchSet = new Set([
      ...(options.completedBatchIndices || []),
      ...inferredCompletedBatchIndices,
    ]);
    const deprioritizedBatchSet = new Set<number>(
      (options.deprioritizedBatchIndices || [])
        .filter((batchNumber) => Number.isFinite(batchNumber) && batchNumber > 0)
        .map((batchNumber) => Math.floor(batchNumber))
    );
    const inferredOnlyBatchIndices = inferredCompletedBatchIndices.filter(
      index => !(options.completedBatchIndices || []).includes(index)
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
      beforeCoverageCount: number;
      recoveryBudgetKey?: string;
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

    const recordBatchFailure = (index: number, label: string, error: any, stage: BatchFailureInfo['stage'], extras: Partial<Pick<BatchFailureInfo, 'missingCount' | 'recoveredCount' | 'diagnostics'>> = {}) => {
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
      if (!failedBatches.includes(batchNumber)) failedBatches.push(batchNumber);
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
      const hasVision = allParts.some(p => p.sourceMode === 'pdfVision' || p.sourceMode === 'image');
      if (hasVision) return 1;
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

    const enqueueDeferredRecovery = (item: DeferredRecoveryItem) => {
      if (item.parts.length === 0 || item.missingCount <= 0) return;
      deferredRecoveryQueue.push(item);
      recordBatchFailure(item.index, item.label, new Error(`Thiếu ${item.missingCount}/${item.expectedQuestions || '?'} câu; đang chờ provider hạ nhiệt để cứu phần thiếu.`), item.stage, {
        missingCount: item.missingCount,
        recoveredCount: 0,
      });
      console.info(`Batch ${item.label}: Queued ${item.parts.length} deferred recovery part(s) after provider pressure/limit.`);
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

    const buildPdfVisionRecoveryParts = async (
      part: any,
      salvagedQuestions: Array<{ question?: string }>,
      missingCount: number,
      maxParts: number = Number.POSITIVE_INFINITY
    ): Promise<any[]> => {
      const sourceRange = part.trace?.pageRange;
      if (part.sourceMode !== 'pdfVision' || !part.pdfDataUrl || !sourceRange) return [];
      if (maxParts <= 0) return [];

      const ranges = splitPdfRangeForVisionRecovery(sourceRange);
      const existingQuestionFingerprints = buildSeenQuestionFingerprints(salvagedQuestions);
      const fileName = part.pdfFileName || part.trace?.fileName || getTrustedSourceLabel(part).split('|')[0] || 'PDF';
      const recoveryParts: any[] = [];

      for (const range of ranges) {
        if (recoveryParts.length >= maxParts) break;
        const rangeText = getPdfVisionRangeText(part, range);
        const expectedFromText = countPdfQuestionMarkers(rangeText);
        
        // Only enforce expectedQuestions in recovery if parent had a reliable count!
        const parentHasReliableCount = typeof part.expectedQuestions === 'number' && part.expectedQuestions > 0;
        const expectedQuestions = parentHasReliableCount 
          ? Math.max(1, Math.min(missingCount, expectedFromText || missingCount))
          : 0;

        const images = await convertPdfToImages(part.pdfDataUrl, range, { quality: 'high' });
        const sourceLabel = joinSourceLabel(fileName, formatPageRangeLabel(range));
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
            pageRange: range,
            snippet: buildSourceSnippet(rangeText),
          },
          expectedQuestions,
          partialRecovery: true,
          recoveryAttemptedFromPartial: true,
          forceMissingOnly: true,
          existingQuestionFingerprints,
          pdfVisionQuality: 'high',
        });
      }

      return recoveryParts;
    };

    // Hàm xử lý Batch chính có khả năng Đệ quy (Subdivision)
    const processBatch = async (part: any, index: number, depth: number = 0, forceJsonRepair: boolean = false, topLevelIndex: number = index, subIndex: number = 0, labelPrefix: string = `${index + 1}`) => {
      const batchLabel = depth === 0 ? labelPrefix : `${labelPrefix}${String.fromCharCode(96 + depth)}.${subIndex + 1}`;

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
        if (adaptiveBatching && canAttemptSubdivision && part.text && currentScale <= 0.5 && part.text.length > (retryProfile.splitThresholdChars * 2)) {
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
        const topLevelBatchNumber = topLevelIndex + 1;
        const recoveryBudgetKey = typeof part.recoveryBudgetKey === 'string' ? part.recoveryBudgetKey : '';
        const createPostprocessInput = (fullText: string): BatchPostprocessInput => ({
          allowEmpty: recoveryPolicy.allowEmpty,
          batchIndex: index,
          duplicateCounterStart: duplicateCounter,
          expectedQuestions,
          fullText,
          partMeta: {
            sourceLabel: part.sourceLabel,
            text: part.text,
            trace: part.trace,
          },
          recoveryBudgetRemaining: recoveryBudgetKey ? (recoveryBudgets.get(recoveryBudgetKey) || 0) : null,
          topLevelBatchNumber,
        });
        const sourceInstruction = `SOURCE_LABEL: ${getTrustedSourceLabel(part)}\nBắt buộc trường "source" của mọi câu hỏi trong batch này phải copy y nguyên SOURCE_LABEL. CHỈ được trích xuất câu hỏi nằm trong đúng SOURCE_LABEL của batch hiện tại. Nếu tài liệu/cache còn chứa phần khác, bỏ qua hoàn toàn các câu ngoài phạm vi SOURCE_LABEL này dù nội dung rất giống. Không tự bịa tên đề, năm, chương, trang, file đáp án hoặc nguồn khác.`;
        const structuredSourceLabel = part.sourceMode === 'pdfText' ? 'PDF TEXT STRUCTURED' : 'DOCX';
        const hasStructuredExpectedBlocks = expectedQuestions > 0 && (part.nativeMcqBatch || part.structuredMcqBatch || part.sourceMode === 'pdfText');
        const repairInstruction = forceJsonRepair
          ? 'LƯU Ý SỬA JSON: Lần trước batch này bị lỗi định dạng hoặc thiếu câu. Hãy trả về JSON hợp lệ tuyệt đối, đóng đủ mọi ngoặc, không markdown, không giải thích ngoài JSON.'
          : '';
        const partialRecoveryInstruction = part.partialRecovery
          ? `LƯU Ý CỨU PHẦN THIẾU: Đây là lượt quét lại có chọn lọc. Chỉ trả về những câu còn thiếu/chưa có trong danh sách đã lưu. Nếu nội dung dưới đây trùng với câu đã lưu, bỏ qua và không tạo bản sao.${part.existingQuestionFingerprints ? `\nCác câu đã lưu để tránh lặp:\n${part.existingQuestionFingerprints}` : ''}`
          : '';
        const nativePrompt = hasStructuredExpectedBlocks
          ? `NỘI DUNG ${structuredSourceLabel} ĐÃ ĐƯỢC TÁCH SẴN THÀNH ${expectedQuestions} BLOCK CÂU. Mỗi block <<<MCQ n>>> là đúng 1 câu hoặc 1 mục câu hỏi trong tài liệu. Option có ký hiệu ✅ là đáp án đúng lấy từ marker trong tài liệu; TUYỆT ĐỐI không đổi đáp án này. Nếu block có A/B/C/D thì trích đúng các lựa chọn đó. Nếu block chỉ có Question và Answer/Notes, hãy giữ nguyên câu hỏi, dùng Answer/Notes làm đáp án/giải thích, và chỉ tạo lựa chọn nhiễu khi tài liệu không cung cấp đủ options. Hãy trả về ĐÚNG ${expectedQuestions} câu theo cùng thứ tự, không bỏ câu nào.`
          : '';
        const imagePrompt = part.sourceMode === 'docxImage'
          ? `${part.docxImageLabel || '[DOCX IMAGE]'}\nẢnh này được nhúng trong file Word và CÓ THỂ chứa câu hỏi trắc nghiệm. Hãy phóng to/đọc kỹ toàn bộ chữ trong ảnh. Nếu ảnh chứa MCQ, hãy trích xuất đầy đủ mọi câu hỏi, lựa chọn và đáp án nếu nhìn thấy. ${forceJsonRepair ? 'Lần trước ảnh này trả rỗng hoặc lỗi; chỉ trả {"questions":[]} nếu bạn chắc chắn ảnh hoàn toàn không có câu hỏi trắc nghiệm.' : 'Nếu ảnh chỉ là minh họa và KHÔNG chứa câu hỏi trắc nghiệm, hãy trả về chính xác {"questions":[]}.'}`
          : '';
        const visionPrompt = (part.sourceMode === 'pdfVision' || part.inlineData || (Array.isArray(part.inlineDataParts) && part.inlineDataParts.length > 0))
          ? `[CHỈ THỊ QUAN TRỌNG CHO PHẦN ẢNH/VISION]: Tài liệu hiện tại đang được xử lý ở chế độ quét Vision (ảnh chụp/PDF scan). Hãy đọc cực kỳ chậm và tỉ mỉ từng dòng, từng góc của trang ảnh này. Hãy đếm thầm xem có chính xác bao nhiêu câu hỏi trắc nghiệm (MCQ) xuất hiện trên trang. Bạn phải trích xuất ĐẦY ĐỦ TRĂM PHẦN TRĂM câu hỏi, không được bỏ sót bất kỳ câu nào dù là câu ngắn, câu tình huống hay câu ở cuối trang. Đọc theo thứ tự trang từ trên xuống dưới; chú ý câu ở cuối trang, bảng, layout 2 cột và lựa chọn nằm sát mép.${part.sourceMode === 'pdfVision' && expectedQuestions > 0 ? ` Text layer gợi ý có khoảng ${expectedQuestions} câu trong phạm vi này; nếu thấy khác, hãy ưu tiên đọc ảnh thật kỹ nhưng không được bỏ sót câu đã có marker.` : ''}${part.pdfVisionQuality === 'high' ? ' Đây là lượt cứu thiếu với ảnh nét hơn và phạm vi nhỏ hơn; chỉ trả các câu còn thiếu/chưa có trong danh sách đã lưu.' : ''}`
          : '';
        const extractionCommand = part.partialRecovery
          ? `CHỈ TRÍCH XUẤT CÁC CÂU CÒN THIẾU trong phần cứu này. Không trả lại câu đã có, không mở rộng ra ngoài block/trang được cung cấp (Phần ${batchLabel}).`
          : `HÃY QUÉT TOÀN BỘ NỘI DUNG TÀI LIỆU NÀY. Trích xuất TẤT CẢ câu hỏi trắc nghiệm tìm thấy (Phần ${batchLabel}).`;
        const scanPrompt = `${repairInstruction ? `${repairInstruction}\n\n` : ''}${partialRecoveryInstruction ? `${partialRecoveryInstruction}\n\n` : ''}${sourceInstruction}\n\n${nativePrompt ? `${nativePrompt}\n\n` : ''}${imagePrompt ? `${imagePrompt}\n\n` : ''}${visionPrompt ? `${visionPrompt}\n\n` : ''}${extractionCommand}`;

        const postprocessResult: BatchPostprocessResult = await (isOpenAICompatibleProvider(runtimeSettings.provider)
          ? executeWithUserRotation(
              extractionModel,
              async (currentKey, activeModel, attemptContext) => {
                  const finalInstruction = runtimeSettings.customPrompt ? `${runtimeSettings.customPrompt}\n\n${SYSTEM_INSTRUCTION_EXTRACT}` : SYSTEM_INSTRUCTION_EXTRACT;

                  const messages = [
                    { role: "system", content: (isAdvancedMode || forceJsonRepair) ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction },
                    { role: "user", content: [{ type: "text", text: scanPrompt }, ...toOpenAIContentFromPart(part)] }
                  ];

                  const text = await callOpenAICompatibleProvider(runtimeSettings, activeModel, messages, true, {
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
                  const aiInstance = new GoogleGenAI({ apiKey: currentKey });
                  const finalInstruction = runtimeSettings.customPrompt ? `${runtimeSettings.customPrompt}\n\n${SYSTEM_INSTRUCTION_EXTRACT}` : SYSTEM_INSTRUCTION_EXTRACT;
                  // Cache key bao gồm cả modelName để tránh dùng cache của model cũ khi fallback
                  const cacheSessionKey = `${hashApiKey(currentKey)}_${activeModel}`;
                  const hasInlineVisionInput = Boolean(part.inlineData) || (Array.isArray(part.inlineDataParts) && part.inlineDataParts.length > 0);
                  if (!part.text && !hasInlineVisionInput && !sessionCache[cacheSessionKey]) {
                    sessionCache[cacheSessionKey] = (async () => {
                      try { return await getOrSetContextCache(aiInstance, files, activeModel, finalInstruction, currentKey); } catch { return null; }
                    })();
                  }
                  const kCacheName = part.text || hasInlineVisionInput ? null : await sessionCache[cacheSessionKey];
                  const activeProfile = getModelTokenProfile(runtimeSettings.provider, activeModel);
                  const config = getModelConfig(currentKey, (isAdvancedMode || forceJsonRepair) ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction, questionSchema, activeModel, kCacheName || undefined, activeProfile.safeOutputBudget, {
                    timeoutMs: attemptContext.timeoutMs,
                    signal: attemptContext.signal,
                  });
                  const chat = aiInstance.chats.create(config);
                  const batchPrompt = kCacheName ? `${sourceInstruction}\n\nDựa trên tài liệu đã cache, hãy trích xuất thêm trắc nghiệm cho Phần ${batchLabel}.` : scanPrompt;
                  
                  const resultStream = await chat.sendMessageStream({ message: buildGoogleBatchMessage(part, batchPrompt, kCacheName || undefined) });
                  
                  let fullText = '';
                  const currentBatchIndex = topLevelIndex + 1;
                  const streamingPreviewParser = options.onPartialQuestions ? createStreamingPreviewParser() : null;
                  let lastPreviewParseAt = -STREAM_PREVIEW_PARSE_INTERVAL_MS;
                  let emittedPreviewCount = 0;
                  let disablePreviewForBatch = false;
                  let previewFlushPromise: Promise<void> | null = null;
                  let pendingPreviewFlush = false;
                  let lastStreamHeartbeatAt = getNowMs();
                  const disableStreamingPreview = () => {
                      if (disablePreviewForBatch) return;
                      disablePreviewForBatch = true;
                      streamingPreviewParser?.dispose();
                  };

                  const emitPreviewQuestions = (previewQuestions: any[]) => {
                      if (!options.onPartialQuestions || previewQuestions.length === 0) return;
                      applyTrustedSourceMetadata(previewQuestions, part);
                      applySharedCaseMetadata(previewQuestions, part);
                      previewQuestions.forEach((q) => {
                         if (!q.id) q.id = `mcq-stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                      });
                      emittedPreviewCount += previewQuestions.length;
                      options.onPartialQuestions(previewQuestions, currentBatchIndex);
                  };
                  const requestPreviewFlush = () => {
                      if (!streamingPreviewParser || disablePreviewForBatch) return;
                      if (previewFlushPromise) {
                          pendingPreviewFlush = true;
                          return;
                      }
                      const startedAt = getNowMs();
                      previewFlushPromise = streamingPreviewParser.flush()
                        .then((previewQuestions) => {
                            const elapsed = getNowMs() - startedAt;
                            emitPreviewQuestions(previewQuestions);
                            if (
                              elapsed > STREAM_PREVIEW_LONG_TASK_MS ||
                              emittedPreviewCount >= STREAM_PREVIEW_MAX_BATCH_EMITS ||
                              hasRecentSlowMetrics({ sinceMs: 4000, threshold: 3, includeLongTasks: true })
                            ) {
                              disableStreamingPreview();
                            }
                        })
                        .catch(() => {
                            disableStreamingPreview();
                        })
                        .finally(() => {
                            previewFlushPromise = null;
                            if (pendingPreviewFlush && !disablePreviewForBatch) {
                                pendingPreviewFlush = false;
                                requestPreviewFlush();
                            }
                        });
                  };

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

                          if (streamingPreviewParser && !disablePreviewForBatch) {
                              if (
                                emittedPreviewCount >= STREAM_PREVIEW_MAX_BATCH_EMITS ||
                                hasRecentSlowMetrics({ sinceMs: 4000, threshold: 3, includeLongTasks: true })
                              ) {
                                  disableStreamingPreview();
                                  continue;
                              }
                              streamingPreviewParser.append(chunkText);
                              if (now - lastPreviewParseAt >= STREAM_PREVIEW_PARSE_INTERVAL_MS) {
                                  lastPreviewParseAt = now;
                                  requestPreviewFlush();
                              }
                          }
                      }

                      if (streamingPreviewParser && !disablePreviewForBatch) {
                          requestPreviewFlush();
                          while (previewFlushPromise) await previewFlushPromise;
                      }
                  } finally {
                      streamingPreviewParser?.dispose();
                  }

                  const postprocessResult = await batchPostprocessor!.processBatch(createPostprocessInput(fullText));
                  return { ...postprocessResult, usedApiKey: currentKey };
              },
              batchStartingKey, // Per-batch key assignment
              stableFallbackModel,
              retryProfile,
              controller
            )
        );

        if (postprocessResult.rawQuestions.length > 0) {
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

          if (salvagedPartial && missingCount > 0 && !part.deferredRecovery) {
            const missingRatio = expectedQuestions > 0 ? missingCount / expectedQuestions : 0;
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
                ? await buildPdfVisionRecoveryParts(part, rawNewQs, missingCount, recoveryPolicy.maxRecoveryRequests)
                : part.nativeMcqBatch
                ? buildPartialSalvageRecoveryParts(part, rawNewQs, missingCount <= 2 ? 1 : 2)
                : [{
                    ...part,
                    partialRecovery: true,
                    recoveryAttemptedFromPartial: true,
                    forceMissingOnly: true,
                    expectedQuestions: missingCount,
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
                    beforeCoverageCount: afterImmediateCount,
                    recoveryBudgetKey,
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
                });
              } else if (recoveredCount > 0) {
                console.log(`✅ Batch ${batchLabel}: Recovered ${recoveredCount}/${missingCount} missing question(s) from partial salvage.`);
              }
            } else if (depth === 0) {
              recordBatchFailure(index, batchLabel, new Error(`Thiếu ${missingCount}/${expectedQuestions} câu`), 'partial', {
                missingCount,
                recoveredCount: 0,
              });
            }
          }
        }
      } catch (e: any) {
        const errorKind = classifyBatchError(e);
        const batchDecision = getRetryDecision(e, retryProfile);
        const expectedQuestions = part.sourceMode === 'pdfVision'
          ? (part.expectedQuestions || 0)
          : (part.expectedQuestions || getNativeBatchExpectedCount(part.text || ''));
        const recoveryPolicy = getRecoveryPolicyForPart(part, expectedQuestions, runtimeSettings.mainBatchOnlyRescue);

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
          const missingCount = Math.max(1, expectedQuestions || countPdfQuestionMarkers(part.text || '') || 1);
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
              beforeCoverageCount: getBatchCoveredQuestionCount(topLevelIndex + 1),
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
          const missingCount = Math.max(1, expectedQuestions || countPdfQuestionMarkers(part.text || '') || 1);
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

        if (adaptiveBatching && !forceJsonRepair && recoveryPolicy.eligibility !== 'weak' && batchDecision.cause !== 'requestTooLarge' && depth === 0 && errorKind === 'format' && (expectedQuestions > 10 || estimateTextTokens(part.text || '') > 4000)) {
          console.info(`🔧 Batch ${batchLabel} format failed. Retrying once with strict JSON repair before splitting...`);
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
        const canSplitText = canAttemptSubdivision && canUseRecoverySubdivision && part.text && part.text.length > retryProfile.splitThresholdChars && shouldSplitForError(errorKind);
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
              beforeCoverageCount: getBatchCoveredQuestionCount(topLevelIndex + 1),
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
          console.warn(`⚠️ Batch ${batchLabel} tạm lỗi (${errorKind}) sau khi đã chia nhỏ; đưa vào danh sách cứu hộ trì hoãn.`);
          enqueueDeferredRecovery({
            index,
            topLevelIndex,
            label: batchLabel,
            stage: 'partial',
            parts: [part],
            missingCount: expectedQuestions || 1,
            expectedQuestions,
            beforeCoverageCount: getBatchCoveredQuestionCount(topLevelIndex + 1),
            forceJsonRepair: true,
            depth: depth + 1,
          });
          return;
        }

        console.error(`❌ Batch ${batchLabel} FAILED after all retries & sub-batching (${errorKind}):`, e);
        if (depth === 0) recordBatchFailure(index, batchLabel, e, isRescueMode ? 'rescue' : 'normal');
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
        const recoveryBudgetKey = item.recoveryBudgetKey || `deferred-batch-${topLevelBatchNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        recoveryBudgets.set(recoveryBudgetKey, item.missingCount);

        if (onProgress) {
          onProgress(`Đang cứu phần thiếu Batch ${item.label} sau cooldown (${item.parts.length} phần, chạy tuần tự)...`, allQuestions.length);
        }

        await runPartsWithLimit(
          item.parts.map((recoveryPart) => ({
            ...recoveryPart,
            deferredRecovery: true,
            recoveryBudgetKey,
          })),
          1,
          (recoveryPart, i) => processBatch(recoveryPart, item.index, item.depth, item.forceJsonRepair, item.topLevelIndex, i, item.label)
        );

        recoveryBudgets.delete(recoveryBudgetKey);
        const afterDeferredCount = getBatchCoveredQuestionCount(topLevelBatchNumber);
        const recoveredCount = getRecoveredMissingQuestionCount(item.beforeCoverageCount, afterDeferredCount, item.missingCount);
        const deferredOnlyRecoveredCount = getRecoveredMissingQuestionCount(beforeDeferredCount, afterDeferredCount, item.missingCount);

        if (recoveredCount >= item.missingCount) {
          clearBatchFailure(topLevelBatchNumber, item.label, item.stage);
          skippedBatchSet.add(topLevelBatchNumber);
          console.log(`✅ Batch ${item.label}: Deferred recovery rescued ${recoveredCount}/${item.missingCount} missing question(s).`);
        } else {
          recordBatchFailure(item.index, item.label, new Error(`Thiếu ${item.missingCount - recoveredCount}/${item.expectedQuestions || item.missingCount} câu sau deferred recovery`), item.stage, {
            missingCount: item.missingCount,
            recoveredCount,
          });
          console.info(`Batch ${item.label}: Deferred recovery added ${deferredOnlyRecoveredCount} question(s), still missing ${Math.max(0, item.missingCount - recoveredCount)}.`);
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
      const activePromises: Promise<void>[] = [];
      for (const partIndex of partIndexes) {
        await controller?.waitIfPaused();
        const p = processBatch(allParts[partIndex], partIndex);
        activePromises.push(p);
        while (activePromises.length >= Math.max(1, limitOverride || getConcurrencyLimit())) {
          const finishedIndex = await Promise.race(activePromises.map((p, idx) => p.then(() => idx)));
          activePromises.splice(finishedIndex, 1);
        }
      }
      await Promise.all(activePromises);
    };

    const processablePartIndexes = getProcessablePartIndexes();
    const shouldDeprioritizeResumeRetries = options.resumeMode && !(retryIndices && retryIndices.length > 0);
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
