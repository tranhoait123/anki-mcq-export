import { describe, expect, it, vi } from 'vitest';
import { runAutoFallbackPhaseIfNeeded, runAutoRescuePhaseIfNeeded, McqGeneratedResponse } from './workflowPhaseHelpers';
import { AppSettings, MCQ, ProcessingController, UploadedFile } from '../types';

const mockSettings: AppSettings = {
  provider: 'google',
  model: 'gemini-3.1-flash-lite',
  apiKey: 'test-key',
  shopAIKeyKey: '',
  customPrompt: '',
};

const makeMockQuestion = (id: number): MCQ => ({
  id: `q-${id}`,
  question: `Câu hỏi ${id}`,
  options: ['A. 1', 'B. 2', 'C. 3', 'D. 4'],
  correctAnswer: 'A',
  explanation: { core: 'core', evidence: 'evi', analysis: 'ana', warning: 'warn' },
  source: 'test',
  difficulty: 'Medium',
  depthAnalysis: 'Standard',
});

const mockController: ProcessingController = {
  getState: () => 'running',
  isPaused: () => false,
  isPauseRequested: () => false,
  requestPause: () => {},
  resume: () => {},
  waitIfPaused: async () => {},
};

describe('workflowPhaseHelpers', () => {
  describe('runAutoFallbackPhaseIfNeeded', () => {
    it('returns current result directly as pure multimodal pass-through', async () => {
      const currentRes: McqGeneratedResponse = {
        questions: [makeMockQuestion(1)],
        autoSkippedCount: 0,
      };
      const files: UploadedFile[] = [{ id: '1', name: 'img.png', type: 'image/png', content: 'base64' }];

      const result = await runAutoFallbackPhaseIfNeeded({
        files,
        filesToUse: files,
        currentRes,
      });

      expect(result.res).toBe(currentRes);
      expect(result.filesToUse).toBe(files);
    });
  });

  describe('runAutoRescuePhaseIfNeeded', () => {
    it('does nothing when mainBatchOnlyRescue is true or no failed batches', async () => {
      const res: McqGeneratedResponse = {
        questions: [makeMockQuestion(1)],
        failedBatches: [],
        autoSkippedCount: 0,
      };

      const result = await runAutoRescuePhaseIfNeeded({
        mainBatchOnlyRescue: true,
        res,
        filesToUse: [],
        settingsSnapshot: mockSettings,
        expectedQuestionCount: 5,
        controller: mockController,
        runGenerationPhase: vi.fn(),
        deduplicateQuestions: vi.fn(),
        setProgressStatus: vi.fn(),
      });

      expect(result.autoRescuedCount).toBe(0);
      expect(result.res).toBe(res);
    });

    it('rescues failed batches and merges rescued questions', async () => {
      const res: McqGeneratedResponse = {
        questions: [makeMockQuestion(1)],
        failedBatches: [2],
        failedBatchDetails: [{ index: 2, label: '2', kind: 'format', stage: 'normal', message: 'Lỗi', advice: '' }],
        autoSkippedCount: 0,
      };

      const rescuedQuestion = makeMockQuestion(2);
      const runGenerationPhase = vi.fn().mockResolvedValue({
        res: {
          questions: [rescuedQuestion],
          duplicates: [],
          failedBatches: [],
          failedBatchDetails: [],
          autoSkippedCount: 0,
        },
      });
      const deduplicateQuestions = vi.fn().mockReturnValue([rescuedQuestion]);
      const setProgressStatus = vi.fn();

      const result = await runAutoRescuePhaseIfNeeded({
        mainBatchOnlyRescue: false,
        res,
        filesToUse: [],
        settingsSnapshot: mockSettings,
        expectedQuestionCount: 2,
        controller: mockController,
        runGenerationPhase,
        deduplicateQuestions,
        setProgressStatus,
      });

      expect(result.autoRescuedCount).toBe(1);
      expect(result.res.questions).toHaveLength(2);
      expect(result.res.failedBatches).toEqual([]);
    });
  });
});
