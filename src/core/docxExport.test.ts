import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildStudyDocxBlob, getCorrectLetter, sanitizeDocxText, splitMarkdownBlocks } from './docxExport';
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

const getDocumentXml = async (blob: Blob): Promise<string> => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return await zip.file('word/document.xml')?.async('string') || '';
};

describe('DOCX study export', () => {
  it('creates a real docx blob for a complete MCQ', async () => {
    const blob = await buildStudyDocxBlob([makeMcq()], 'Unit Test');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const documentXml = await getDocumentXml(blob);

    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(blob.size).toBeGreaterThan(1000);
    expect(documentXml).toContain('Tài liệu ôn tập trắc nghiệm');
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

  it('exports malformed MCQs without crashing', async () => {
    const malformed = {
      id: 'bad',
      question: 'Câu 99. Dữ liệu thiếu nhiều field?',
      options: ['A. Một lựa chọn rất dài '.repeat(80), 'B. Ngắn'],
      correctAnswer: 'B',
    } as MCQ;

    const blob = await buildStudyDocxBlob([malformed], 'Malformed Unit Test');
    const documentXml = await getDocumentXml(blob);

    expect(blob.size).toBeGreaterThan(1000);
    expect(documentXml).toContain('Dữ liệu thiếu nhiều field');
    expect(documentXml).toContain('Đáp án đúng');
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

  it('splits markdown tables into structured blocks without separator rows', () => {
    const blocks = splitMarkdownBlocks('Intro\n| Cột 1 | Cột 2 |\n| --- | --- |\n| A | B |\nOutro');

    expect(blocks).toEqual([
      { type: 'text', lines: ['Intro'] },
      { type: 'table', rows: [['Cột 1', 'Cột 2'], ['A', 'B']] },
      { type: 'text', lines: ['Outro'] },
    ]);
  });

  it('renders markdown tables as Word tables instead of raw pipe text', async () => {
    const blob = await buildStudyDocxBlob([makeMcq()], 'Unit Test');
    const documentXml = await getDocumentXml(blob);

    expect(documentXml).toBeTruthy();
    expect(documentXml).toContain('<w:tbl>');
    expect(documentXml).toContain('<w:tblLayout w:type="fixed"/>');
    expect(documentXml).toContain('<w:tblW w:type="dxa" w:w="9360"/>');
    expect(documentXml).toContain('<w:gridCol w:w="4680"/>');
    expect(documentXml).not.toContain('| --- |');
    expect(documentXml).not.toContain('| Dấu hiệu | Ý nghĩa |');
  });

  it('falls back to text for over-wide markdown tables', async () => {
    const blob = await buildStudyDocxBlob([
      makeMcq({
        explanation: {
          core: 'Nội dung cốt lõi.',
          evidence: '| A | B | C | D | E | F | G |\n| --- | --- | --- | --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 |',
          analysis: '',
          warning: '',
        },
      }),
    ], 'Wide Table Test');
    const documentXml = await getDocumentXml(blob);

    expect(documentXml).toContain('A - B - C - D - E - F - G');
    expect(documentXml).not.toContain('| A | B | C | D | E | F | G |');
  });

  it('includes overview, inline answer box, and compact metadata', async () => {
    const blob = await buildStudyDocxBlob([
      makeMcq({ difficulty: 'Dễ' }),
      makeMcq({ id: '2', difficulty: 'Khó', correctAnswer: 'B' }),
      makeMcq({ id: '3', difficulty: 'Khó', correctAnswer: 'C' }),
    ], 'Overview Unit Test');
    const documentXml = await getDocumentXml(blob);

    expect(documentXml).toContain('Tổng quan');
    expect(documentXml).toContain('Phân bố');
    expect(documentXml).toContain('Dễ');
    expect(documentXml).toContain('Khó');
    expect(documentXml).toContain('Đáp án đúng');
    expect(documentXml).toContain('Nguồn: Test source | Độ khó:');
  });

  it('keeps dangerous and control-character text inert in generated XML', async () => {
    const blob = await buildStudyDocxBlob([
      makeMcq({
        question: 'Câu 1. <script>alert(1)</script>\u0001 có an toàn không?',
        options: ['A. <img src=x onerror=alert(2)>', 'B. javascript:alert(3)', 'C. Bình thường', 'D. Khác'],
        correctAnswer: 'B',
      }),
    ], 'Unsafe Text Test');
    const documentXml = await getDocumentXml(blob);

    expect(documentXml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(documentXml).toContain('onerror=alert(2)');
    expect(documentXml).not.toContain('\u0001');
  });
});
