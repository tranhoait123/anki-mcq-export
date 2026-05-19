import { DuplicateInfo, MCQ, SourceTrace } from '../../types';
import { buildMCQFingerprint, createDuplicateLookup } from '../../utils/dedupe';
import {
  applySharedCaseContextToQuestion,
  extractSharedCaseContexts,
  getSharedCaseContextForQuestion,
  hasSharedCaseStem,
  normalizeSharedCaseQuestion,
} from '../../utils/sharedCaseContext';
import { yieldToMain } from '../../utils/performance';
import { applyTrustedSourceMetadata } from './batching';
import { parseQuestionsFromModelText } from './parsing';

export interface BatchPostprocessPartMeta {
  sourceLabel?: string;
  text?: string;
  trace?: SourceTrace;
  sourceMode?: string;
}

export interface BatchPostprocessInput {
  allowEmpty: boolean;
  batchIndex: number;
  duplicateCounterStart?: number;
  enforceExpectedCount?: boolean;
  expectedQuestions: number;
  fullText: string;
  partMeta: BatchPostprocessPartMeta;
  recoveryBudgetRemaining?: number | null;
  replaceSeededSourceDuplicates?: boolean;
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
  usedApiKey?: string;
}

export interface BatchPostprocessState {
  batchQuestionIds: Map<number, Set<string>>;
  duplicateCounter: number;
  questionIdsBySource: Map<string, Set<string>>;
  questions: MCQ[];
}

export interface BatchPostprocessOptions {
  cooperative?: boolean;
  yieldEvery?: number;
}

export const compactQuestionForDedupe = (question: MCQ): MCQ => ({
  id: question.id,
  question: question.question,
  options: Array.isArray(question.options) ? question.options.slice(0, 5) : [],
  correctAnswer: question.correctAnswer,
  explanation: {
    core: '',
    evidence: '',
    analysis: '',
    warning: '',
  },
  source: question.source,
  trace: question.trace ? { ...question.trace } : undefined,
  sharedCase: question.sharedCase ? { ...question.sharedCase } : undefined,
  difficulty: question.difficulty || '',
  depthAnalysis: question.depthAnalysis || '',
});

const normalizeSourceForBatch = (value: string = ''): string =>
  String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();

const addQuestionIdToSourceIndex = (
  sourceIndex: Map<string, Set<string>>,
  question: Partial<MCQ>
) => {
  if (!question.id) return;
  const sourceKey = normalizeSourceForBatch(question.source || question.trace?.sourceLabel || '');
  if (!sourceKey) return;
  let ids = sourceIndex.get(sourceKey);
  if (!ids) {
    ids = new Set();
    sourceIndex.set(sourceKey, ids);
  }
  ids.add(question.id);
};

export const createBatchPostprocessState = (
  seedQuestions: MCQ[] = [],
  duplicateCounter = 0
): BatchPostprocessState => {
  const questions = seedQuestions.map(compactQuestionForDedupe);
  const state: BatchPostprocessState = {
    batchQuestionIds: new Map(),
    duplicateCounter,
    questionIdsBySource: new Map(),
    questions,
  };
  questions.forEach(question => addQuestionIdToSourceIndex(state.questionIdsBySource, question));
  return state;
};

const buildCoverageKey = (question: Partial<MCQ>): string => (
  `fp:${buildMCQFingerprint(question)}`
);

const countSharedCaseMarkers = (value: string = ''): number =>
  (String(value || '').match(/\[\s*(?:tình\s*huống|tinh\s*huong|câu\s*hỏi|cau\s*hoi)\s*\]/gi) || []).length;

const COMMON_CLINICAL_ALNUM_TOKENS = new Set(['spo2', 'hba1c', 'co2', 'o2', 't1', 't2', 't3', 'b12']);

const countOcrArtifactSignals = (value: string = ''): number => {
  const text = String(value || '');
  const explicitMatches: string[] = text.match(/\b(?:sir|gid|ngot|d6ng|kh6|g8y|teorong|ying|mats|mat\s+batch|ph[ée]di)\b/gi) || [];
  const explicitTokens = new Set(explicitMatches.map(match => match.toLowerCase()));
  const mixedAlphaNumericTokens: string[] = text.match(/\b[\p{L}\p{N}]{3,}\b/gu) || [];
  const mixedArtifactCount = mixedAlphaNumericTokens.filter((token) => {
    const normalized = token.toLowerCase();
    return (
      !explicitTokens.has(normalized) &&
      !COMMON_CLINICAL_ALNUM_TOKENS.has(normalized) &&
      /\p{L}/u.test(token) &&
      /\p{N}/u.test(token)
    );
  }).length;
  return explicitMatches.length + mixedArtifactCount;
};

