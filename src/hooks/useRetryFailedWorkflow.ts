import React from 'react';
import { toast } from 'sonner';
import {
  AnalysisResult,
  AppSettings,
  DuplicateInfo,
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
  ocrMode: 'gemini' | 'tesseract';
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
  ocrMode,
  prepareFiles,
  retryFailedAttempted,
  runGenerationPhase,
  setCurrentCount,
  setDuplicates,
  setFailedBatchIndices,
  setLoading,
  setProgressStatus,
  setRetryFailedAttempted,
  startProcessingController,
  warnVisionRecommendedDocx,
}: UseRetryFailedWorkflowParams) => {
  const handleRetryFailed = async () => {
    if (files.length === 0 || failedBatchIndices.length === 0) return;
    if (retryFailedAttempted) {
      toast.info("Đã quét lại phần lỗi một lần. Các phần còn lỗi nên để quét lại sau khi đổi file, model hoặc API key.");
      return;
    }
    if (warnVisionRecommendedDocx()) return;
    const requestSettings = getRequestSettings(currentFilesRequireVision());

    await clearResumeSession();
    setRetryFailedAttempted(true);
    setLoading(true);
    setCurrentCount(0);
    setProgressStatus(`Đang quét lại ${failedBatchIndices.length} phần lỗi...`);
    let retryCompleted = false;

    try {
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
        liveAppendToVisible: true,
        forcedOcrMode: ocrMode,
      });
      const res = retryPhase.res;

      if (res.failedBatches && res.failedBatches.length > 0) {
        setFailedBatchIndices(res.failedBatches);
        toast.error(`⚠️ Quét lại vẫn còn ${res.failedBatches.length} phần lỗi. ${summarizeBatchFailures(res.failedBatchDetails, res.failedBatches)}`);
      } else {
        setFailedBatchIndices([]);
        toast.success("Đã quét lại thành công tất cả các phần lỗi!");
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
    }
  };

  return { handleRetryFailed };
};
