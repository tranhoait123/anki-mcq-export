import React from 'react';
import { toast } from 'sonner';
import {
  AnalysisResult,
  AppSettings,
  DuplicateInfo,
  MCQ,
  ProcessingController,
  UploadedFile,
} from '../types';
import { translateErrorForUser } from '../core/brain';
import { summarizeBatchFailures } from '../utils/appHelpers';
import { RunGenerationPhaseParams, RunGenerationPhaseResult } from './useGenerationPhase';

interface UseRetryFailedWorkflowParams {
  analysis: AnalysisResult | null;
  clearProcessingController: () => void;
  clearResumeSession: () => Promise<void>;
  currentFilesRequireVision: () => boolean;
  duplicatesRef: React.MutableRefObject<DuplicateInfo[]>;
  failedBatchIndices: number[];
  files: UploadedFile[];
  getRequestSettings: (requiresVision?: boolean) => AppSettings;
  mcqsRef: React.MutableRefObject<MCQ[]>;
  ocrMode: 'gemini' | 'tesseract';
  persistMcqs: (items: MCQ[]) => Promise<void>;
  prepareFiles: (
    forcedMode?: 'gemini' | 'tesseract',
    controller?: ProcessingController,
    runtimeSettings?: AppSettings
  ) => Promise<UploadedFile[]>;
  retryFailedAttempted: boolean;
  runGenerationPhase: (params: RunGenerationPhaseParams) => Promise<RunGenerationPhaseResult>;
  setCurrentCount: React.Dispatch<React.SetStateAction<number>>;
  setDuplicates: React.Dispatch<React.SetStateAction<DuplicateInfo[]>>;
  setFailedBatchIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setProgressStatus: React.Dispatch<React.SetStateAction<string>>;
  setRetryFailedAttempted: React.Dispatch<React.SetStateAction<boolean>>;
  setVisibleMcqs: (items: MCQ[]) => Promise<MCQ[]>;
  startProcessingController: () => ProcessingController;
  warnVisionRecommendedDocx: () => boolean;
}

export const useRetryFailedWorkflow = ({
  analysis,
  clearProcessingController,
  clearResumeSession,
  currentFilesRequireVision,
  duplicatesRef,
  failedBatchIndices,
  files,
  getRequestSettings,
  mcqsRef,
  ocrMode,
  persistMcqs,
  prepareFiles,
  retryFailedAttempted,
  runGenerationPhase,
  setCurrentCount,
  setDuplicates,
  setFailedBatchIndices,
  setLoading,
  setProgressStatus,
  setRetryFailedAttempted,
  setVisibleMcqs,
  startProcessingController,
  warnVisionRecommendedDocx,
}: UseRetryFailedWorkflowParams) => {
  const isWorkingRef = React.useRef(false);

  const handleRetryFailed = async () => {
    if (isWorkingRef.current || files.length === 0 || failedBatchIndices.length === 0) return;
    if (retryFailedAttempted) {
      toast.info("Đã quét lại phần lỗi một lần. Các phần còn lỗi nên để quét lại sau khi đổi file, model hoặc API key.");
      return;
    }
    if (warnVisionRecommendedDocx()) return;
    const requestSettings = getRequestSettings(currentFilesRequireVision());
    const realtimePreviewEnabled = requestSettings.realtimePreviewEnabled === true;

    isWorkingRef.current = true;
    let retryCompleted = false;
    try {
      await clearResumeSession();
      setRetryFailedAttempted(true);
      setLoading(true);
      const baselineQuestions = [...mcqsRef.current];
      const baselineCount = baselineQuestions.length;
      setCurrentCount(baselineCount);
      setProgressStatus(`Đang quét lại ${failedBatchIndices.length} phần lỗi...`);
      const controller = startProcessingController();
      const filesToUse = await prepareFiles(ocrMode, controller, requestSettings);
      const retryPhase = await runGenerationPhase({
        phase: 'retryFailed',
        filesToUse,
        requestSettings: requestSettings,
        expectedQuestionCount: analysis?.estimatedCount || 0,
        controller,
        progressPrefix: '[CƠ CHẾ CHUYÊN GIA] ',
        retryIndices: failedBatchIndices,
        isAdvancedMode: true,
        retryProfile: 'rescue',
        seedQuestions: baselineQuestions,
        seedDuplicates: duplicatesRef.current,
        liveAppendToVisible: realtimePreviewEnabled,
        renderCompletedBatchesToVisible: true,
        skipInferredCompletedBatches: true,
        forcedOcrMode: ocrMode,
      });
      const res = retryPhase.res;
      const visibleQuestions = await setVisibleMcqs(res.questions);
      await persistMcqs(visibleQuestions);
      setCurrentCount(visibleQuestions.length);
      const addedCount = Math.max(0, visibleQuestions.length - baselineCount);

      if (res.failedBatches && res.failedBatches.length > 0) {
        setFailedBatchIndices(res.failedBatches);
        toast.warning(`⚠️ Quét lại thêm ${addedCount} câu nhưng vẫn còn ${res.failedBatches.length} phần lỗi. ${summarizeBatchFailures(res.failedBatchDetails, res.failedBatches)}`);
      } else {
        setFailedBatchIndices([]);
        if (addedCount > 0) {
          toast.success(`Đã quét lại thành công và thêm ${addedCount} câu. Tổng hiện tại: ${visibleQuestions.length} câu.`);
        } else {
          toast.info("Quét lại thành công nhưng không tìm thấy câu mới để thêm vào danh sách hiện tại.");
        }
      }
      setDuplicates(res.duplicates || []);
      duplicatesRef.current = res.duplicates || [];
      retryCompleted = true;
    } catch (e: any) {
      toast.error(translateErrorForUser(e, 'Quét lại'));
    } finally {
      if (retryCompleted) await clearResumeSession();
      clearProcessingController();
      setLoading(false);
      isWorkingRef.current = false;
    }
  };

  return { handleRetryFailed };
};
