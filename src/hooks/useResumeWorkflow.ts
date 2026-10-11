import React from 'react';
import { toast } from 'sonner';
import {
  AppSettings,
  DuplicateInfo,
  MCQ,
  ProcessingController,
  ProcessingSession,
  UploadedFile,
} from '../types';
import { db } from '../core/db';
import { translateErrorForUser } from '../core/brain';
import { runAutoRescuePhaseIfNeeded } from '../utils/workflowPhaseHelpers';
import { formatSessionPhase, sortMcqsByQuestionNumber } from '../utils/appHelpers';
import { RunGenerationPhaseParams, RunGenerationPhaseResult } from './useGenerationPhase';

interface UseResumeWorkflowParams {
  clearProcessingController: () => void;
  clearResumeSession: () => Promise<void>;
  deduplicateQuestions: (newList: MCQ[], existingList: MCQ[]) => MCQ[];
  duplicatesRef: React.MutableRefObject<DuplicateInfo[]>;
  files: UploadedFile[];
  getDetectedDocxMcqCount: () => number;
  mcqsRef: React.MutableRefObject<MCQ[]>;
  prepareFiles: (
    controller?: ProcessingController,
    runtimeSettings?: AppSettings
  ) => Promise<UploadedFile[]>;
  resumeSession: ProcessingSession | null;
  runGenerationPhase: (params: RunGenerationPhaseParams) => Promise<RunGenerationPhaseResult>;
  setCurrentCount: React.Dispatch<React.SetStateAction<number>>;
  setDuplicates: React.Dispatch<React.SetStateAction<DuplicateInfo[]>>;
  setFailedBatchIndices: React.Dispatch<React.SetStateAction<number[]>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setProgressStatus: React.Dispatch<React.SetStateAction<string>>;
  setVisibleMcqs: (items: MCQ[]) => Promise<MCQ[]>;
  startProcessingController: () => ProcessingController;
  warnVisionRecommendedDocx: () => boolean;
}

export const useResumeWorkflow = ({
  clearProcessingController,
  clearResumeSession,
  deduplicateQuestions,
  duplicatesRef,
  files,
  getDetectedDocxMcqCount,
  mcqsRef,
  prepareFiles,
  resumeSession,
  runGenerationPhase,
  setCurrentCount,
  setDuplicates,
  setFailedBatchIndices,
  setLoading,
  setProgressStatus,
  setVisibleMcqs,
  startProcessingController,
  warnVisionRecommendedDocx,
}: UseResumeWorkflowParams) => {
  const handleDiscardResumeSession = async () => {
    await clearResumeSession();
    await db.saveMCQs(mcqsRef.current);
    setProgressStatus("");
    setCurrentCount(0);
    setFailedBatchIndices([]);
    toast.info("Đã bỏ phiên dang dở. File và dữ liệu đã khôi phục vẫn được giữ lại.");
  };

  const isWorkingRef = React.useRef(false);

  const handleResumeSession = async () => {
    const session = resumeSession;
    if (isWorkingRef.current || !session || files.length === 0) return;
    if (warnVisionRecommendedDocx()) return;

    isWorkingRef.current = true;
    let resumedSuccessfully = false;
    try {
      setLoading(true);
      setCurrentCount(session.currentCount ?? session.phaseCurrentCount ?? mcqsRef.current.length);
      setProgressStatus(`Đang tiếp tục ${formatSessionPhase(session.phase).toLowerCase()}...`);
      setFailedBatchIndices(session.failedBatchIndices || []);
      setDuplicates(session.duplicatesSnapshot || []);
      duplicatesRef.current = session.duplicatesSnapshot || [];
      const controller = startProcessingController();
      let filesToUse = await prepareFiles(controller, session.settingsSnapshot);
      const expectedQuestionCount = session.analysisSnapshot?.estimatedCount || getDetectedDocxMcqCount();

      if (session.phase === 'initial') {
        let { res } = await runGenerationPhase({
          phase: 'initial',
          filesToUse,
          requestSettings: session.settingsSnapshot,
          expectedQuestionCount,
          controller,
          seedQuestions: mcqsRef.current,
          seedDuplicates: [],
          existingCompletedBatchIndices: session.completedBatchIndices,
          deprioritizedBatchIndices: session.failedBatchIndices || [],
          renderCompletedBatchesToVisible: true,
          resumeMode: true,
        });

        const rescueResult = await runAutoRescuePhaseIfNeeded({
          mainBatchOnlyRescue: session.settingsSnapshot.mainBatchOnlyRescue,
          res,
          filesToUse,
          settingsSnapshot: session.settingsSnapshot,
          expectedQuestionCount,
          controller,
          seedQuestions: res.questions.length > 0 ? res.questions : mcqsRef.current,
          runGenerationPhase,
          deduplicateQuestions,
          setProgressStatus,
        });
        res = rescueResult.res;

        await setVisibleMcqs(sortMcqsByQuestionNumber(res.questions));
        setFailedBatchIndices(res.failedBatches || []);
        setDuplicates(res.duplicates || []);
        duplicatesRef.current = res.duplicates || [];
      } else {
        const retryIndices = session.resumeRetryIndices || session.failedBatchIndices || [];
        const resumedPhase = await runGenerationPhase({
          phase: session.phase,
          filesToUse,
          requestSettings: session.settingsSnapshot,
          expectedQuestionCount,
          controller,
          progressPrefix: session.phase === 'retryFailed' ? '[CƠ CHẾ CHUYÊN GIA] ' : '',
          retryIndices,
          isAdvancedMode: true,
          retryProfile: 'rescue',
          autoRescue: session.phase === 'rescue',
          renderCompletedBatchesToVisible: true,
          existingCompletedBatchIndices: session.completedBatchIndices || [],
          seedQuestions: (session.phaseQuestionsSnapshot || []).length > 0 ? (session.phaseQuestionsSnapshot || []) : mcqsRef.current,
          seedDuplicates: session.phaseDuplicatesSnapshot || [],
          seedAutoSkippedCount: session.phaseAutoSkippedCount || 0,
          resumeMode: true,
        });
        setFailedBatchIndices(resumedPhase.res.failedBatches || []);
        setDuplicates(resumedPhase.res.duplicates || []);
        duplicatesRef.current = resumedPhase.res.duplicates || [];
      }

      toast.success("Đã tiếp tục xong phiên dang dở.");
      resumedSuccessfully = true;
    } catch (e: any) {
      toast.error(translateErrorForUser(e, 'Tiếp tục'));
    } finally {
      if (resumedSuccessfully) await clearResumeSession();
      clearProcessingController();
      setLoading(false);
      isWorkingRef.current = false;
    }
  };

  return {
    handleDiscardResumeSession,
    handleResumeSession,
  };
};
