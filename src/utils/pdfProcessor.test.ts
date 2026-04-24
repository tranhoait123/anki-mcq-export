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

const numberedMcqPage = (start = 1, questionCount = 2) => Array.from({ length: questionCount }, (_, index) => `
Câu ${start + index}: Nội dung riêng của câu ${start + index}
A. Lựa chọn A của câu ${start + index}
B. Lựa chọn B của câu ${start + index}
C. Lựa chọn C của câu ${start + index}
D. Lựa chọn D của câu ${start + index}
Giải thích ngắn cho câu ${start + index}, có thêm dữ kiện mô tả đủ dài để text layer ổn định và parser giữ đúng cấu trúc.
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
    const pages = Array.from({ length: 6 }, (_, index) => scorePdfTextPage(numberedMcqPage(index * 3 + 1, 3), index + 1));
    const analysis = buildPdfTextAnalysisFromPages(pages, 3, 1);

    expect(analysis.mode).toBe('textOnlyCandidate');
    expect(analysis.textBatches.length).toBeGreaterThan(1);
    expect(analysis.visionPageRanges).toHaveLength(0);
    expect(analysis.detectedMcqCount).toBeGreaterThan(0);
  });

  it('deduplicates structured text blocks repeated by overlapping page ranges', () => {
    const pages = [
      scorePdfTextPage(numberedMcqPage(1, 3), 1),
      scorePdfTextPage(numberedMcqPage(4, 3), 2),
      scorePdfTextPage(numberedMcqPage(7, 3), 3),
      scorePdfTextPage(numberedMcqPage(10, 3), 4),
      scorePdfTextPage(numberedMcqPage(13, 3), 5),
    ];

    const analysis = buildPdfTextAnalysisFromPages(pages, 3, 1, 10);
    const combinedText = analysis.textBatches.map((batch) => batch.text).join('\n');

    expect(analysis.detectedMcqCount).toBe(15);
    expect(combinedText.match(/Câu 7:/g)?.length || 0).toBe(1);
    expect(combinedText.match(/Câu 9:/g)?.length || 0).toBe(1);
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

  it('supports adaptive structured batch sizes for high-output models', () => {
    const page = scorePdfTextPage(cleanMcqPage(70), 1);
    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1, 35);

    expect(analysis.textBatches).toHaveLength(2);
    expect(analysis.textBatches.every((batch) => batch.expectedQuestions === 35)).toBe(true);
  });

  it('carries shared clinical vignette to later questions in the declared range', () => {
    const sharedCase = 'Tình huống lâm sàng sau dùng cho câu 93-98 Bệnh nhân nữ 30 tuổi, nhập viện vì khó thở. Tĩnh mạch cổ nổi, phù chân, P2 mạnh.';
    const page = scorePdfTextPage(`
${sharedCase} Câu 93. Chẩn đoán bệnh van tim được nghĩ đến nhiều nhất là?
A. Hẹp van hai lá
B. Hở van động mạch chủ
C. Hẹp van động mạch chủ
D. Hở van hai lá
${sharedCase} Câu 94. Nguyên nhân hở van 3 lá được nghĩ đến là?
A. Cơ năng do tăng áp phổi
B. Viêm nội tâm mạc
C. Chấn thương
D. Bẩm sinh
Câu 95. Đặc điểm suy tim của bệnh nhân này là?
A. Suy tim phải
B. Suy tim trái
C. Suy tim toàn bộ
D. Không suy tim
`, 1);

    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1, 10);
    const combinedText = analysis.textBatches.map((batch) => batch.text).join('\n');

    expect(combinedText).toContain('Question: Tình huống lâm sàng sau dùng cho câu 93-98');
    expect(combinedText).toContain('Bệnh nhân nữ 30 tuổi, nhập viện vì khó thở');
    expect(combinedText).toContain('Câu 95. Đặc điểm suy tim của bệnh nhân này là?');
  });
});
