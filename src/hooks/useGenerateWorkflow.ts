import React from 'react';
import { toast } from 'sonner';
import {
  AnalysisResult,
  AppSettings,
  AuditResult,
  DuplicateInfo,
  MCQ,
  ProcessingController,
  UploadedFile,
} from '../types';
import { db } from '../core/db';
import { translateErrorForUser } from '../core/brain';
import { selectPreferredPhaseOutcome } from '../utils/resumeSession';
import { sortMcqsByQuestionNumber, summarizeBatchFailures } from '../utils/appHelpers';
import { RunGenerationPhaseParams, RunGenerationPhaseResult } from './useGenerationPhase';

interface UseGenerateWorkflowParams {
  analysis: AnalysisResult | null;
  clearProcessingController: () => void;
  clearResumeSession: () => Promise<void>;
  currentFilesRequireVision: () => boolean;
  deduplicateQuestions: (newList: MCQ[], existingList: MCQ[]) => MCQ[];
  duplicatesRef: React.MutableRefObject<DuplicateInfo[]>;
  files: UploadedFile[];
  getDetectedDocxMcqCount: () => number;
  getRequestSettings: (requiresVision?: boolean) => AppSettings;
  mcqsRef: React.MutableRefObject<MCQ[]>;
  ocrMode: 'gemini' | 'tesseract';
  prepareFiles: (
    forcedMode?: 'gemini' | 'tesseract',
    controller?: ProcessingController,
    runtimeSettings?: AppSettings
  ) => Promise<UploadedFile[]>;
  runAudit: (count: number, processedFiles?: UploadedFile[]) => Promise<void>;
  runGenerationPhase: (params: RunGenerationPhaseParams) => Promise<RunGenerationPhaseResult>;
  setAudit: React.Dispatch<React.SetStateAction<AuditResult | null>>;
  setCurrentCount: React.Dispatch<React.SetStateAction<number>>;
  setDuplicates: React.Dispatch<React.SetStateAction<DuplicateInfo[]>>;
  setFailedBatchIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setMcqs: React.Dispatch<React.SetStateAction<MCQ[]>>;
  setProgressStatus: React.Dispatch<React.SetStateAction<string>>;
  setRetryFailedAttempted: React.Dispatch<React.SetStateAction<boolean>>;
  setShowAudit: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDuplicates: React.Dispatch<React.SetStateAction<boolean>>;
  setVisibleMcqs: (items: MCQ[]) => Promise<MCQ[]>;
  startProcessingController: () => ProcessingController;
  validateProviderCredentials: (requestSettings: AppSettings) => boolean;
  waitWithController: (ms: number, controller?: ProcessingController) => Promise<void>;
  warnVisionRecommendedDocx: () => boolean;
  onGenerationComplete?: (payload: {
    files: UploadedFile[];
    mcqs: MCQ[];
    duplicates: DuplicateInfo[];
    analysis: AnalysisResult | null;
    settings: AppSettings;
  }) => Promise<void>;
}

