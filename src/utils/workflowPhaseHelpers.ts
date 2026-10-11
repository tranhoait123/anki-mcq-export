import {
  AppSettings,
  DuplicateInfo,
  GeneratedResponse,
  MCQ,
  ProcessingController,
  UploadedFile,
} from '../types';
import { shouldDelayAutoRescue } from './resumeSession';
import { RunGenerationPhaseParams, RunGenerationPhaseResult } from '../hooks/useGenerationPhase';

export type McqGeneratedResponse = Omit<GeneratedResponse, 'questions'> & { questions: MCQ[] };

export interface RunAutoFallbackPhaseParams {
  files?: UploadedFile[];
  filesToUse: UploadedFile[];
  estimatedCount?: number;
  currentRes: McqGeneratedResponse;
  settingsSnapshot?: AppSettings;
  controller?: ProcessingController;
  prepareFiles?: any;
  runGenerationPhase?: any;
  setVisibleMcqs?: any;
  setFailedBatchIndices?: any;
  setProgressStatus?: any;
  waitWithController?: any;
  seedQuestions?: MCQ[];
  seedDuplicates?: DuplicateInfo[];
}

export interface RunAutoFallbackPhaseResult {
  res: McqGeneratedResponse;
  filesToUse: UploadedFile[];
}

/**
 * Pure Multimodal Vision: No local OCR fallback needed. Returns existing response directly.
 */
export const runAutoFallbackPhaseIfNeeded = async ({
  filesToUse,
  currentRes,
}: RunAutoFallbackPhaseParams): Promise<RunAutoFallbackPhaseResult> => {
  return { res: currentRes, filesToUse };
};

export interface RunAutoRescuePhaseParams {
  mainBatchOnlyRescue?: boolean;
  res: McqGeneratedResponse;
  filesToUse: UploadedFile[];
  settingsSnapshot: AppSettings;
  expectedQuestionCount: number;
  controller: ProcessingController;
  seedQuestions?: MCQ[];
  runGenerationPhase: (params: RunGenerationPhaseParams) => Promise<RunGenerationPhaseResult>;
  deduplicateQuestions: (newList: MCQ[], existingList: MCQ[]) => MCQ[];
  setProgressStatus: (status: string) => void;
}

export interface RunAutoRescuePhaseResult {
  res: McqGeneratedResponse;
  autoRescuedCount: number;
}

/**
 * Checks for failed batches and attempts targeted auto-rescue if provider pressure permits.
 */
export const runAutoRescuePhaseIfNeeded = async ({
  mainBatchOnlyRescue,
  res,
  filesToUse,
  settingsSnapshot,
  expectedQuestionCount,
  controller,
  seedQuestions = [],
  runGenerationPhase,
  deduplicateQuestions,
  setProgressStatus,
}: RunAutoRescuePhaseParams): Promise<RunAutoRescuePhaseResult> => {
  if (mainBatchOnlyRescue || !res.failedBatches || res.failedBatches.length === 0) {
    return { res, autoRescuedCount: 0 };
  }

  const initialFailed = [...res.failedBatches];
  if (shouldDelayAutoRescue(res.failedBatchDetails || [], initialFailed)) {
    setProgressStatus(
      `Provider đang nóng hoặc còn nhiều batch cứu thiếu; giữ ${initialFailed.length} phần lỗi để quét lại sau thay vì chạy cứu ngay.`
    );
    return { res, autoRescuedCount: 0 };
  }

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
      renderCompletedBatchesToVisible: true,
      seedQuestions: res.questions.length > 0 ? res.questions : seedQuestions,
      seedDuplicates: res.duplicates || [],
    });
    const rescueRes = rescuePhase.res;
    const uniqueRescued = deduplicateQuestions(rescueRes.questions, res.questions);
    const autoRescuedCount = uniqueRescued.length;

    return {
      res: {
        ...res,
        questions: [...res.questions, ...uniqueRescued],
        duplicates: [...(res.duplicates || []), ...(rescueRes.duplicates || [])],
        failedBatches: rescueRes.failedBatches || [],
        failedBatchDetails: rescueRes.failedBatchDetails || [],
        autoSkippedCount: (res.autoSkippedCount || 0) + (rescueRes.autoSkippedCount || 0),
      },
      autoRescuedCount,
    };
  } catch (rescueError) {
    console.warn('Auto-rescue failed:', rescueError);
    return { res, autoRescuedCount: 0 };
  }
};
