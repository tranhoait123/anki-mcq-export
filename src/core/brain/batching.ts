import { UploadedFile, MCQ, SourceTrace } from '../../types';
import { PdfPageRange } from '../../utils/pdfProcessor';
import { ModelTokenProfile } from '../../utils/models';
import { buildNativeMcqBatchText, getNativeMcqBlocks } from '../docxNative';
import { hashStringSha256 } from '../../utils/hash';

export const STRUCTURED_QUESTION_BATCH_CAP = 5;

export const getFileTextContent = (file: UploadedFile): string =>
  file.nativeText?.trim() || file.structuredText?.trim() || file.plainText?.trim() || file.content || '';

export const joinSourceLabel = (...parts: string[]): string => parts.map(part => part.trim()).filter(Boolean).join(' | ');

export const formatPageRangeLabel = (range: PdfPageRange): string =>
  range.start === range.end ? `Trang ${range.start}` : `Trang ${range.start}-${range.end}`;

export const getTrustedSourceLabel = (part: { sourceLabel?: string } = {}): string => {
  const sourceLabel = typeof part.sourceLabel === 'string' ? part.sourceLabel.trim() : '';
  return sourceLabel || 'Nguồn không xác định';
};

export const buildSourceSnippet = (text: string = '', fallback: string = ''): string => {
  const cleaned = String(text || fallback || '')
    .replace(/\[[^\]\n]{0,180}\]\s*/g, ' ')
    .replace(/<<<MCQ\s+\d+>>>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 220 ? `${cleaned.slice(0, 220).trim()}...` : cleaned;
};

const normalizeSourceLabel = (value: string = ''): string =>
  value.replace(/\s+/g, ' ').trim().toLowerCase();

export const getNativeBatchExpectedCount = (text: string): number => {
  const match = String(text || '').match(/^\[(?:DOCX_NATIVE|PDF_TEXT|MARKDOWN)_(?:BATCH|MCQ)_COUNT:\s*(\d+)\]/i);
  return match ? Number(match[1]) || 0 : 0;
};

export const inferCompletedBatchIndicesFromExistingQuestions = (
  parts: Array<{ text?: string; expectedQuestions?: number; expectedQuestionsReliable?: boolean; sourceLabel?: string }>,
  existingQuestions: MCQ[] = []
): number[] => {
  if (existingQuestions.length === 0) return [];

  const sourceCounts = new Map<string, number>();
  existingQuestions.forEach((question) => {
    const source = normalizeSourceLabel(question.source || '');
    if (!source) return;
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  });

  return parts.reduce<number[]>((completed, part, index) => {
    const nativeExpected = getNativeBatchExpectedCount(part.text || '');
    const expected = part.expectedQuestionsReliable === false
      ? nativeExpected
      : (part.expectedQuestions || nativeExpected);
    if (expected <= 0) return completed;

    const source = normalizeSourceLabel(getTrustedSourceLabel(part));
    const existingCount = sourceCounts.get(source) || 0;
    if (existingCount >= expected) completed.push(index + 1);
    return completed;
  }, []);
};

export const applyTrustedSourceLabel = <T extends { source?: string }>(questions: T[], part: { sourceLabel?: string } = {}): T[] => {
  const sourceLabel = getTrustedSourceLabel(part);
  questions.forEach((question) => {
    if (question && typeof question === 'object') question.source = sourceLabel;
  });
  return questions;
};

export const applyTrustedSourceMetadata = <T extends { source?: string; trace?: SourceTrace; question?: string }>(
  questions: T[],
  part: { sourceLabel?: string; trace?: SourceTrace } = {}
): T[] => {
  const sourceLabel = getTrustedSourceLabel(part);
  questions.forEach((question) => {
    if (!question || typeof question !== 'object') return;
    question.source = sourceLabel;
    if (part.trace) {
      const candidateQuestionNumber = Number((question as any).__questionNumber ?? (question as any).questionNumber);
      question.trace = {
        ...part.trace,
        sourceLabel,
        ...(Number.isFinite(candidateQuestionNumber) && candidateQuestionNumber > 0
          ? { questionNumber: Math.floor(candidateQuestionNumber) }
          : {}),
        snippet: part.trace.snippet || buildSourceSnippet('', question.question || ''),
      };
    }
  });
  return questions;
};

export const getDetectedDocxMcqCount = (files: UploadedFile[]): number =>
  files.reduce((total, file) => total + (file.nativeMcqCount || file.structuredMcqCount || 0), 0);

export const getNativePartBatches = (text: string, targetParts: number): string[] => {
  const blocks = getNativeMcqBlocks(text);
  if (blocks.length <= 1) return [];
  const parts = Math.min(Math.max(2, targetParts), blocks.length);
  const batchSize = Math.ceil(blocks.length / parts);
  const batches: string[] = [];
  for (let i = 0; i < blocks.length; i += batchSize) {
    batches.push(buildNativeMcqBatchText(blocks.slice(i, i + batchSize)));
  }
  return batches;
};

const normalizeRecoveryText = (value: string = ''): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(?:cau|question|q)?\s*\d+\s*[:.)-]?\s*/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractLeadingQuestionNumber = (value: string = ''): number | null => {
  const match = String(value || '').match(/^\s*(?:câu|cau|question|q)?\s*(\d{1,4})\s*[:.)-]?/i);
  return match ? Number(match[1]) : null;
};

