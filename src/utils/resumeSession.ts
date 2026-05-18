import { BatchFailureInfo, MCQ } from '../types';

interface SelectPreferredPhaseOutcomeInput {
  baselineQuestions: MCQ[];
  baselineFailedBatchIndices?: number[];
  baselineFailedBatchDetails?: BatchFailureInfo[];
  baselineMode?: 'gemini' | 'tesseract';
  candidateQuestions: MCQ[];
  candidateFailedBatchIndices?: number[];
  candidateFailedBatchDetails?: BatchFailureInfo[];
  candidateMode?: 'gemini' | 'tesseract';
}

interface SelectPreferredPhaseOutcomeResult {
  useCandidate: boolean;
  questions: MCQ[];
  failedBatchIndices: number[];
  failedBatchDetails: BatchFailureInfo[];
  forcedOcrMode?: 'gemini' | 'tesseract';
}

export const selectPreferredPhaseOutcome = ({
  baselineQuestions,
  baselineFailedBatchIndices = [],
  baselineFailedBatchDetails = [],
  baselineMode,
  candidateQuestions,
  candidateFailedBatchIndices = [],
  candidateFailedBatchDetails = [],
  candidateMode,
}: SelectPreferredPhaseOutcomeInput): SelectPreferredPhaseOutcomeResult => {
  const useCandidate = candidateQuestions.length > baselineQuestions.length;
  if (useCandidate) {
    return {
      useCandidate: true,
      questions: candidateQuestions,
      failedBatchIndices: candidateFailedBatchIndices,
      failedBatchDetails: candidateFailedBatchDetails,
      forcedOcrMode: candidateMode,
    };
  }

  return {
    useCandidate: false,
    questions: baselineQuestions,
    failedBatchIndices: baselineFailedBatchIndices,
    failedBatchDetails: baselineFailedBatchDetails,
    forcedOcrMode: baselineMode,
  };
};

export const shouldDelayAutoRescue = (
  failedBatchDetails: BatchFailureInfo[] = [],
  failedBatchIndices: number[] = []
): boolean => {
  if (failedBatchIndices.length === 0) return false;
  const pressureFailureCount = failedBatchDetails.filter(detail =>
    detail.kind === 'rateLimit' || detail.kind === 'serverBusy'
  ).length;
  const heavyPressureDiagnostics = failedBatchDetails.some(detail => {
    const keyHealth = detail.diagnostics?.keyHealth || [];
    const coolingOrBusyKeys = keyHealth.filter(key =>
      key.status === 'cooldown' ||
      key.status === 'rateLimited' ||
      key.status === 'serverBusy' ||
      key.status === 'quotaBlocked' ||
      key.remainingMs > 0
    ).length;
    return coolingOrBusyKeys >= 3;
  });
  if (pressureFailureCount >= 2 || heavyPressureDiagnostics) {
    return true;
  }

  const recoveryHeavyCount = failedBatchDetails.filter(detail =>
    detail.stage === 'partial' || detail.stage === 'split'
  ).length;
  return failedBatchIndices.length >= 3 && recoveryHeavyCount >= 2;
};