export const useGenerateWorkflow = ({
  analysis,
  clearProcessingController,
  clearResumeSession,
  currentFilesRequireVision,
  deduplicateQuestions,
  duplicatesRef,
  files,
  getDetectedDocxMcqCount,
  getRequestSettings,
  mcqsRef,
  ocrMode,
  prepareFiles,
  runAudit,
  runGenerationPhase,
  setAudit,
  setCurrentCount,
  setDuplicates,
  setFailedBatchIndices,
  setLoading,
  setMcqs,
  setProgressStatus,
  setRetryFailedAttempted,
  setShowAudit,
  setShowDuplicates,
  setVisibleMcqs,
  startProcessingController,
  validateProviderCredentials,
  waitWithController,
  warnVisionRecommendedDocx,
  onGenerationComplete,
}: UseGenerateWorkflowParams) => {
  const handleGenerate = async () => {
    if (files.length === 0) return;
    if (warnVisionRecommendedDocx()) return;
    const requestSettings = getRequestSettings(currentFilesRequireVision());

    if (!validateProviderCredentials(requestSettings)) return;

    await clearResumeSession();
    setLoading(true);
    setCurrentCount(0);
    setProgressStatus("Đang chuẩn bị xử lý...");
    setMcqs([]);
    mcqsRef.current = [];
    await db.saveMCQs([]);
    setFailedBatchIndices([]);
    setRetryFailedAttempted(false);
    setAudit(null);
    setShowAudit(false);
    setDuplicates([]);
    duplicatesRef.current = [];
    setShowDuplicates(false);
    let completed = false;

    try {
      const controller = startProcessingController();
      const settingsSnapshot = { ...requestSettings };
      const realtimePreviewEnabled = settingsSnapshot.realtimePreviewEnabled === true;
      let activeOcrMode: 'gemini' | 'tesseract' = ocrMode;

      // 1. Initial Attempt (Default Mode)
      let filesToUse = await prepareFiles(activeOcrMode, controller, settingsSnapshot);
      const expectedQuestionCount = analysis?.estimatedCount || getDetectedDocxMcqCount();
      let { res } = await runGenerationPhase({
        phase: 'initial',
        filesToUse,
        requestSettings: settingsSnapshot,
        expectedQuestionCount,
        controller,
        liveAppendToVisible: realtimePreviewEnabled,
        forcedOcrMode: activeOcrMode,
      });

      // 2. Auto-Fallback Check
      // If we used Gemini (Cloud) AND got bad results (< 60% of estimate), try Tesseract
      if (ocrMode === 'gemini' && analysis && analysis.estimatedCount > 0) {
        const count = res.questions.length;
        if (count < analysis.estimatedCount * 0.9) {
          const hasImages = files.some(f => f.type.startsWith('image/'));
          if (hasImages) {
            // Trigger Fallback
            setProgressStatus(`Kết quả Cloud thấp(${count} / ${analysis.estimatedCount}).Đang tự động chuyển sang Local OCR(Smart Fallback)...`);
            await waitWithController(2000, controller);

            try {
              const tesseractFiles = await prepareFiles('tesseract', controller, settingsSnapshot);
              // If OCR produced text, let's retry generation
              if (tesseractFiles.some(f => f.type === 'text/plain' && f.content.length > 50)) {
                const fallbackPhase = await runGenerationPhase({
                  phase: 'fallback',
                  filesToUse: tesseractFiles,
                  requestSettings: settingsSnapshot,
                  expectedQuestionCount: analysis.estimatedCount,
                  controller,
                  progressPrefix: '',
                  liveAppendToVisible: false,
                  comparisonBaselineCount: count,
                  comparisonFailedBatchIndices: res.failedBatches || [],
                  comparisonFailedBatchDetails: res.failedBatchDetails || [],
                  forcedOcrMode: 'tesseract',
                });
                const fallbackRes = fallbackPhase.res;

                const preferredOutcome = selectPreferredPhaseOutcome({
                  baselineQuestions: res.questions,
                  baselineFailedBatchIndices: res.failedBatches || [],
                  baselineFailedBatchDetails: res.failedBatchDetails || [],
                  baselineMode: activeOcrMode,
                  candidateQuestions: fallbackRes.questions,
                  candidateFailedBatchIndices: fallbackRes.failedBatches || [],
                  candidateFailedBatchDetails: fallbackRes.failedBatchDetails || [],
                  candidateMode: 'tesseract',
                });

                if (preferredOutcome.useCandidate) {
                  res = {
                    ...fallbackRes,
                    failedBatches: preferredOutcome.failedBatchIndices,
                    failedBatchDetails: preferredOutcome.failedBatchDetails,
                  };
                  filesToUse = tesseractFiles;
                  activeOcrMode = 'tesseract';
                  await setVisibleMcqs(sortMcqsByQuestionNumber(fallbackRes.questions.map((q, i) => ({
                    ...q,
                    id: q.id || `q-${Date.now()}-${i}`,
                  }))));
                  console.log("Fallback successful, replaced results.");
                } else {
                  setFailedBatchIndices(preferredOutcome.failedBatchIndices);
                }
              }
            } catch (fallbackError) {
              console.error("Fallback failed:", fallbackError);
              // Swallow error and keep original results
            }
          }
        }
      }

      let autoRescuedCount = 0;
      if (res.failedBatches && res.failedBatches.length > 0) {
        const initialFailed = [...res.failedBatches];
        try {
          const rescuePhase = await runGenerationPhase({
            phase: 'rescue',
            filesToUse,
            requestSettings: settingsSnapshot,
            expectedQuestionCount,
            controller,
            retryIndices: initialFailed,
            isAdvancedMode: true,
            retryProfile: 'rescue',
            autoRescue: true,
            liveAppendToVisible: realtimePreviewEnabled,
            forcedOcrMode: activeOcrMode,
            seedQuestions: res.questions,
            seedDuplicates: res.duplicates || [],
          });
          const rescueRes = rescuePhase.res;

          const uniqueRescued = deduplicateQuestions(rescueRes.questions, res.questions);
          autoRescuedCount = Math.max(autoRescuedCount, uniqueRescued.length);
          res = {
            ...res,
            questions: [...res.questions, ...uniqueRescued],
            duplicates: [...(res.duplicates || []), ...(rescueRes.duplicates || [])],
            failedBatches: rescueRes.failedBatches || [],
            failedBatchDetails: rescueRes.failedBatchDetails || [],
            autoSkippedCount: (res.autoSkippedCount || 0) + (rescueRes.autoSkippedCount || 0),
          };
        } catch (rescueError) {
          console.warn("Auto-rescue failed:", rescueError);
        }
      }

      const formatted = res.questions.map((q, i) => ({
        ...q, id: q.id || `q - ${Date.now()} -${i} `
      }));
      await setVisibleMcqs(formatted);
      if (formatted.length > 0) {
        try {
          await onGenerationComplete?.({
            files,
            mcqs: formatted,
            duplicates: res.duplicates || [],
            analysis,
            settings: settingsSnapshot,
          });
        } catch (projectError) {
          console.error('Project auto-save failed:', projectError);
          toast.warning('Đã trích xuất xong nhưng chưa lưu được snapshot vào thư viện.');
        }
      }

      // 3. Thông báo lỗi cho các Batch thất bại (nếu có)
      if (res.failedBatches && res.failedBatches.length > 0) {
        setFailedBatchIndices(res.failedBatches);
        toast.warning(`⚠️ Còn ${res.failedBatches.length} phần lỗi sau khi quét${autoRescuedCount > 0 ? `, đã tự cứu thêm ${autoRescuedCount} câu` : ''}. ${summarizeBatchFailures(res.failedBatchDetails, res.failedBatches)}`, {
          duration: 15000,
        });
      } else {
        setFailedBatchIndices([]);
        const skipCount = res.autoSkippedCount || 0;
        if (formatted.length > 0) {
          toast.success(`Trích xuất hoàn tất! Tìm thấy tổng cộng ${formatted.length} câu hỏi.${autoRescuedCount > 0 ? ` Đã tự cứu thêm ${autoRescuedCount} câu từ batch lỗi.` : ''}${skipCount > 0 ? ` Đã bỏ qua ${skipCount} câu trùng.` : ''}`);
        } else if (skipCount > 0) {
          toast.info(`Toàn bộ tài liệu (${skipCount} câu) đã trùng lặp trong danh sách, không trích xuất thêm.`);
        } else {
          toast.error("Không tìm thấy câu hỏi nào hoặc lỗi trích xuất.");
        }
      }

      // Store duplicates for display
      if (res.duplicates && res.duplicates.length > 0) {
        setDuplicates(res.duplicates);
        duplicatesRef.current = res.duplicates;
      }

      // Tự động kiểm toán nếu số lượng quá thấp
      if (analysis && formatted.length < analysis.estimatedCount * 0.8) {
        runAudit(formatted.length, filesToUse);
      } else if (!analysis && expectedQuestionCount > 0 && formatted.length < expectedQuestionCount * 0.8) {
        runAudit(formatted.length, filesToUse);
      }
      completed = true;
    } catch (e: any) {
      toast.error(translateErrorForUser(e, 'Trích xuất'));
    }
    finally {
      if (completed) await clearResumeSession();
      clearProcessingController();
      setLoading(false);
    }
  };

  return { handleGenerate };
};
