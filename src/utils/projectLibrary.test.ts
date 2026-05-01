import { describe, expect, it, vi } from 'vitest';
import { AppSettings, MCQ, StudyProject, UploadedFile } from '../types';
import { buildProjectSnapshot, compareProjectToCurrent, sanitizeDownloadName } from './projectLibrary';

vi.mock('../core/brain', () => ({
  hashFiles: async (files: UploadedFile[]) => files.map(file => `${file.id}:${file.name}`).join('|'),
}));

const settings: AppSettings = {
  apiKey: 'secret',
  shopAIKeyKey: '',
  provider: 'google',
  model: 'gemini-3.1-flash-lite-preview',
  customPrompt: 'private prompt',
  skipAnalysis: true,
  concurrencyLimit: 2,
  adaptiveBatching: true,
  batchingMode: 'safe',
};

const makeMcq = (id: string, question: string, answer = 'A'): MCQ => ({
  id,
  question,
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: answer,
  explanation: {
    core: 'core',
    evidence: 'evidence',
    analysis: 'analysis',
    warning: '',
  },
  source: 'demo.pdf | Trang 1',
  difficulty: 'Medium',
  depthAnalysis: 'Standard',
});

const file: UploadedFile = {
  id: 'file-1',
  name: 'demo.pdf',
  type: 'application/pdf',
  content: 'base64',
};

const makeProject = (mcqs: MCQ[]): StudyProject => ({
  id: 'project-1',
  name: 'Demo',
  filesFingerprint: 'file-1:demo.pdf',
  createdAt: 1,
  updatedAt: 2,
  files: [file],
  mcqs,
  duplicates: [],
  analysis: null,
  settingsSummary: {
    provider: 'google',
    model: settings.model,
    hasCustomPrompt: true,
  },
  stats: {
    questionCount: mcqs.length,
    duplicateCount: 0,
    fileCount: 1,
    difficultyCounts: { Medium: mcqs.length },
  },
});

describe('project library helpers', () => {
  it('builds a project snapshot without storing provider secrets', async () => {
    const project = await buildProjectSnapshot({
      files: [file],
      mcqs: [makeMcq('q1', 'Câu 1. Nội dung?')],
      duplicates: [],
      analysis: { topic: 'Demo', estimatedCount: 1, questionRange: '1', confidence: 'High' },
      settings,
    });

    expect(project.filesFingerprint).toBe('file-1:demo.pdf');
    expect(project.settingsSummary).toEqual({
      provider: 'google',
      model: 'gemini-3.1-flash-lite-preview',
      skipAnalysis: true,
      concurrencyLimit: 2,
      adaptiveBatching: true,
      hasCustomPrompt: true,
    });
    expect(JSON.stringify(project)).not.toContain('secret');
    expect(project.stats.questionCount).toBe(1);
  });

  it('compares current questions against a saved project', () => {
    const project = makeProject([
      makeMcq('old-1', 'Câu 1. Giữ nguyên?', 'A'),
      makeMcq('old-2', 'Câu 2. Sẽ bị xóa?', 'B'),
      makeMcq('old-3', 'Câu 3. Đổi đáp án?', 'A'),
    ]);

    const comparison = compareProjectToCurrent(project, [
      makeMcq('new-1', 'Câu 1. Giữ nguyên?', 'A'),
      makeMcq('new-3', 'Câu 3. Đổi đáp án?', 'B'),
      makeMcq('new-4', 'Câu 4. Câu mới?', 'C'),
    ]);

    expect(comparison.added.map(item => item.id)).toEqual(['new-4']);
    expect(comparison.removed.map(item => item.id)).toEqual(['old-2']);
    expect(comparison.changedAnswers).toEqual([{
      id: 'new-3',
      question: 'Câu 3. Đổi đáp án?',
      previousAnswer: 'A',
      currentAnswer: 'B',
    }]);
  });

  it('sanitizes project names for downloads', () => {
    expect(sanitizeDownloadName('Đề thi / demo 01')).toBe('thi_demo_01');
  });
});
