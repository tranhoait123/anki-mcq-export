import { GoogleGenAI } from "@google/genai";
import { UploadedFile, ProgressCallback, BatchCallback, AppSettings, MCQ, DuplicateInfo, BatchFailureInfo, SourceTrace } from "../../types";
import { createDuplicateLookup } from '../../utils/dedupe';
import {
  applySharedCaseContextToQuestion,
  extractSharedCaseContexts,
  getSharedCaseContextForQuestion,
  hasSharedCaseStem,
} from '../../utils/sharedCaseContext';
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
import {
  parseQuestionsFromModelText,
  salvageCompleteQuestionsFromJson,
} from './parsing';
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
import { measureSync } from '../../utils/performance';

export const getRecoveredMissingQuestionCount = (
  beforeBatchCount: number,
  afterBatchCount: number,
  missingCount: number
): number => Math.min(Math.max(0, missingCount), Math.max(0, afterBatchCount - beforeBatchCount));

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
  try {
    const mismatchMessage = getProviderModelMismatchMessage(settings.provider, settings.model);
    let runtimeSettings = mismatchMessage ? { ...settings, model: coerceModelForProvider(settings.provider, settings.model) } : settings;
    const retryProfile = getRetryProfile(options.retryProfile || (isAdvancedMode ? 'rescue' : 'normal'));
    const isRescueMode = retryProfile.name === 'rescue';
    const controller = options.controller;
    const requestedConcurrency = Math.max(1, runtimeSettings.concurrencyLimit || 1);
    userKeyRotator.init(runtimeSettings.apiKey, requestedConcurrency);
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
                const expectedQuestions = countPdfQuestionMarkers(rangeText);
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
                const expectedQuestions = countPdfQuestionMarkers(rangeText);
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
                  ...(expectedQuestions > 0 ? { expectedQuestions } : {}),
                });
              });
            }
          }
        } catch (splitError) {
          console.warn('PDF safe hybrid fallback to legacy vision:', splitError);
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
    const inferredCompletedBatchIndices = options.resumeMode && !options.skipInferredCompletedBatches
      ? inferCompletedBatchIndicesFromExistingQuestions(allParts, options.existingQuestions || [])
      : [];
    const skippedBatchSet = new Set([
      ...(options.completedBatchIndices || []),
      ...inferredCompletedBatchIndices,
    ]);
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
    const recoveryBudgets = new Map<string, number>();
    const checkpointBatchInterval = Math.max(1, options.checkpointBatchInterval || 1);
    const checkpointIntervalMs = Math.max(0, options.checkpointIntervalMs || 0);
    const getPhaseCompletedCount = (completedBatchNumbers: number[]) => {
      const completedSet = new Set(completedBatchNumbers);
      return phaseBatchNumbers.filter(batchNumber => completedSet.has(batchNumber)).length;
    };
    let lastCheckpointCompletedCount = getPhaseCompletedCount(Array.from(skippedBatchSet));
    let lastCheckpointAt = Date.now();

    const appendBatchQuestions = (batchNumber: number, questions: MCQ[]) => {
      if (questions.length === 0) return;
      const current = batchQuestions.get(batchNumber) || [];
      batchQuestions.set(batchNumber, [...current, ...questions]);
    };

    const isSameTopLevelBatchDuplicate = (batchNumber: number, matchedData?: MCQ) => {
      if (!matchedData) return false;
      return (batchQuestions.get(batchNumber) || []).some(question => question.id === matchedData.id);
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

    const buildCheckpointSnapshot = (completedBatchNumbers: number[]) => (
      measureSync(`generation.buildCheckpointSnapshot(${completedBatchNumbers.length}/${totalTopLevelBatches})`, () => {
        const questionList = [...(options.existingQuestions || [])];
        const duplicateList = [...(options.existingDuplicates || [])];
        let safeAutoSkippedCount = options.existingAutoSkippedCount || 0;

        completedBatchNumbers
          .slice()
          .sort((a, b) => a - b)
          .forEach((batchNumber) => {
            questionList.push(...(batchQuestions.get(batchNumber) || []));
            duplicateList.push(...(batchDuplicates.get(batchNumber) || []));
            safeAutoSkippedCount += batchAutoSkipped.get(batchNumber) || 0;
          });

        questionList.sort((a, b) => {
          const numA = extractQuestionNumber(a.question) || 999999;
          const numB = extractQuestionNumber(b.question) || 999999;
          return numA - numB;
        });

        return {
          questionsSnapshot: questionList,
          duplicatesSnapshot: duplicateList,
          autoSkippedCount: safeAutoSkippedCount,
        };
      })
    );

    const emitCheckpoint = (batchIndex: number, completedBatchIndices: number[]) => {
      if (!options.onCheckpoint) return;
      const checkpointSnapshot = buildCheckpointSnapshot(completedBatchIndices);
      lastCheckpointCompletedCount = getPhaseCompletedCount(completedBatchIndices);
      lastCheckpointAt = Date.now();
      options.onCheckpoint({
        batchIndex,
        totalTopLevelBatches,
        completedBatchIndices,
        failedBatchIndices: Array.from(new Set(failedBatches)).sort((a, b) => a - b),
        failedBatchDetails: [...failedBatchDetails].sort((a, b) => a.index - b.index || a.label.localeCompare(b.label)),
        questionsSnapshot: checkpointSnapshot.questionsSnapshot,
        duplicatesSnapshot: checkpointSnapshot.duplicatesSnapshot,
        autoSkippedCount: checkpointSnapshot.autoSkippedCount,
        currentCount: checkpointSnapshot.questionsSnapshot.length,
      });
    };

    const recordBatchFailure = (index: number, label: string, error: any, stage: BatchFailureInfo['stage'], extras: Partial<Pick<BatchFailureInfo, 'missingCount' | 'recoveredCount'>> = {}) => {
      const batchNumber = index + 1;
      if (!failedBatches.includes(batchNumber)) failedBatches.push(batchNumber);
      if (failedBatchDetails.some(item => item.index === batchNumber && item.label === label && item.stage === stage)) return;
      const detail = describeBatchError(error, retryProfile.name);
      failedBatchDetails.push({
        index: batchNumber,
        label,
        kind: detail.kind,
        stage,
        message: detail.message,
        advice: detail.advice,
        ...extras,
      });
    };

    // --- STEP 2: BATCH PROCESSING ---
    const getConcurrencyLimit = () => (
      runtimeSettings.provider === 'google'
        ? userKeyRotator.getRecommendedConcurrency(requestedConcurrency)
        : requestedConcurrency
    );

    const totalBatches = totalTopLevelBatches;
    const stableFallbackModel = getProviderFallbackModel(runtimeSettings.provider);
    const extractionModel = isAdvancedMode || isRescueMode ? stableFallbackModel : runtimeSettings.model;

    const runPartsWithLimit = async <T,>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> => {
      const active: Promise<void>[] = [];
      for (const item of items) {
        await controller?.waitIfPaused();
        const p = worker(item);
        active.push(p);
        while (active.length >= Math.max(1, limit)) {
          const finishedIndex = await Promise.race(active.map((promise, idx) => promise.then(() => idx)));
          active.splice(finishedIndex, 1);
        }
      }
      await Promise.all(active);
    };

    const getSplitConcurrencyLimit = () => {
      if (isRescueMode || userKeyRotator.hasRecentProviderPressure()) return 1;
      return Math.max(1, Math.min(getConcurrencyLimit(), 2));
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
      missingCount: number
    ): Promise<any[]> => {
      const sourceRange = part.trace?.pageRange;
      if (part.sourceMode !== 'pdfVision' || !part.pdfDataUrl || !sourceRange) return [];

      const ranges = splitPdfRangeForVisionRecovery(sourceRange);
      const existingQuestionFingerprints = buildSeenQuestionFingerprints(salvagedQuestions);
      const fileName = part.pdfFileName || part.trace?.fileName || getTrustedSourceLabel(part).split('|')[0] || 'PDF';
      const recoveryParts: any[] = [];

      for (const range of ranges) {
        const rangeText = getPdfVisionRangeText(part, range);
        const expectedFromText = countPdfQuestionMarkers(rangeText);
        const expectedQuestions = Math.max(1, Math.min(missingCount, expectedFromText || missingCount));
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
    const processBatch = async (part: any, index: number, depth: number = 0, forceJsonRepair: boolean = false, topLevelIndex: number = index) => {
      const batchLabel = depth === 0 ? `${index + 1}` : `${index + 1}${String.fromCharCode(96 + depth)}`;

      try {
        await controller?.waitIfPaused();

        const expectedAtStart = part.expectedQuestions || getNativeBatchExpectedCount(part.text || '');
        if (adaptiveBatching && depth === 0 && part.nativeMcqBatch && expectedAtStart > adaptiveQuestionCap) {
          const cappedParts = splitStructuredPartByBatchSize(part, adaptiveQuestionCap);
          if (cappedParts.length > 1) {
            await runPartsWithLimit(cappedParts, getSplitConcurrencyLimit(), (p) => processBatch(p, index, depth + 1, forceJsonRepair, topLevelIndex));
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
        const isDocxImageBatch = part.sourceMode === 'docxImage';
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

        const rawNewQs = await (isOpenAICompatibleProvider(runtimeSettings.provider)
          ? executeWithUserRotation(
              extractionModel,
              async (dummyKey, activeModel) => {
                  const finalInstruction = runtimeSettings.customPrompt ? `${runtimeSettings.customPrompt}\n\n${SYSTEM_INSTRUCTION_EXTRACT}` : SYSTEM_INSTRUCTION_EXTRACT;

                  const messages = [
                    { role: "system", content: (isAdvancedMode || forceJsonRepair) ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction },
                    { role: "user", content: [{ type: "text", text: scanPrompt }, ...toOpenAIContentFromPart(part)] }
                  ];

                  const text = await callOpenAICompatibleProvider(runtimeSettings, activeModel, messages);
                  return parseQuestionsFromModelText(text, index, expectedQuestions, { allowEmpty: !isDocxImageBatch });
              }
              ,
              undefined,
              stableFallbackModel,
              retryProfile,
              controller
            )
          : executeWithUserRotation(
              extractionModel,
              async (currentKey, activeModel) => {
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
                  const config = getModelConfig(currentKey, (isAdvancedMode || forceJsonRepair) ? `${finalInstruction}\n\nLƯU Ý: Lần trích xuất trước bị lỗi định dạng. Hãy đảm bảo trả về JSON hợp lệ tuyệt đối.` : finalInstruction, questionSchema, activeModel, kCacheName || undefined, activeProfile.safeOutputBudget);
                  const chat = aiInstance.chats.create(config);
                  const batchPrompt = kCacheName ? `${sourceInstruction}\n\nDựa trên tài liệu đã cache, hãy trích xuất thêm trắc nghiệm cho Phần ${batchLabel}.` : scanPrompt;
                  
                  const resultStream = await chat.sendMessageStream({ message: buildGoogleBatchMessage(part, batchPrompt, kCacheName || undefined) });
                  
                  let fullText = '';
                  let reportedCount = 0;
                  const currentBatchIndex = topLevelIndex + 1;

                  for await (const chunk of resultStream) {
                      fullText += chunk.text;
                      
                      if (options.onPartialQuestions) {
                          const partialQs = salvageCompleteQuestionsFromJson(fullText, false);
                          if (partialQs.length > reportedCount) {
                              const newPartialQs = partialQs.slice(reportedCount);
                              reportedCount = partialQs.length;
                              applyTrustedSourceMetadata(newPartialQs, part);
                              newPartialQs.forEach((q, _i) => {
                                 if (!q.id) q.id = `mcq-stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                              });
                              // Báo cáo các câu hỏi vừa bóc tách được từ luồng dữ liệu (chưa lọc trùng ở bước này để UI có thể hiển thị nhanh nhất)
                              options.onPartialQuestions(newPartialQs, currentBatchIndex);
                          }
                      }
                  }

                  return parseQuestionsFromModelText(fullText, index, expectedQuestions, { allowEmpty: !isDocxImageBatch });
              },
              batchStartingKey, // Per-batch key assignment
              stableFallbackModel,
              retryProfile,
              controller
            )
        );

        if (rawNewQs && rawNewQs.length > 0) {
          const salvagedPartial = Boolean((rawNewQs as any).__salvagedPartial);
          const missingCount = Number((rawNewQs as any).__missingCount || 0);
          applyTrustedSourceMetadata(rawNewQs, part);
          const sharedCaseContexts = part.text ? extractSharedCaseContexts(part.text) : [];
          if (sharedCaseContexts.length > 0) {
            rawNewQs.forEach((q) => {
              if (!q || typeof q.question !== 'string') return;
              const context = getSharedCaseContextForQuestion(q.question, sharedCaseContexts);
              if (!context) return;
              const hadStem = hasSharedCaseStem(q.question, context.stem);
              q.question = applySharedCaseContextToQuestion(q.question, sharedCaseContexts);
              const hasStemAfter = hasSharedCaseStem(q.question, context.stem);
              if (!hadStem && hasStemAfter) {
                q.sharedCase = {
                  applied: true,
                  confidence: context.confidence,
                  stem: context.stem,
                  startQuestion: context.startQuestion,
                  endQuestion: context.endQuestion,
                  sourceLabel: part.sourceLabel,
                  pageRange: part.trace?.pageRange,
                };
              } else if (!hasStemAfter && q.explanation && typeof q.explanation.warning === 'string') {
                q.explanation.warning = `${q.explanation.warning ? `${q.explanation.warning}\n\n` : ''}⚠️ Câu này nằm trong nhóm có tình huống chung (${context.startQuestion}-${context.endQuestion}) nhưng app chưa ghép được stem chắc chắn. Cần kiểm tra lại nguồn.`.trim();
              }
            });
          }
          const newQs = [];
          const batchNewDuplicates: DuplicateInfo[] = [];
          let batchNewAutoSkipped = 0;
          const duplicateLookup = createDuplicateLookup<MCQ>(allQuestions);
          const recoveryBudgetKey = typeof part.recoveryBudgetKey === 'string' ? part.recoveryBudgetKey : '';
          for (const q of rawNewQs) {
            if (recoveryBudgetKey && (recoveryBudgets.get(recoveryBudgetKey) || 0) <= 0) break;
            const result = duplicateLookup.find(q);
            if (!result.isDup) {
              q.id = `mcq-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
              newQs.push(q);
              duplicateLookup.add(q);
              if (recoveryBudgetKey) {
                recoveryBudgets.set(recoveryBudgetKey, Math.max(0, (recoveryBudgets.get(recoveryBudgetKey) || 0) - 1));
              }
            } else {
              duplicateCounter++;
              const sameTopLevelBatchDuplicate = isSameTopLevelBatchDuplicate(topLevelIndex + 1, result.matchedData);
              // Chỉ thêm vào danh sách Review nếu độ trùng lặp < 98% (không phải auto-skip)
              if (!result.isAutoSkip) {
                if (sameTopLevelBatchDuplicate) continue;
                const duplicateInfo: DuplicateInfo = {
                  id: `dup-${Date.now()}-${duplicateCounter}`,
                  question: q.question.substring(0, 50),
                  reason: result.reason || 'Duplicate found',
                  matchedWith: result.matchedWith || result.matchedData?.question?.substring(0, 60) || 'Câu hỏi đã có',
                  fullData: q,
                  matchedData: result.matchedData,
                  score: result.score,
                  fieldScores: result.fieldScores,
                  evidence: result.evidence
                };
                allDuplicates.push(duplicateInfo);
                batchNewDuplicates.push(duplicateInfo);
              } else {
                if (sameTopLevelBatchDuplicate) continue;
                autoSkippedCount++;
                batchNewAutoSkipped++;
                console.log(`⏩ Auto-skipped identical MCQ (~100%): ${q.question.substring(0, 50)}...`);
              }
            }
          }

          if (newQs.length > 0) {
            allQuestions.push(...newQs);
            appendBatchQuestions(topLevelIndex + 1, newQs);
            if (onBatchComplete) onBatchComplete(newQs);
            console.log(`✅ Batch ${batchLabel}: Found ${newQs.length} questions.`);
          }
          appendBatchDuplicates(topLevelIndex + 1, batchNewDuplicates);
          incrementBatchAutoSkipped(topLevelIndex + 1, batchNewAutoSkipped);

          if (salvagedPartial && missingCount > 0) {
            const missingRatio = expectedQuestions > 0 ? missingCount / expectedQuestions : 0;
            const canRecoverPdfVision = part.sourceMode === 'pdfVision' && !part.partialRecovery && part.pdfDataUrl;
            if (missingRatio > 0.4 && !canRecoverPdfVision) {
              throw new Error(`AI_FORMAT_ERROR_PARTIAL_SALVAGE: Đã cứu ${rawNewQs.length} câu hợp lệ nhưng còn thiếu khoảng ${missingCount} câu (>${Math.round(missingRatio * 100)}%).`);
            } else if (!part.partialRecovery) {
              console.warn(`⚠️ Batch ${batchLabel}: Salvage lấy được ${rawNewQs.length}/${expectedQuestions} câu (thiếu ${missingCount}). Đang cứu chọn lọc phần thiếu.`);
              const topLevelBatchNumber = topLevelIndex + 1;
              const beforeRecoveryCount = (batchQuestions.get(topLevelBatchNumber) || []).length;
              const recoveryParts = canRecoverPdfVision
                ? await buildPdfVisionRecoveryParts(part, rawNewQs, missingCount)
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
                const recoveryBudgetKey = `batch-${topLevelBatchNumber}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                recoveryBudgets.set(recoveryBudgetKey, missingCount);
                await runPartsWithLimit(
                  recoveryParts.map((recoveryPart) => ({ ...recoveryPart, recoveryBudgetKey })),
                  getSplitConcurrencyLimit(),
                  (recoveryPart) => processBatch(recoveryPart, index, depth + 1, true, topLevelIndex)
                );
                recoveryBudgets.delete(recoveryBudgetKey);
              }

              const afterRecoveryCount = (batchQuestions.get(topLevelBatchNumber) || []).length;
              const recoveredCount = getRecoveredMissingQuestionCount(beforeRecoveryCount, afterRecoveryCount, missingCount);
              if (depth === 0 && recoveredCount < missingCount) {
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
        const expectedQuestions = part.expectedQuestions || getNativeBatchExpectedCount(part.text || '');
        if (part.sourceMode === 'pdfVision' && !part.partialRecovery && part.pdfDataUrl && depth === 0 && shouldSplitForError(errorKind)) {
          const missingCount = Math.max(1, expectedQuestions || countPdfQuestionMarkers(part.text || '') || 1);
          const recoveryParts = await buildPdfVisionRecoveryParts(part, [], missingCount);
          if (recoveryParts.length > 0) {
            console.warn(`🔎 PDF Vision batch ${batchLabel} returned ${errorKind}. Retrying with high-quality overlapping page ranges...`);
            await runPartsWithLimit(
              recoveryParts,
              getSplitConcurrencyLimit(),
              (recoveryPart) => processBatch(recoveryPart, index, depth + 1, true, topLevelIndex)
            );
            return;
          }
        }

        if (part.sourceMode === 'docxImage' && !forceJsonRepair && (errorKind === 'empty' || errorKind === 'format')) {
          console.warn(`🔎 DOCX image batch ${batchLabel} returned empty/invalid. Retrying once with stricter Vision prompt...`);
          await processBatch(part, index, depth, true, topLevelIndex);
          return;
        }

        if (adaptiveBatching && !forceJsonRepair && batchDecision.cause !== 'requestTooLarge' && depth === 0 && errorKind === 'format' && (expectedQuestions > 10 || estimateTextTokens(part.text || '') > 4000)) {
          console.warn(`🔧 Batch ${batchLabel} format failed. Retrying once with strict JSON repair before splitting...`);
          await processBatch(part, index, depth, true, topLevelIndex);
          return;
        }

        if (adaptiveBatching && forceJsonRepair && depth === 0 && errorKind === 'format' && expectedQuestions > 20) {
          adaptiveLargeBatchFailures++;
          if (adaptiveLargeBatchFailures >= 2 && adaptiveQuestionCap > 20) {
            adaptiveQuestionCap = 20;
            console.warn('🛡️ Adaptive batching cap lowered to 20 questions for remaining batches after repeated format failures.');
          }
        }

        const nativeParts = part.nativeMcqBatch && depth < retryProfile.maxDepth && shouldSplitForError(errorKind)
          ? getNativePartBatches(part.text || '', adaptiveBatching && forceJsonRepair ? 2 : retryProfile.targetSplitParts)
          : [];
        const canSplitText = depth < retryProfile.maxDepth && part.text && part.text.length > retryProfile.splitThresholdChars && shouldSplitForError(errorKind);
        if (nativeParts.length > 1 || canSplitText) {
          const splitPartsCount = adaptiveBatching && forceJsonRepair ? 2 : retryProfile.targetSplitParts;
          console.warn(`🚀 Batch ${batchLabel} fail (${errorKind}). Triggering NATURAL-SUBDIVISION (${splitPartsCount} parts, Depth ${depth + 1})...`);
          const progressBeforeSplit = allQuestions.length + allDuplicates.length + autoSkippedCount;
          const parts = (nativeParts.length > 1
            ? nativeParts.map(text => ({ ...part, text, expectedQuestions: getNativeBatchExpectedCount(text) }))
            : splitTextIntoNaturalParts(part.text, splitPartsCount, retryProfile.splitThresholdChars)
              .map(text => ({ ...part, text }))
          ).filter(p => p.text.trim().length > 0);

          await runPartsWithLimit(parts, getSplitConcurrencyLimit(), (p) => processBatch(p, index, depth + 1, false, topLevelIndex));
          const progressAfterSplit = allQuestions.length + allDuplicates.length + autoSkippedCount;
          if (depth === 0 && progressAfterSplit === progressBeforeSplit && !failedBatches.includes(index + 1)) {
            recordBatchFailure(index, batchLabel, e, 'split');
          }
          return;
        }

        console.error(`❌ Batch ${batchLabel} FAILED after all retries & sub-batching (${errorKind}):`, e);
        if (depth === 0) recordBatchFailure(index, batchLabel, e, isRescueMode ? 'rescue' : 'normal');
        if (onProgress) {
          const detail = describeBatchError(e, retryProfile.name);
          onProgress(`⚠️ Phần ${batchLabel} lỗi: ${detail.message}. Đang tiếp tục...`, allQuestions.length);
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
          if (shouldEmitCheckpoint) emitCheckpoint(index + 1, completedBatchIndices);
        }
        if (isRescueMode && depth === 0 && !failedBatches.includes(index + 1)) rescueCompleted++;
      }
    };

    const activePromises: Promise<void>[] = [];
    for (let i = 0; i < allParts.length; i++) {
      await controller?.waitIfPaused();
      if (skippedBatchSet.has(i + 1)) continue;

      // Nếu đang chạy chế độ Retry, chỉ xử lý những index có trong danh sách
      if (retryIndices && retryIndices.length > 0 && !retryIndices.includes(i + 1)) {
        continue;
      }

      const p = processBatch(allParts[i], i);
      activePromises.push(p);
      while (activePromises.length >= getConcurrencyLimit()) {
        const finishedIndex = await Promise.race(activePromises.map((p, idx) => p.then(() => idx)));
        activePromises.splice(finishedIndex, 1);
      }
    }
    await Promise.all(activePromises);

    if (options.onCheckpoint) {
      const completedBatchIndices = Array.from(skippedBatchSet).sort((a, b) => a - b);
      if (getPhaseCompletedCount(completedBatchIndices) !== lastCheckpointCompletedCount) {
        emitCheckpoint(completedBatchIndices[completedBatchIndices.length - 1] || totalBatches, completedBatchIndices);
      }
    }

    allQuestions.sort((a, b) => {
      const numA = extractQuestionNumber(a.question) || 999999;
      const numB = extractQuestionNumber(b.question) || 999999;
      return numA - numB;
    });

    failedBatches = Array.from(new Set(failedBatches)).sort((a, b) => a - b);
    failedBatchDetails = failedBatchDetails.sort((a, b) => a.index - b.index || a.label.localeCompare(b.label));

    console.log(`\n📊 FINAL: ${allQuestions.length} questions. Auto-skipped: ${autoSkippedCount}. Failed Batches: ${failedBatches.join(', ') || 'None'}`, failedBatchDetails);
    return { questions: allQuestions, duplicates: allDuplicates, failedBatches, failedBatchDetails, autoSkippedCount };

  } catch (error: any) {
    throw new Error(translateErrorForUser(error, 'Trích xuất'));
  }
};
