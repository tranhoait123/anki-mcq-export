import React from 'react';
import {
  AppSettings,
  DuplicateInfo,
  GeneratedResponse,
  MCQ,
  ProcessingCheckpoint,
  ProcessingController,
  ProcessingPhase,
  ProcessingSession,
  UploadedFile,
} from '../types';
import { generateQuestions } from '../core/brain';
import { sortMcqsByQuestionNumber } from '../utils/appHelpers';

export interface RunGenerationPhaseParams {
  phase: ProcessingPhase;
  filesToUse: UploadedFile[];
  requestSettings: AppSettings;
  expectedQuestionCount: number;
  controller: ProcessingController;
  progressPrefix?: string;
  retryIndices?: number[];
  isAdvancedMode?: boolean;
  retryProfile?: 'normal' | 'rescue';
  autoRescue?: boolean;
  seedQuestions?: MCQ[];
  seedDuplicates?: DuplicateInfo[];
  seedAutoSkippedCount?: number;
  liveAppendToVisible?: boolean;
  renderCompletedBatchesToVisible?: boolean;
  comparisonBaselineCount?: number;
  comparisonFailedBatchIndices?: number[];
  comparisonFailedBatchDetails?: GeneratedResponse['failedBatchDetails'];
  existingCompletedBatchIndices?: number[];
  skipInferredCompletedBatches?: boolean;
  forcedOcrMode?: 'gemini' | 'tesseract';
}

export interface RunGenerationPhaseResult {
  res: Omit<GeneratedResponse, 'questions'> & { questions: MCQ[] };
  phaseQuestions: MCQ[];
  phaseDuplicates: DuplicateInfo[];
  phaseAutoSkippedCount: number;
}

interface UseGenerationPhaseParams {
  activeSessionRef: React.MutableRefObject<ProcessingSession | null>;
  appendVisibleMcqs: (items: MCQ[], options?: { persist?: boolean }) => Promise<MCQ[]>;
  buildSessionBase: (
    phase: ProcessingPhase,
    settingsSnapshot: AppSettings,
    extras?: Partial<ProcessingSession>
  ) => Promise<ProcessingSession>;
  duplicatesRef: React.MutableRefObject<DuplicateInfo[]>;
  mcqsRef: React.MutableRefObject<MCQ[]>;
  persistMcqs: (items: MCQ[]) => Promise<void>;
  persistSession: (session: ProcessingSession) => Promise<void>;
  setCurrentCount: React.Dispatch<React.SetStateAction<number>>;
  setProgressStatus: React.Dispatch<React.SetStateAction<string>>;
  updateActiveSession: (partial: Partial<ProcessingSession>) => Promise<ProcessingSession | null>;
}

