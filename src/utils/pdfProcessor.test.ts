import { describe, expect, it } from 'vitest';
import { buildPdfTextAnalysisFromPages, detectPdfMultiColumnRisk, scorePdfTextPage } from './pdfProcessor';

const cleanMcqPage = (questionCount = 3) => Array.from({ length: questionCount }, (_, index) => `
Câu ${index + 1}: Chọn đáp án đúng trong các đáp án sau
A. Lựa chọn một có nội dung đủ dài
B. Lựa chọn hai có nội dung đủ dài
C. Lựa chọn ba có nội dung đủ dài
D. Lựa chọn bốn có nội dung đủ dài
Giải thích ngắn để text layer đủ dài và giữ nhiều dòng rõ ràng.
`).join('\n');

describe('PDF safe hybrid text analysis', () => {
  it('scores clean MCQ text pages as goodText', () => {
    const page = scorePdfTextPage(cleanMcqPage(4), 1);

    expect(page.quality).toBe('goodText');
    expect(page.mcqMarkerCount).toBeGreaterThan(0);
    expect(page.optionMarkerCount).toBeGreaterThanOrEqual(3);
  });

  it('scores empty or scan-like pages as scanOrEmpty', () => {
    const page = scorePdfTextPage('', 1);

    expect(page.quality).toBe('scanOrEmpty');
  });

  it('scores weird text layers as suspect', () => {
    const page = scorePdfTextPage(`${cleanMcqPage(2)}\n${'�'.repeat(200)}`, 1);

    expect(page.quality).toBe('suspect');
    expect(page.weirdCharRatio).toBeGreaterThan(0.08);
  });

  it('scores text pages without MCQ options as suspect', () => {
    const page = scorePdfTextPage('Đây là một trang văn bản dài nhưng không có lựa chọn trắc nghiệm.\n'.repeat(20), 1);

    expect(page.quality).toBe('suspect');
  });

  it('scores table-like same-line options as suspect', () => {
    const page = scorePdfTextPage(`
Câu 1: Chọn đáp án đúng
A. Một    B. Hai    C. Ba    D. Bốn
Câu 2: Chọn đáp án đúng
A. Một    B. Hai    C. Ba    D. Bốn
`.repeat(8), 1);

    expect(page.quality).toBe('suspect');
    expect(page.tableRisk).toBe(true);
  });

  it('detects multi-column geometry risk', () => {
    const items = Array.from({ length: 7 }, (_, index) => [
      { x: 40, y: 760 - index * 20, width: 180, text: `Câu ${index + 1}: bên trái` },
      { x: 340, y: 760 - index * 20, width: 180, text: `Câu ${index + 10}: bên phải` },
      { x: 520, y: 760 - index * 20, width: 40, text: 'D.' },
    ]).flat();

    expect(detectPdfMultiColumnRisk(items, 600)).toBe(true);
  });

  it('rejects batches with too much text but too few complete MCQ blocks', () => {
    const longSparseText = `${cleanMcqPage(1)}\n${'Một đoạn giải thích rất dài không phải câu hỏi.\n'.repeat(80)}`;
    const page = scorePdfTextPage(longSparseText, 1);
    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1);

    expect(page.quality).toBe('goodText');
    expect(analysis.textBatches).toHaveLength(0);
    expect(analysis.visionPageRanges).toEqual([{ start: 1, end: 1 }]);
  });

  it('rejects incomplete option sequences', () => {
    const page = scorePdfTextPage(`
Câu 1: Chọn đáp án đúng
A. Một
B. Hai
D. Bốn
E. Năm
${'Nội dung bổ sung đủ dài.\n'.repeat(20)}
`, 1);
    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1);

    expect(page.quality).toBe('goodText');
    expect(analysis.textBatches).toHaveLength(0);
    expect(analysis.visionPageRanges).toEqual([{ start: 1, end: 1 }]);
  });

  it('uses text batches for clean pages and no vision ranges', () => {
    const pages = Array.from({ length: 6 }, (_, index) => scorePdfTextPage(cleanMcqPage(3), index + 1));
    const analysis = buildPdfTextAnalysisFromPages(pages, 3, 1);

    expect(analysis.mode).toBe('textOnlyCandidate');
    expect(analysis.textBatches.length).toBeGreaterThan(1);
    expect(analysis.visionPageRanges).toHaveLength(0);
    expect(analysis.detectedMcqCount).toBeGreaterThan(0);
  });

  it('sends mixed batches with scan pages to vision', () => {
    const pages = [
      scorePdfTextPage(cleanMcqPage(3), 1),
      scorePdfTextPage('', 2),
      scorePdfTextPage(cleanMcqPage(3), 3),
    ];
    const analysis = buildPdfTextAnalysisFromPages(pages, 3, 1);

    expect(analysis.mode).toBe('vision');
    expect(analysis.textBatches).toHaveLength(0);
    expect(analysis.visionPageRanges).toEqual([{ start: 1, end: 3 }]);
  });

  it('splits many MCQ blocks under 15000 chars by structured batches instead of raw text size', () => {
    const page = scorePdfTextPage(cleanMcqPage(40), 1);
    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1);

    expect(analysis.textBatches).toHaveLength(4);
    expect(analysis.textBatches.every((batch) => batch.expectedQuestions === 10)).toBe(true);
    expect(analysis.textBatches[0].text.length).toBeLessThan(15000);
  });
});
