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
import { hasRecentSlowMetrics, scheduleIdleTask } from '../utils/performance';

const COMPLETED_BATCH_VISIBLE_FLUSH_COUNT = 40;
const COMPLETED_BATCH_VISIBLE_FLUSH_MS = 2500;
const CHECKPOINT_BATCH_INTERVAL = 5;
const CHECKPOINT_INTERVAL_MS = 10000;
const PARTIAL_VISIBLE_FLUSH_MS = 650;
const PARTIAL_VISIBLE_FLUSH_CHUNK_SIZE = 16;
const COMPLETED_VISIBLE_FLUSH_CHUNK_SIZE = 60;
const REALTIME_PREVIEW_VISIBLE_LIMIT = 160;
const VISIBLE_FLUSH_LONG_TASK_MS = 70;

const getNowMs = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

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

    let partialFlushCancel: (() => void) | null = null;
    let pendingPartialQuestions: MCQ[] = [];
    let partialFlushInFlight = false;
    let partialFlushPromise: Promise<void> | null = null;
    let realtimePreviewAutoDisabled = false;
    let completedBatchFlushCancel: (() => void) | null = null;
    let pendingCompletedBatchQuestions: MCQ[] = [];
    let completedFlushInFlight = false;
    let completedFlushPromise: Promise<void> | null = null;

    const flushPartialQuestions = async () => {
      if (partialFlushCancel !== null) {
        partialFlushCancel();
        partialFlushCancel = null;
      }
      if (partialFlushInFlight || pendingPartialQuestions.length === 0 || realtimePreviewAutoDisabled) return;
      if (hasRecentSlowMetrics({ sinceMs: 4000, threshold: 3, includeLongTasks: true })) {
        realtimePreviewAutoDisabled = true;
        pendingPartialQuestions = [];
        return;
      }
      if (mcqsRef.current.length >= REALTIME_PREVIEW_VISIBLE_LIMIT) {
        realtimePreviewAutoDisabled = true;
        pendingPartialQuestions = [];
        return;
      }
      partialFlushInFlight = true;
      const batch = pendingPartialQuestions.splice(0, PARTIAL_VISIBLE_FLUSH_CHUNK_SIZE);
      const startedAt = getNowMs();
      try {
        await appendVisibleMcqs(batch, { persist: false });
      } finally {
        partialFlushInFlight = false;
      }
      if (getNowMs() - startedAt > VISIBLE_FLUSH_LONG_TASK_MS) {
        realtimePreviewAutoDisabled = true;
        pendingPartialQuestions = [];
        return;
      }
      if (pendingPartialQuestions.length > 0) schedulePartialFlush(120);
    };

    const schedulePartialFlush = (timeout = PARTIAL_VISIBLE_FLUSH_MS) => {
      if (partialFlushCancel !== null || realtimePreviewAutoDisabled) return;
      partialFlushCancel = scheduleIdleTask(() => {
        partialFlushCancel = null;
        const promise = flushPartialQuestions();
        const tracked = promise.finally(() => {
          if (partialFlushPromise === tracked) partialFlushPromise = null;
        });
        partialFlushPromise = tracked;
      }, timeout);
    };

    const queuePartialQuestions = (partialQuestions: MCQ[]) => {
      if (realtimePreviewAutoDisabled || mcqsRef.current.length >= REALTIME_PREVIEW_VISIBLE_LIMIT) {
        realtimePreviewAutoDisabled = true;
        pendingPartialQuestions = [];
        return;
      }
      pendingPartialQuestions.push(...partialQuestions);
      schedulePartialFlush(pendingPartialQuestions.length >= PARTIAL_VISIBLE_FLUSH_CHUNK_SIZE ? 120 : PARTIAL_VISIBLE_FLUSH_MS);
    };

    const flushVisibleQuestions = async () => {
      if (completedBatchFlushCancel !== null) {
        completedBatchFlushCancel();
        completedBatchFlushCancel = null;
      }
      if (completedFlushInFlight || pendingCompletedBatchQuestions.length === 0) return;
      completedFlushInFlight = true;
      const batch = pendingCompletedBatchQuestions.splice(0, COMPLETED_VISIBLE_FLUSH_CHUNK_SIZE);
      try {
        await appendVisibleMcqs(batch, { persist: true });
      } finally {
        completedFlushInFlight = false;
      }
      if (pendingCompletedBatchQuestions.length > 0) scheduleCompletedBatchFlush(120);
    };

    const scheduleCompletedBatchFlush = (timeout = COMPLETED_BATCH_VISIBLE_FLUSH_MS) => {
      if (completedBatchFlushCancel !== null) return;
      completedBatchFlushCancel = scheduleIdleTask(() => {
        completedBatchFlushCancel = null;
        const promise = flushVisibleQuestions();
        const tracked = promise.finally(() => {
          if (completedFlushPromise === tracked) completedFlushPromise = null;
        });
        completedFlushPromise = tracked;
      }, timeout);
    };

    const queueCompletedBatchQuestions = (questions: MCQ[]) => {
      if (!renderCompletedBatchesToVisible || questions.length === 0) return;
      pendingCompletedBatchQuestions.push(...questions);
      scheduleCompletedBatchFlush(
        pendingCompletedBatchQuestions.length >= COMPLETED_BATCH_VISIBLE_FLUSH_COUNT
          ? 120
          : COMPLETED_BATCH_VISIBLE_FLUSH_MS
      );
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
            const hasFullSnapshot = checkpoint.snapshotKind !== 'metadata' && Array.isArray(checkpoint.questionsSnapshot);
            void updateActiveSession({
              totalTopLevelBatches: checkpoint.totalTopLevelBatches,
              completedBatchIndices: checkpoint.completedBatchIndices,
              failedBatchIndices: checkpoint.failedBatchIndices,
              failedBatchDetails: checkpoint.failedBatchDetails,
              currentCount: checkpoint.currentCount,
              ...(hasFullSnapshot ? {
                mcqsSnapshot: checkpoint.questionsSnapshot || [],
                duplicatesSnapshot: checkpoint.duplicatesSnapshot || [],
              } : {}),
              autoSkippedCount: checkpoint.autoSkippedCount,
              ...(hasFullSnapshot ? {
                phaseQuestionsSnapshot: checkpoint.questionsSnapshot || [],
                phaseDuplicatesSnapshot: checkpoint.duplicatesSnapshot || [],
              } : {}),
              phaseAutoSkippedCount: checkpoint.autoSkippedCount,
              phaseCurrentCount: checkpoint.currentCount,
            });
            if (!renderCompletedBatchesToVisible && hasFullSnapshot) void persistMcqs(checkpoint.questionsSnapshot || []);
          },
          onPartialQuestions: liveAppendToVisible
            ? (partialQs, _batchIndex) => {
                if (partialQs.length > 0) queuePartialQuestions(partialQs);
              }
            : undefined,
        }
      );
    } finally {
      if (partialFlushPromise) await partialFlushPromise;
      while (pendingPartialQuestions.length > 0 && !realtimePreviewAutoDisabled) {
        await flushPartialQuestions();
      }
      if (completedFlushPromise) await completedFlushPromise;
      while (pendingCompletedBatchQuestions.length > 0) {
        await flushVisibleQuestions();
      }
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
