import { DuplicateInfo, MCQ, SourceTrace } from '../../types';
import { buildMCQFingerprint, createDuplicateLookup } from '../../utils/dedupe';
import {
  applySharedCaseContextToQuestion,
  extractSharedCaseContexts,
  getSharedCaseContextForQuestion,
  hasSharedCaseStem,
} from '../../utils/sharedCaseContext';
import { yieldToMain } from '../../utils/performance';
import { applyTrustedSourceMetadata } from './batching';
import { parseQuestionsFromModelText } from './parsing';

export interface BatchPostprocessPartMeta {
  sourceLabel?: string;
  text?: string;
  trace?: SourceTrace;
}

export interface BatchPostprocessInput {
  allowEmpty: boolean;
  batchIndex: number;
  duplicateCounterStart?: number;
  expectedQuestions: number;
  fullText: string;
  partMeta: BatchPostprocessPartMeta;
  recoveryBudgetRemaining?: number | null;
  topLevelBatchNumber: number;
}

export interface BatchPostprocessResult {
  autoSkippedCount: number;
  coverageKeys: string[];
  duplicateCounterDelta: number;
  duplicates: DuplicateInfo[];
  missingCount: number;
  newQuestions: MCQ[];
  rawQuestions: MCQ[];
  recoveryBudgetRemaining?: number | null;
  salvagedPartial: boolean;
}

export interface BatchPostprocessState {
  batchQuestionIds: Map<number, Set<string>>;
  duplicateCounter: number;
  questions: MCQ[];
}

export interface BatchPostprocessOptions {
  cooperative?: boolean;
  yieldEvery?: number;
}

export const createBatchPostprocessState = (
  seedQuestions: MCQ[] = [],
  duplicateCounter = 0
): BatchPostprocessState => ({
  batchQuestionIds: new Map(),
  duplicateCounter,
  questions: [...seedQuestions],
});

const buildCoverageKey = (question: Partial<MCQ>): string => (
  question.id ? `id:${question.id}` : `fp:${buildMCQFingerprint(question)}`
);

const applySharedCaseMetadata = (questions: MCQ[], partMeta: BatchPostprocessPartMeta) => {
  const sharedCaseContexts = partMeta.text ? extractSharedCaseContexts(partMeta.text) : [];
  if (sharedCaseContexts.length === 0) return;

  questions.forEach((question) => {
    if (!question || typeof question.question !== 'string') return;
    const context = getSharedCaseContextForQuestion(question.question, sharedCaseContexts);
    if (!context) return;
    const hadStem = hasSharedCaseStem(question.question, context.stem);
    question.question = applySharedCaseContextToQuestion(question.question, sharedCaseContexts);
    const hasStemAfter = hasSharedCaseStem(question.question, context.stem);
    if (!hadStem && hasStemAfter) {
      question.sharedCase = {
        applied: true,
        confidence: context.confidence,
        stem: context.stem,
        startQuestion: context.startQuestion,
        endQuestion: context.endQuestion,
        sourceLabel: partMeta.sourceLabel,
        pageRange: partMeta.trace?.pageRange,
      };
    } else if (!hasStemAfter && question.explanation && typeof question.explanation.warning === 'string') {
      question.explanation.warning = `${question.explanation.warning ? `${question.explanation.warning}\n\n` : ''}⚠️ Câu này nằm trong nhóm có tình huống chung (${context.startQuestion}-${context.endQuestion}) nhưng app chưa ghép được stem chắc chắn. Cần kiểm tra lại nguồn.`.trim();
    }
  });
};

export const ingestBatchPostprocessResult = (
  state: BatchPostprocessState,
  result: Pick<BatchPostprocessResult, 'duplicateCounterDelta' | 'newQuestions'>,
  topLevelBatchNumber: number
) => {
  if (result.newQuestions.length > 0) {
    state.questions.push(...result.newQuestions);
    let ids = state.batchQuestionIds.get(topLevelBatchNumber);
    if (!ids) {
      ids = new Set();
      state.batchQuestionIds.set(topLevelBatchNumber, ids);
    }
    result.newQuestions.forEach((question) => {
      if (question.id) ids!.add(question.id);
    });
  }
  state.duplicateCounter += result.duplicateCounterDelta;
};

export const processBatchPostprocess = async (
  input: BatchPostprocessInput,
  state: BatchPostprocessState,
  options: BatchPostprocessOptions = {}
): Promise<BatchPostprocessResult> => {
  const rawQuestions = parseQuestionsFromModelText(
    input.fullText,
    input.batchIndex,
    input.expectedQuestions,
    { allowEmpty: input.allowEmpty }
  ) as MCQ[];
  const salvagedPartial = Boolean((rawQuestions as any).__salvagedPartial);
  const missingCount = Number((rawQuestions as any).__missingCount || 0);

  applyTrustedSourceMetadata(rawQuestions, input.partMeta);
  applySharedCaseMetadata(rawQuestions, input.partMeta);

  const duplicateLookup = createDuplicateLookup<MCQ>(state.questions);
  const newQuestions: MCQ[] = [];
  const duplicates: DuplicateInfo[] = [];
  const coverageKeys: string[] = [];
  const batchQuestionIds = state.batchQuestionIds.get(input.topLevelBatchNumber) || new Set<string>();
  let autoSkippedCount = 0;
  let duplicateCounterDelta = 0;
  let recoveryBudgetRemaining = input.recoveryBudgetRemaining ?? null;
  const yieldEvery = Math.max(1, options.yieldEvery || 8);

  for (let index = 0; index < rawQuestions.length; index++) {
    if (recoveryBudgetRemaining !== null && recoveryBudgetRemaining <= 0) break;
    if (options.cooperative && index > 0 && index % yieldEvery === 0) await yieldToMain();

    const question = rawQuestions[index];
    const result = duplicateLookup.find(question);
    if (!result.isDup) {
      question.id = `mcq-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
      newQuestions.push(question);
      coverageKeys.push(buildCoverageKey(question));
      duplicateLookup.add(question);
      if (recoveryBudgetRemaining !== null) {
        recoveryBudgetRemaining = Math.max(0, recoveryBudgetRemaining - 1);
      }
      continue;
    }

    duplicateCounterDelta++;
    const sameTopLevelBatchDuplicate = Boolean(result.matchedData?.id && batchQuestionIds.has(result.matchedData.id));
    if (!result.isAutoSkip) {
      if (sameTopLevelBatchDuplicate) continue;
      duplicates.push({
        id: `dup-${Date.now()}-${state.duplicateCounter + duplicateCounterDelta}`,
        question: question.question.substring(0, 50),
        reason: result.reason || 'Duplicate found',
        matchedWith: result.matchedWith || result.matchedData?.question?.substring(0, 60) || 'Câu hỏi đã có',
        fullData: question,
        matchedData: result.matchedData,
        score: result.score,
        fieldScores: result.fieldScores,
        evidence: result.evidence,
      });
      continue;
    }

    if (sameTopLevelBatchDuplicate) continue;
    coverageKeys.push(buildCoverageKey(result.matchedData || question));
    autoSkippedCount++;
  }

  const result: BatchPostprocessResult = {
    autoSkippedCount,
    coverageKeys,
    duplicateCounterDelta,
    duplicates,
    missingCount,
    newQuestions,
    rawQuestions,
    recoveryBudgetRemaining,
    salvagedPartial,
  };

  ingestBatchPostprocessResult(state, result, input.topLevelBatchNumber);
  return result;
};
