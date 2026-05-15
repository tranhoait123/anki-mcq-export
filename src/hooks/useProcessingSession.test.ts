import { describe, expect, it } from 'vitest';
import { ProcessingSession } from '../types';
import { compactProcessingSessionForPersist } from './useProcessingSession';

const question = {
  id: 'q-1',
  question: 'Câu 1. Nội dung',
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: 'A',
  explanation: {
    core: 'x'.repeat(5000),
    evidence: 'heavy',
    analysis: 'heavy',
    warning: 'heavy',
  },
  source: 'demo.pdf',
  difficulty: 'Medium',
  depthAnalysis: '',
};

const session: ProcessingSession = {
  id: 'current',
  status: 'running',
  phase: 'rescue',
  createdAt: 1,
  updatedAt: 2,
  filesFingerprint: 'abc',
  settingsSnapshot: {
    apiKey: '',
    shopAIKeyKey: '',
    provider: 'google',
    model: 'gemini-2.5-flash',
    customPrompt: '',
  },
  analysisSnapshot: null,
  totalTopLevelBatches: 14,
  completedBatchIndices: [1],
  failedBatchIndices: [2],
  failedBatchDetails: [],
  duplicatesSnapshot: [{
    id: 'dup-1',
    question: 'Duplicate',
    reason: 'mock',
    matchedWith: 'Câu 1',
    fullData: question,
    matchedData: question,
  }],
  autoSkippedCount: 0,
  currentCount: 383,
  resumeRetryIndices: [1, 2],
  mcqsSnapshot: [question],
  phaseQuestionsSnapshot: [question],
  phaseDuplicatesSnapshot: [],
  phaseAutoSkippedCount: 0,
  phaseCurrentCount: 383,
};

describe('compactProcessingSessionForPersist', () => {
  it('strips heavy snapshots while preserving resume metadata', () => {
    const compact = compactProcessingSessionForPersist(session);

    expect(compact).toMatchObject({
      id: 'current',
      phase: 'rescue',
      totalTopLevelBatches: 14,
      completedBatchIndices: [1],
      failedBatchIndices: [2],
      currentCount: 383,
      resumeRetryIndices: [1, 2],
    });
    expect(compact.mcqsSnapshot).toEqual([]);
    expect(compact.phaseQuestionsSnapshot).toEqual([]);
    expect(compact.duplicatesSnapshot).toEqual([]);
    expect(compact.phaseDuplicatesSnapshot).toEqual([]);
  });
});