const getBlockQuestionText = (block: string): string => {
  const questionLine = String(block || '').split('\n').find(line => /^question\s*:/i.test(line.trim()));
  return (questionLine || block).replace(/^question\s*:\s*/i, '').trim();
};

const tokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(normalizeRecoveryText(left).split(' ').filter(token => token.length > 2));
  const rightTokens = new Set(normalizeRecoveryText(right).split(' ').filter(token => token.length > 2));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  leftTokens.forEach(token => {
    if (rightTokens.has(token)) shared++;
  });
  return shared / Math.min(leftTokens.size, rightTokens.size);
};

export const buildPartialSalvageRecoveryParts = (
  part: any,
  salvagedQuestions: Array<{ question?: string }>,
  chunkSize = 2
): any[] => {
  const blocks = getNativeMcqBlocks(part.text || '');
  if (blocks.length <= 1 || salvagedQuestions.length === 0) return [];

  const matchedBlockIndexes = new Set<number>();
  const blockQuestions = blocks.map(getBlockQuestionText);
  salvagedQuestions.forEach((question) => {
    const questionText = question?.question || '';
    const questionNumber = extractLeadingQuestionNumber(questionText);
    let bestIndex = -1;
    let bestScore = 0;

    blockQuestions.forEach((blockQuestion, index) => {
      if (matchedBlockIndexes.has(index)) return;
      const blockNumber = extractLeadingQuestionNumber(blockQuestion);
      const numberScore = questionNumber !== null && blockNumber !== null && questionNumber === blockNumber ? 1 : 0;
      const textScore = tokenOverlap(questionText, blockQuestion);
      const score = Math.max(numberScore, textScore);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    });

    if (bestIndex >= 0 && bestScore >= 0.55) matchedBlockIndexes.add(bestIndex);
  });

  const lowConfidence = matchedBlockIndexes.size < Math.max(1, Math.floor(salvagedQuestions.length * 0.6));
  const highCoveragePartial = salvagedQuestions.length >= Math.ceil(blocks.length * 0.5) && salvagedQuestions.length < blocks.length;
  const targetBlocks = lowConfidence
    ? (highCoveragePartial ? blocks.slice(salvagedQuestions.length) : blocks)
    : blocks.filter((_block, index) => !matchedBlockIndexes.has(index));

  const recoveryParts: any[] = [];
  for (let i = 0; i < targetBlocks.length; i += chunkSize) {
    const chunk = targetBlocks.slice(i, i + chunkSize);
    recoveryParts.push({
      ...part,
      text: buildNativeMcqBatchText(chunk),
      expectedQuestions: chunk.length,
      partialRecovery: false,
      recoveryAttemptedFromPartial: true,
    });
  }
  return recoveryParts;
};

export const splitStructuredPartByBatchSize = (part: any, batchSize: number): any[] => {
  const blocks = getNativeMcqBlocks(part.text || '');
  if (blocks.length <= batchSize) return [part];
  const parts: any[] = [];
  for (let i = 0; i < blocks.length; i += batchSize) {
    const chunk = blocks.slice(i, i + batchSize);
    parts.push({
      ...part,
      text: buildNativeMcqBatchText(chunk),
      expectedQuestions: chunk.length,
    });
  }
  return parts;
};

export const estimateTextTokens = (text: string): number => Math.ceil(String(text || '').length / 3.6);

export const estimateOutputTokensForQuestions = (count: number): number =>
  Math.ceil(Math.max(1, count) * 1100 * 1.15);

export const getAdaptiveQuestionBatchSize = (
  profile: ModelTokenProfile,
  adaptiveBatching = true,
  runtimeCap?: number
): number => {
  if (!adaptiveBatching) return 5;
  const budgetLimitedCount = Math.max(1, Math.floor(profile.safeOutputBudget / estimateOutputTokensForQuestions(1)));
  return Math.max(1, Math.min(runtimeCap || profile.maxQuestionsPerBatch, profile.maxQuestionsPerBatch, budgetLimitedCount));
};

export const getStructuredQuestionBatchSize = (
  profile: ModelTokenProfile,
  adaptiveBatching = true
): number =>
  Math.min(getAdaptiveQuestionBatchSize(profile, adaptiveBatching), STRUCTURED_QUESTION_BATCH_CAP);

export const getAdaptiveTextCharBudget = (profile: ModelTokenProfile, adaptiveBatching = true): number => {
  if (!adaptiveBatching) return 15000;
  const inputBudgetChars = Math.floor(profile.inputLimit * 0.08 * 3.6);
  return Math.max(15000, Math.min(22000, inputBudgetChars));
};

export const getAdaptiveVisionPagesPerChunk = (profile: ModelTokenProfile, adaptiveBatching = true): number =>
  adaptiveBatching ? Math.max(2, Math.min(4, profile.visionPagesPerBatch)) : 2;

export const hashFiles = async (files: UploadedFile[]): Promise<string> => {
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const combined = sortedFiles.map(file => `${file.name}:${file.contentHash || getFileTextContent(file)}`).join('|');
  return hashStringSha256(combined);
};