export const useGenerationPhase = ({
  activeSessionRef,
  appendVisibleMcqs,
  buildSessionBase,
  duplicatesRef,
  mcqsRef,
  persistMcqs,
  persistSession,
  setCurrentCount,
  setProgressStatus,
  updateActiveSession,
}: UseGenerationPhaseParams) => {
  const runGenerationPhase = async ({
    phase,
    filesToUse,
    requestSettings,
    expectedQuestionCount,
    controller,
    progressPrefix,
    retryIndices,
    isAdvancedMode = false,
    retryProfile,
    autoRescue = false,
    seedQuestions = [],
    seedDuplicates = [],
    seedAutoSkippedCount = 0,
    liveAppendToVisible = false,
    renderCompletedBatchesToVisible = liveAppendToVisible,
    comparisonBaselineCount,
    comparisonFailedBatchIndices = [],
    comparisonFailedBatchDetails = [],
    existingCompletedBatchIndices = [],
    skipInferredCompletedBatches = false,
    forcedOcrMode,
  }: RunGenerationPhaseParams): Promise<RunGenerationPhaseResult> => {
    let phaseQuestions = sortMcqsByQuestionNumber(seedQuestions);
    let phaseDuplicates = [...seedDuplicates];
    let phaseAutoSkippedCount = seedAutoSkippedCount;

    await persistSession(await buildSessionBase(phase, requestSettings, {
      totalTopLevelBatches: retryIndices?.length || 0,
      completedBatchIndices: existingCompletedBatchIndices,
      failedBatchIndices: [],
      failedBatchDetails: [],
      forcedOcrMode,
      autoSkippedCount: renderCompletedBatchesToVisible ? 0 : phaseAutoSkippedCount,
      currentCount: renderCompletedBatchesToVisible ? mcqsRef.current.length : phaseQuestions.length,
      resumeRetryIndices: retryIndices,
      mcqsSnapshot: mcqsRef.current,
      duplicatesSnapshot: duplicatesRef.current,
      phaseQuestionsSnapshot: phaseQuestions,
      phaseDuplicatesSnapshot: phaseDuplicates,
      phaseAutoSkippedCount: phaseAutoSkippedCount,
      phaseCurrentCount: phaseQuestions.length,
      phaseComparisonBaselineCount: comparisonBaselineCount,
      phaseComparisonFailedBatchIndices: comparisonFailedBatchIndices,
      phaseComparisonFailedBatchDetails: comparisonFailedBatchDetails,
    }));

    let partialFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingPartialQuestions: MCQ[] = [];

    const flushPartialQuestions = async () => {
      if (partialFlushTimer !== null) {
        clearTimeout(partialFlushTimer);
        partialFlushTimer = null;
      }
      if (pendingPartialQuestions.length === 0) return;
      const batch = pendingPartialQuestions;
      pendingPartialQuestions = [];
      await appendVisibleMcqs(batch, { persist: false });
    };

    const queuePartialQuestions = (partialQuestions: MCQ[]) => {
      pendingPartialQuestions.push(...partialQuestions);
      if (pendingPartialQuestions.length >= 10) {
        void flushPartialQuestions();
        return;
      }
      if (partialFlushTimer !== null) return;
      partialFlushTimer = setTimeout(() => {
        void flushPartialQuestions();
      }, 1000);
    };

    const res = await generateQuestions(
      filesToUse,
      requestSettings,
      0,
      (status, count) => {
        setProgressStatus(progressPrefix ? `${progressPrefix}${status}` : status);
        setCurrentCount(count);
      },
      expectedQuestionCount,
      (newBatch) => {
        const persistBatch = async () => {
          if (renderCompletedBatchesToVisible) {
            await appendVisibleMcqs(newBatch, { persist: liveAppendToVisible });
          }
          phaseQuestions = sortMcqsByQuestionNumber([...phaseQuestions, ...newBatch]);
        };
        void persistBatch();
      },
      retryIndices,
      isAdvancedMode,
      {
        controller,
        retryProfile,
        autoRescue,
        resumeMode: existingCompletedBatchIndices.length > 0 || seedQuestions.length > 0,
        skipInferredCompletedBatches,
        completedBatchIndices: existingCompletedBatchIndices,
        existingQuestions: phaseQuestions,
        existingDuplicates: phaseDuplicates,
        existingAutoSkippedCount: phaseAutoSkippedCount,
        sessionPhase: phase,
        onCheckpoint: (checkpoint: ProcessingCheckpoint) => {
          void updateActiveSession({
            totalTopLevelBatches: checkpoint.totalTopLevelBatches,
            completedBatchIndices: checkpoint.completedBatchIndices,
            failedBatchIndices: checkpoint.failedBatchIndices,
            failedBatchDetails: checkpoint.failedBatchDetails,
            currentCount: checkpoint.currentCount,
            mcqsSnapshot: checkpoint.questionsSnapshot,
            duplicatesSnapshot: checkpoint.duplicatesSnapshot,
            autoSkippedCount: checkpoint.autoSkippedCount,
            phaseQuestionsSnapshot: checkpoint.questionsSnapshot,
            phaseDuplicatesSnapshot: checkpoint.duplicatesSnapshot,
            phaseAutoSkippedCount: checkpoint.autoSkippedCount,
            phaseCurrentCount: checkpoint.questionsSnapshot.length,
          });
          if (!liveAppendToVisible) void persistMcqs(checkpoint.questionsSnapshot);
        },
        onPartialQuestions: liveAppendToVisible
          ? (partialQs, _batchIndex) => {
              if (partialQs.length > 0) queuePartialQuestions(partialQs);
            }
          : undefined,
      }
    );

    await flushPartialQuestions();

    phaseQuestions = sortMcqsByQuestionNumber(res.questions);
    phaseDuplicates = [...(res.duplicates || [])];
    phaseAutoSkippedCount = res.autoSkippedCount || phaseAutoSkippedCount;

    await updateActiveSession({
      totalTopLevelBatches: retryIndices?.length || activeSessionRef.current?.totalTopLevelBatches || 0,
      failedBatchIndices: res.failedBatches || [],
      failedBatchDetails: res.failedBatchDetails || [],
      currentCount: renderCompletedBatchesToVisible ? mcqsRef.current.length : phaseQuestions.length,
      mcqsSnapshot: mcqsRef.current,
      duplicatesSnapshot: phaseDuplicates,
      autoSkippedCount: renderCompletedBatchesToVisible ? phaseAutoSkippedCount : (activeSessionRef.current?.autoSkippedCount || phaseAutoSkippedCount),
      phaseQuestionsSnapshot: phaseQuestions,
      phaseDuplicatesSnapshot: phaseDuplicates,
      phaseAutoSkippedCount: phaseAutoSkippedCount,
      phaseCurrentCount: phaseQuestions.length,
    });

    return {
      res,
      phaseQuestions,
      phaseDuplicates,
      phaseAutoSkippedCount,
    };
  };

  return { runGenerationPhase };
};
