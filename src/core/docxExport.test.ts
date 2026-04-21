import { describe, expect, it } from 'vitest';
import { buildStudyDocxBlob, getCorrectLetter, sanitizeDocxText } from './docxExport';
import { MCQ } from '../types';

const makeMcq = (overrides: Partial<MCQ> = {}): MCQ => ({
  id: '1',
  question: 'Câu 1. Triệu chứng nào phù hợp nhất?',
  options: ['A. Sốt', 'B. Ho', 'C. Đau bụng', 'D. Khó thở', 'E. Đau đầu'],
  correctAnswer: 'A',
  explanation: {
    core: '**Sốt** là biểu hiện chính.',
    evidence: '| Dấu hiệu | Ý nghĩa |\n| --- | --- |\n| Sốt | Nhiễm trùng |',
    analysis: 'Loại trừ các đáp án còn lại.',
    warning: 'Theo dõi dấu hiệu nặng.',
  },
  source: 'Test source',
  difficulty: 'Medium',
  depthAnalysis: 'Vận dụng',
  ...overrides,
});

describe('DOCX study export', () => {
  it('creates a real docx blob for a complete MCQ', async () => {
    const blob = await buildStudyDocxBlob([makeMcq()], 'Unit Test');
    const bytes = new Uint8Array(await blob.arrayBuffer());

    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('exports when option E is missing', async () => {
    const blob = await buildStudyDocxBlob([
      makeMcq({ options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'], correctAnswer: 'D' }),
    ]);

    expect(blob.size).toBeGreaterThan(1000);
  });

  it('does not crash when explanation fields are empty', async () => {
    const blob = await buildStudyDocxBlob([
      makeMcq({ explanation: { core: '', evidence: '', analysis: '', warning: '' }, source: '', difficulty: '', depthAnalysis: '' }),
    ]);

    expect(blob.size).toBeGreaterThan(1000);
  });

  it('keeps dangerous HTML as inert text data', () => {
    const text = sanitizeDocxText('<script>alert(1)</script><img src=x onerror=alert(2)> javascript:alert(3)');

    expect(text).toContain('<script>');
    expect(text).toContain('onerror');
    expect(text).toContain('javascript:');
  });

  it('detects correct answer from option content or letter', () => {
    expect(getCorrectLetter(makeMcq({ correctAnswer: 'Sốt' }))).toBe('A');
    expect(getCorrectLetter(makeMcq({ correctAnswer: 'C' }))).toBe('C');
  });
});
