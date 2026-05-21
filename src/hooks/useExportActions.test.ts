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

  it('safely escapes special characters, quotes, and newlines in CSV export to prevent row fracturing', () => {
    const dirtyMcq: MCQ = {
      id: 'q2',
      question: 'Câu 2: Đây là câu hỏi "có dấu nháy kép" và\ncó xuống dòng, kèm dấu phẩy, ở đây.',
      options: [
        'A. Lựa chọn "A" có nháy',
        'B. Lựa chọn B\ncó xuống dòng',
        'C. Lựa chọn C',
        'D. Lựa chọn D'
      ],
      correctAnswer: 'A',
      explanation: {
        core: 'Giải thích có "nháy kép" và\nxuống dòng nhiều lần.',
        evidence: 'Bằng chứng',
        analysis: 'Phân tích',
        warning: ''
      },
      source: 'test,file.txt',
      difficulty: 'Easy',
      depthAnalysis: 'Nhận biết'
    };

    const csv = generateCSVData([dirtyMcq]);
    // The CSV will contain the header row and the data row. 
    // Since all internal newlines are replaced with spaces in generateCSVData/formatRichText,
    // the output split by \n should have exactly 2 main rows (+ maybe 1 trailing empty element).
    const lines = csv.split('\n').filter(Boolean);
    expect(lines.length).toBe(2);

    // Verify correct double-quote escaping in headers and content
    expect(csv).toContain('&quot;có dấu nháy kép&quot;');
    expect(csv).toContain('"Đây là câu hỏi &quot;có dấu nháy kép&quot; và<br>có xuống dòng, kèm dấu phẩy, ở đây."');
    expect(csv).toContain('&quot;A&quot;');
    expect(csv).toContain('"Lựa chọn &quot;A&quot; có nháy"');
    expect(csv).toContain('"test,file.txt"');
  });
});
