import { UploadedFile, MCQ } from '../../types';
import { PdfPageRange } from '../../utils/pdfProcessor';
import { ModelTokenProfile } from '../../utils/models';
import { buildNativeMcqBatchText, getNativeMcqBlocks } from '../docxNative';

export const getFileTextContent = (file: UploadedFile): string =>
  file.nativeText?.trim() || file.structuredText?.trim() || file.plainText?.trim() || file.content || '';

export const joinSourceLabel = (...parts: string[]): string => parts.map(part => part.trim()).filter(Boolean).join(' | ');

export const formatPageRangeLabel = (range: PdfPageRange): string =>
  range.start === range.end ? `Trang ${range.start}` : `Trang ${range.start}-${range.end}`;

export const getTrustedSourceLabel = (part: { sourceLabel?: string } = {}): string => {
  const sourceLabel = typeof part.sourceLabel === 'string' ? part.sourceLabel.trim() : '';
  return sourceLabel || 'Nguồn không xác định';
};

const normalizeSourceLabel = (value: string = ''): string =>
  value.replace(/\s+/g, ' ').trim().toLowerCase();

export const getNativeBatchExpectedCount = (text: string): number => {
  const match = String(text || '').match(/^\[(?:DOCX_NATIVE|PDF_TEXT)_(?:BATCH|MCQ)_COUNT:\s*(\d+)\]/i);
  return match ? Number(match[1]) || 0 : 0;
};

export const inferCompletedBatchIndicesFromExistingQuestions = (
  parts: Array<{ text?: string; expectedQuestions?: number; sourceLabel?: string }>,
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
    const expected = part.expectedQuestions || getNativeBatchExpectedCount(part.text || '');
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
  if (!adaptiveBatching) return 10;
  const budgetLimitedCount = Math.max(1, Math.floor(profile.safeOutputBudget / estimateOutputTokensForQuestions(1)));
  return Math.max(1, Math.min(runtimeCap || profile.maxQuestionsPerBatch, profile.maxQuestionsPerBatch, budgetLimitedCount));
};

export const getAdaptiveTextCharBudget = (profile: ModelTokenProfile, adaptiveBatching = true): number => {
  if (!adaptiveBatching) return 15000;
  const inputBudgetChars = Math.floor(profile.inputLimit * 0.08 * 3.6);
  return Math.max(15000, Math.min(60000, inputBudgetChars));
};

export const getAdaptiveVisionPagesPerChunk = (profile: ModelTokenProfile, adaptiveBatching = true): number =>
  adaptiveBatching ? Math.max(3, Math.min(5, profile.visionPagesPerBatch)) : 3;

export const hashFiles = async (files: UploadedFile[]): Promise<string> => {
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const combined = sortedFiles.map(file => `${file.name}:${getFileTextContent(file)}`).join('|');
  const msgUint8 = new TextEncoder().encode(combined);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
};
