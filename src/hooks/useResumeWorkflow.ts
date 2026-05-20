import React from 'react';
import { toast } from 'sonner';
import {
  AppSettings,
  DuplicateInfo,
  GeneratedResponse,
  MCQ,
  ProcessingController,
  ProcessingSession,
  UploadedFile,
} from '../types';
import { db } from '../core/db';
import { translateErrorForUser } from '../core/brain';
import { selectPreferredPhaseOutcome, shouldDelayAutoRescue } from '../utils/resumeSession';
import { formatSessionPhase, sortMcqsByQuestionNumber } from '../utils/appHelpers';
import { RunGenerationPhaseParams, RunGenerationPhaseResult } from './useGenerationPhase';

type McqGeneratedResponse = Omit<GeneratedResponse, 'questions'> & { questions: MCQ[] };

interface UseResumeWorkflowParams {
  clearProcessingController: () => void;
  clearResumeSession: () => Promise<void>;
  deduplicateQuestions: (newList: MCQ[], existingList: MCQ[]) => MCQ[];
  duplicatesRef: React.MutableRefObject<DuplicateInfo[]>;
  files: UploadedFile[];
  getDetectedDocxMcqCount: () => number;
  mcqsRef: React.MutableRefObject<MCQ[]>;
  prepareFiles: (
    forcedMode?: 'gemini' | 'tesseract',
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
      let activeOcrMode: 'gemini' | 'tesseract' = session.forcedOcrMode || 'gemini';
      let filesToUse = await prepareFiles(activeOcrMode, controller, session.settingsSnapshot);
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
          forcedOcrMode: activeOcrMode,
        });

        if (activeOcrMode === 'gemini' && session.analysisSnapshot && session.analysisSnapshot.estimatedCount > 0) {
          const count = res.questions.length;
          if (count < session.analysisSnapshot.estimatedCount * 0.9) {
            const hasImages = files.some(f => f.type.startsWith('image/'));
            if (hasImages) {
              const tesseractFiles = await prepareFiles('tesseract', controller, session.settingsSnapshot);
              if (tesseractFiles.some(f => f.type === 'text/plain' && f.content.length > 50)) {
                const fallbackPhase = await runGenerationPhase({
                  phase: 'fallback',
                  filesToUse: tesseractFiles,
                  requestSettings: session.settingsSnapshot,
                  expectedQuestionCount: session.analysisSnapshot.estimatedCount,
                  controller,
                  seedQuestions: [],
                  seedDuplicates: [],
                  comparisonBaselineCount: count,
                  comparisonFailedBatchIndices: res.failedBatches || [],
                  comparisonFailedBatchDetails: res.failedBatchDetails || [],
                  forcedOcrMode: 'tesseract',
                });

                const preferredOutcome = selectPreferredPhaseOutcome({
                  baselineQuestions: res.questions,
                  baselineFailedBatchIndices: res.failedBatches || [],
                  baselineFailedBatchDetails: res.failedBatchDetails || [],
                  baselineMode: activeOcrMode,
                  candidateQuestions: fallbackPhase.res.questions,
                  candidateFailedBatchIndices: fallbackPhase.res.failedBatches || [],
                  candidateFailedBatchDetails: fallbackPhase.res.failedBatchDetails || [],
                  candidateMode: 'tesseract',
                });

                if (preferredOutcome.useCandidate) {
                  res = {
                    ...fallbackPhase.res,
                    failedBatches: preferredOutcome.failedBatchIndices,
                    failedBatchDetails: preferredOutcome.failedBatchDetails,
                  };
                  filesToUse = tesseractFiles;
                  activeOcrMode = 'tesseract';
                  await setVisibleMcqs(sortMcqsByQuestionNumber(fallbackPhase.res.questions));
                } else {
                  setFailedBatchIndices(preferredOutcome.failedBatchIndices);
                }
              }
            }
          }
        }

        if (!session.settingsSnapshot.mainBatchOnlyRescue && res.failedBatches && res.failedBatches.length > 0) {
          if (shouldDelayAutoRescue(res.failedBatchDetails || [], res.failedBatches)) {
            setProgressStatus(`Provider đang nóng hoặc còn nhiều batch cứu thiếu; giữ ${res.failedBatches.length} phần lỗi để quét lại sau.`);
          } else {
            const rescuePhase = await runGenerationPhase({
              phase: 'rescue',
              filesToUse,
              requestSettings: session.settingsSnapshot,
              expectedQuestionCount,
              controller,
              retryIndices: res.failedBatches,
              isAdvancedMode: true,
              retryProfile: 'rescue',
              autoRescue: true,
              renderCompletedBatchesToVisible: true,
              forcedOcrMode: activeOcrMode,
              seedQuestions: res.questions.length > 0 ? res.questions : mcqsRef.current,
              seedDuplicates: res.duplicates || [],
            });
            const uniqueRescued = deduplicateQuestions(rescuePhase.res.questions, res.questions);
            res = {
              ...res,
              questions: [...res.questions, ...uniqueRescued],
              duplicates: [...(res.duplicates || []), ...(rescuePhase.res.duplicates || [])],
              failedBatches: rescuePhase.res.failedBatches || [],
              failedBatchDetails: rescuePhase.res.failedBatchDetails || [],
              autoSkippedCount: (res.autoSkippedCount || 0) + (rescuePhase.res.autoSkippedCount || 0),
            };
          }
        }

        await setVisibleMcqs(sortMcqsByQuestionNumber(res.questions));
        setFailedBatchIndices(res.failedBatches || []);
        setDuplicates(res.duplicates || []);
        duplicatesRef.current = res.duplicates || [];
      } else if (session.phase === 'fallback') {
        const fallbackPhase = await runGenerationPhase({
          phase: 'fallback',
          filesToUse,
          requestSettings: session.settingsSnapshot,
          expectedQuestionCount,
          controller,
          seedQuestions: session.phaseQuestionsSnapshot || [],
          seedDuplicates: session.phaseDuplicatesSnapshot || [],
          seedAutoSkippedCount: session.phaseAutoSkippedCount || 0,
          existingCompletedBatchIndices: session.completedBatchIndices || [],
          comparisonBaselineCount: session.phaseComparisonBaselineCount || mcqsRef.current.length,
          comparisonFailedBatchIndices: session.phaseComparisonFailedBatchIndices || [],
          comparisonFailedBatchDetails: session.phaseComparisonFailedBatchDetails || [],
          deprioritizedBatchIndices: session.failedBatchIndices || [],
          forcedOcrMode: 'tesseract',
        });

        const preferredOutcome = selectPreferredPhaseOutcome({
          baselineQuestions: mcqsRef.current,
          baselineFailedBatchIndices: session.phaseComparisonFailedBatchIndices || [],
          baselineFailedBatchDetails: session.phaseComparisonFailedBatchDetails || [],
          baselineMode: 'gemini',
          candidateQuestions: fallbackPhase.res.questions,
          candidateFailedBatchIndices: fallbackPhase.res.failedBatches || [],
          candidateFailedBatchDetails: fallbackPhase.res.failedBatchDetails || [],
          candidateMode: 'tesseract',
        });

        let selectedRes: McqGeneratedResponse = preferredOutcome.useCandidate
          ? {
              ...fallbackPhase.res,
              failedBatches: preferredOutcome.failedBatchIndices,
              failedBatchDetails: preferredOutcome.failedBatchDetails,
            }
          : {
              questions: preferredOutcome.questions,
              duplicates: session.duplicatesSnapshot || [],
              failedBatches: preferredOutcome.failedBatchIndices,
              failedBatchDetails: preferredOutcome.failedBatchDetails,
              autoSkippedCount: session.autoSkippedCount || 0,
            };

        if (preferredOutcome.useCandidate) {
          activeOcrMode = 'tesseract';
          filesToUse = await prepareFiles('tesseract', controller, session.settingsSnapshot);
          await setVisibleMcqs(sortMcqsByQuestionNumber(fallbackPhase.res.questions));
        } else {
          activeOcrMode = preferredOutcome.forcedOcrMode || 'gemini';
          filesToUse = await prepareFiles(activeOcrMode, controller, session.settingsSnapshot);
          await setVisibleMcqs(sortMcqsByQuestionNumber(preferredOutcome.questions));
        }

        if (!session.settingsSnapshot.mainBatchOnlyRescue && selectedRes.failedBatches && selectedRes.failedBatches.length > 0) {
          if (shouldDelayAutoRescue(selectedRes.failedBatchDetails || [], selectedRes.failedBatches)) {
            setProgressStatus(`Provider đang nóng hoặc còn nhiều batch cứu thiếu; giữ ${selectedRes.failedBatches.length} phần lỗi để quét lại sau.`);
          } else {
            const rescuePhase = await runGenerationPhase({
              phase: 'rescue',
              filesToUse,
              requestSettings: session.settingsSnapshot,
              expectedQuestionCount,
              controller,
              retryIndices: selectedRes.failedBatches,
              isAdvancedMode: true,
              retryProfile: 'rescue',
              autoRescue: true,
              renderCompletedBatchesToVisible: true,
              forcedOcrMode: activeOcrMode,
              seedQuestions: selectedRes.questions.length > 0 ? selectedRes.questions : mcqsRef.current,
              seedDuplicates: selectedRes.duplicates || [],
            });
            const uniqueRescued = deduplicateQuestions(rescuePhase.res.questions, selectedRes.questions);
            selectedRes = {
              ...selectedRes,
              questions: [...selectedRes.questions, ...uniqueRescued],
              duplicates: [...(selectedRes.duplicates || []), ...(rescuePhase.res.duplicates || [])],
              failedBatches: rescuePhase.res.failedBatches || [],
              failedBatchDetails: rescuePhase.res.failedBatchDetails || [],
              autoSkippedCount: (selectedRes.autoSkippedCount || 0) + (rescuePhase.res.autoSkippedCount || 0),
            };
          }
        }

        await setVisibleMcqs(sortMcqsByQuestionNumber(selectedRes.questions));
        setFailedBatchIndices(selectedRes.failedBatches || []);
        setDuplicates(selectedRes.duplicates || []);
        duplicatesRef.current = selectedRes.duplicates || [];
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
          forcedOcrMode: activeOcrMode,
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
