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
