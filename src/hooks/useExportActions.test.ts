import { describe, expect, it } from 'vitest';
import { generateCSVData, getExportBaseName, getExportSourceName } from './useExportActions';
import { MCQ } from '../types';

const sampleMcq: MCQ = {
  id: 'q1',
  question: 'Câu 1: Chọn đáp án đúng?',
  options: ['A. Đáp án A', 'B. Đáp án B', 'C. Đáp án C', 'D. Đáp án D'],
  correctAnswer: 'B',
  explanation: {
    core: 'Vì B đúng.',
    evidence: 'Tài liệu',
    analysis: 'Phân tích',
    warning: '',
  },
  source: 'demo.txt',
  difficulty: 'Easy',
  depthAnalysis: 'Nhận biết',
};

describe('export actions helpers', () => {
  it('keeps existing export filename behavior', () => {
    const files = [{ id: 'f1', name: 'Đề thi demo.txt', type: 'text/plain', content: 'x' }];
    expect(getExportBaseName(files, 'ANKI')).toBe('[ANKI]____thi_demo');
    expect(getExportBaseName(files, 'DOCX')).toBe('[DOCX]____thi_demo');
    expect(getExportSourceName(files)).toBe('Đề thi demo');
  });

  it('generates a CSV with cleaned labels, five options, answer letter, and HTML explanation', () => {
    const csv = generateCSVData([sampleMcq]);
    expect(csv).toContain('Question,A,B,C,D,E,CorrectAnswer,ExplanationHTML,Source');
    expect(csv).toContain('"Chọn đáp án đúng?"');
    expect(csv).toContain('"Đáp án B"');
    expect(csv).toContain('"B"');
    expect(csv).toContain('"demo.txt"');
  });
});
