import { describe, expect, it } from 'vitest';
import { MCQ, UploadedFile } from '../../types';
import { hashFiles, inferCompletedBatchIndicesFromExistingQuestions } from './batching';

const file = (overrides: Partial<UploadedFile>): UploadedFile => ({
  id: overrides.id || 'file-1',
  name: overrides.name || 'demo.txt',
  type: overrides.type || 'text/plain',
  content: overrides.content || 'content',
  contentHash: overrides.contentHash,
});

const questionFromSource = (source: string): MCQ => ({
  id: `q-${source}`,
  question: 'Câu hỏi mock?',
  options: ['A. Một', 'B. Hai'],
  correctAnswer: 'A',
  explanation: {
    core: '',
    evidence: '',
    analysis: '',
    warning: '',
  },
  source,
  difficulty: 'Easy',
  depthAnalysis: '',
});

describe('brain batching helpers', () => {
  it('hashFiles uses precomputed contentHash when available', async () => {
    const withLargeContent = await hashFiles([file({ content: 'first-content', contentHash: 'same-hash' })]);
    const withDifferentContent = await hashFiles([file({ content: 'second-content', contentHash: 'same-hash' })]);

    expect(withLargeContent).toBe(withDifferentContent);
  });

  it('hashFiles falls back to file content for legacy persisted files', async () => {
    const first = await hashFiles([file({ content: 'first-content' })]);
    const second = await hashFiles([file({ content: 'second-content' })]);

    expect(first).not.toBe(second);
  });

  it('does not infer completion from advisory PDF Vision expected counts', () => {
    const sourceLabel = 'scan.pdf | Trang 1-2';
    const inferred = inferCompletedBatchIndicesFromExistingQuestions([
      {
        expectedQuestions: 1,
        expectedQuestionsReliable: false,
        sourceLabel,
      },
    ], [questionFromSource(sourceLabel)]);

    expect(inferred).toEqual([]);
  });

  it('still infers completion when expected counts are marked reliable', () => {
    const sourceLabel = 'deck.docx | Nhóm 1';
    const inferred = inferCompletedBatchIndicesFromExistingQuestions([
      {
        expectedQuestions: 1,
        expectedQuestionsReliable: true,
        sourceLabel,
      },
    ], [questionFromSource(sourceLabel)]);

    expect(inferred).toEqual([1]);
  });
});
