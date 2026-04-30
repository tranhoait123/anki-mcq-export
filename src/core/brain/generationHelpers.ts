import {
  DuplicateInfo,
  MCQ,
  ProcessingCheckpoint,
  ProcessingController,
  ProcessingPhase,
} from "../../types";
import { RetryProfileName } from '../../utils/retryStrategy';

export interface GenerateQuestionsOptions {
  retryProfile?: RetryProfileName;
  autoRescue?: boolean;
  controller?: ProcessingController;
  resumeMode?: boolean;
  completedBatchIndices?: number[];
  existingQuestions?: MCQ[];
  existingDuplicates?: DuplicateInfo[];
  existingAutoSkippedCount?: number;
  sessionPhase?: ProcessingPhase;
  onCheckpoint?: (checkpoint: ProcessingCheckpoint) => void;
}

export const waitWithController = async (ms: number, controller?: ProcessingController): Promise<void> => {
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    await controller?.waitIfPaused();
    const step = Math.min(250, remaining);
    await new Promise((resolve) => setTimeout(resolve, step));
    remaining -= step;
  }
};

export const extractQuestionNumber = (text: string): number | null => {
  if (!text || typeof text !== 'string') return null;
  const patterns = [
    /câu\s*(?:số\s*)?(\d+)/i,
    /question\s*(\d+)/i,
    /^(\d+)\s*[.:)\]]/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
};

export const partsRequireVision = (parts: any[]): boolean => parts.some(part => Boolean(part.inlineData));
