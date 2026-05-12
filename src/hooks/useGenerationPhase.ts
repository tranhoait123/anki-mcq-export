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

const COMPLETED_BATCH_VISIBLE_FLUSH_COUNT = 40;
const COMPLETED_BATCH_VISIBLE_FLUSH_MS = 2500;
const CHECKPOINT_BATCH_INTERVAL = 5;
const CHECKPOINT_INTERVAL_MS = 10000;

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
  updateActiveSession: (partial: Partial<ProcessingSession>, options?: { persist?: boolean }) => Promise<ProcessingSession | null>;
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
    let completedBatchFlushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingCompletedBatchQuestions: MCQ[] = [];

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

    const flushVisibleQuestions = async () => {
      if (completedBatchFlushTimer !== null) {
        clearTimeout(completedBatchFlushTimer);
        completedBatchFlushTimer = null;
      }
      if (pendingCompletedBatchQuestions.length === 0) return;
      const batch = pendingCompletedBatchQuestions;
      pendingCompletedBatchQuestions = [];
      await appendVisibleMcqs(batch, { persist: true });
    };

    const queueCompletedBatchQuestions = (questions: MCQ[]) => {
      if (!renderCompletedBatchesToVisible || questions.length === 0) return;
      pendingCompletedBatchQuestions.push(...questions);
      if (pendingCompletedBatchQuestions.length >= COMPLETED_BATCH_VISIBLE_FLUSH_COUNT) {
        void flushVisibleQuestions();
        return;
      }
      if (completedBatchFlushTimer !== null) return;
      completedBatchFlushTimer = setTimeout(() => {
        void flushVisibleQuestions();
      }, COMPLETED_BATCH_VISIBLE_FLUSH_MS);
    };

    let res: Awaited<ReturnType<typeof generateQuestions>>;
    try {
      res = await generateQuestions(
        filesToUse,
        requestSettings,
        0,
        (status, count) => {
          setProgressStatus(progressPrefix ? `${progressPrefix}${status}` : status);
          setCurrentCount(count);
        },
        expectedQuestionCount,
        (newBatch) => {
          phaseQuestions = sortMcqsByQuestionNumber([...phaseQuestions, ...newBatch]);
          queueCompletedBatchQuestions(newBatch);
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
          checkpointBatchInterval: CHECKPOINT_BATCH_INTERVAL,
          checkpointIntervalMs: CHECKPOINT_INTERVAL_MS,
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
            if (!renderCompletedBatchesToVisible) void persistMcqs(checkpoint.questionsSnapshot);
          },
          onPartialQuestions: liveAppendToVisible
            ? (partialQs, _batchIndex) => {
                if (partialQs.length > 0) queuePartialQuestions(partialQs);
              }
            : undefined,
        }
      );
    } finally {
      await flushPartialQuestions();
      await flushVisibleQuestions();
    }

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