const countVietnameseSignals = (value: string = ''): number =>
  (String(value || '').match(/[ăâêôơưđáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/gi) || []).length;

const replacementQualityScore = (question: Partial<MCQ>): number => {
  const questionText = String(question.question || '');
  const normalizedQuestion = normalizeSharedCaseQuestion(questionText);
  const normalizedImprovement = normalizedQuestion !== questionText.trim() ? -20 : 0;
  return (
    countVietnameseSignals(questionText) * 2 +
    (Array.isArray(question.options) ? question.options.filter(Boolean).length : 0) * 3 -
    countSharedCaseMarkers(questionText) * 18 -
    countOcrArtifactSignals(questionText) * 12 +
    normalizedImprovement
  );
};

const shouldReplaceSeededSourceQuestion = (existing: Partial<MCQ> | undefined, candidate: Partial<MCQ>): boolean => {
  if (!existing?.question) return true;
  const existingText = String(existing.question || '');
  const candidateText = String(candidate.question || '');
  const existingMarkers = countSharedCaseMarkers(existingText);
  const candidateMarkers = countSharedCaseMarkers(candidateText);
  const candidateDropsSharedCaseContext = existingMarkers >= 2 && candidateMarkers < 2;
  if (candidateDropsSharedCaseContext) return false;
  if (existingMarkers > 2 && existingMarkers > candidateMarkers) return true;

  const existingOcrArtifacts = countOcrArtifactSignals(existingText);
  const candidateOcrArtifacts = countOcrArtifactSignals(candidateText);
  if (existingOcrArtifacts > candidateOcrArtifacts && countVietnameseSignals(candidateText) >= countVietnameseSignals(existingText)) {
    return true;
  }

  return replacementQualityScore(candidate) > replacementQualityScore(existing) + 12;
};

export const applySharedCaseMetadata = (questions: MCQ[], partMeta: BatchPostprocessPartMeta) => {
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
      addQuestionIdToSourceIndex(state.questionIdsBySource, question);
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
    {
      allowEmpty: input.allowEmpty,
      enforceExpectedCount: input.enforceExpectedCount ?? (input.partMeta?.sourceMode !== 'pdfVision'),
    }
  ) as MCQ[];
  const salvagedPartial = Boolean((rawQuestions as any).__salvagedPartial);
  const missingCount = Number((rawQuestions as any).__missingCount || 0);

  applyTrustedSourceMetadata(rawQuestions, input.partMeta);
  applySharedCaseMetadata(rawQuestions, input.partMeta);

  const duplicateLookup = createDuplicateLookup<MCQ>(state.questions);
  const newQuestions: MCQ[] = [];
  const duplicates: DuplicateInfo[] = [];
  const coverageKeys: string[] = [];
  let batchQuestionIds = state.batchQuestionIds.get(input.topLevelBatchNumber);
  if (!batchQuestionIds) {
    batchQuestionIds = new Set<string>();
    state.batchQuestionIds.set(input.topLevelBatchNumber, batchQuestionIds);
  }
  const sourceKey = normalizeSourceForBatch(input.partMeta.sourceLabel || '');
  const seededIdsFromSameSource = sourceKey ? state.questionIdsBySource.get(sourceKey) : null;
  seededIdsFromSameSource?.forEach(id => batchQuestionIds.add(id));
  let autoSkippedCount = 0;
  let duplicateCounterDelta = 0;
  let recoveryBudgetRemaining = input.recoveryBudgetRemaining ?? null;
  const yieldEvery = Math.max(1, options.yieldEvery || 8);
  const markRecoveryCovered = () => {
    if (recoveryBudgetRemaining !== null) {
      recoveryBudgetRemaining = Math.max(0, recoveryBudgetRemaining - 1);
    }
  };

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
      markRecoveryCovered();
      continue;
    }

    const matchedSeedId = result.matchedData?.id;
    if (
      input.replaceSeededSourceDuplicates &&
      matchedSeedId &&
      seededIdsFromSameSource?.has(matchedSeedId) &&
      shouldReplaceSeededSourceQuestion(result.matchedData, question)
    ) {
      question.id = matchedSeedId;
      newQuestions.push(question);
      coverageKeys.push(buildCoverageKey(question));
      duplicateLookup.add(question);
      markRecoveryCovered();
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
    markRecoveryCovered();
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
