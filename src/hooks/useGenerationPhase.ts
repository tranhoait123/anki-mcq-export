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
import { db } from '../core/db';
import { sortMcqsByQuestionNumber } from '../utils/appHelpers';
import { scheduleIdleTask } from '../utils/performance';

const COMPLETED_BATCH_VISIBLE_FLUSH_COUNT = 40;
const COMPLETED_BATCH_VISIBLE_FLUSH_MS = 2500;
const CHECKPOINT_BATCH_INTERVAL = 5;
const CHECKPOINT_INTERVAL_MS = 10000;
const COMPLETED_VISIBLE_FLUSH_CHUNK_SIZE = 60;

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
  renderCompletedBatchesToVisible?: boolean;
  comparisonBaselineCount?: number;
  comparisonFailedBatchIndices?: number[];
  comparisonFailedBatchDetails?: GeneratedResponse['failedBatchDetails'];
  existingCompletedBatchIndices?: number[];
  deprioritizedBatchIndices?: number[];
  skipInferredCompletedBatches?: boolean;
  forcedOcrMode?: 'gemini' | 'tesseract';
  resumeMode?: boolean;
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
  persistSession: (session: ProcessingSession, options?: { compact?: boolean }) => Promise<void>;
  setCurrentCount: React.Dispatch<React.SetStateAction<number>>;
  setProgressStatus: React.Dispatch<React.SetStateAction<string>>;
  updateActiveSession: (partial: Partial<ProcessingSession>, options?: { persist?: boolean; compact?: boolean }) => Promise<ProcessingSession | null>;
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
    renderCompletedBatchesToVisible = false,
    comparisonBaselineCount,
    comparisonFailedBatchIndices = [],
    comparisonFailedBatchDetails = [],
    existingCompletedBatchIndices = [],
    deprioritizedBatchIndices = [],
    skipInferredCompletedBatches = false,
    forcedOcrMode,
    resumeMode,
  }: RunGenerationPhaseParams): Promise<RunGenerationPhaseResult> => {
    let phaseQuestions = sortMcqsByQuestionNumber(seedQuestions);
    let phaseDuplicates = [...seedDuplicates];
    let phaseAutoSkippedCount = seedAutoSkippedCount;
    const isTargetedRepairPhase = Boolean(retryIndices?.length) || phase === 'rescue' || phase === 'retryFailed';
    const useCompactSessionPersistence = renderCompletedBatchesToVisible && isTargetedRepairPhase;

    const initialSession = await buildSessionBase(phase, requestSettings, {
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
    });
    await persistSession(initialSession, { compact: useCompactSessionPersistence });

    let completedBatchFlushCancel: (() => void) | null = null;
    let pendingCompletedBatchQuestions: MCQ[] = [];
    let completedFlushInFlight = false;
    let completedFlushPromise: Promise<void> | null = null;

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
          if (renderCompletedBatchesToVisible && newBatch.length > 0) void db.upsertMCQs(newBatch);
          queueCompletedBatchQuestions(newBatch);
        },
        retryIndices,
        isAdvancedMode,
        {
          controller,
          retryProfile,
          autoRescue,
          resumeMode: resumeMode !== undefined ? resumeMode : (existingCompletedBatchIndices.length > 0),
          skipInferredCompletedBatches: skipInferredCompletedBatches || Boolean(retryIndices?.length),
          completedBatchIndices: existingCompletedBatchIndices,
          deprioritizedBatchIndices,
          existingQuestions: phaseQuestions,
          existingDuplicates: phaseDuplicates,
          existingAutoSkippedCount: phaseAutoSkippedCount,
          sessionPhase: phase,
          checkpointBatchInterval: CHECKPOINT_BATCH_INTERVAL,
          checkpointIntervalMs: CHECKPOINT_INTERVAL_MS,
          lightweightCheckpoints: useCompactSessionPersistence,
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
            }, { compact: renderCompletedBatchesToVisible && (useCompactSessionPersistence || !hasFullSnapshot) });
            if (!renderCompletedBatchesToVisible && hasFullSnapshot) void persistMcqs(checkpoint.questionsSnapshot || []);
          },
        }
      );
    } finally {
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
    }, { compact: renderCompletedBatchesToVisible && useCompactSessionPersistence });

    return {
      res,
      phaseQuestions,
      phaseDuplicates,
      phaseAutoSkippedCount,
    };
  };

  return { runGenerationPhase };
};
