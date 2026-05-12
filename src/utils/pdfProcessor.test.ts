import { describe, expect, it } from 'vitest';
import {
  buildPdfTextAnalysisFromPages,
  detectPdfMultiColumnRisk,
  getPdfRasterConfig,
  scorePdfTextPage,
  splitPdfRangeForVisionRecovery,
} from './pdfProcessor';

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
  it('uses a balanced raster quality ladder for normal and rescue PDF vision', () => {
    expect(getPdfRasterConfig('standard')).toEqual({ scale: 2.0, jpegQuality: 0.85 });
    expect(getPdfRasterConfig('high')).toEqual({ scale: 2.8, jpegQuality: 0.92 });
  });

  it('splits PDF vision rescue into overlapping page pairs', () => {
    expect(splitPdfRangeForVisionRecovery({ start: 5, end: 5 })).toEqual([{ start: 5, end: 5 }]);
    expect(splitPdfRangeForVisionRecovery({ start: 5, end: 6 })).toEqual([{ start: 5, end: 6 }]);
    expect(splitPdfRangeForVisionRecovery({ start: 5, end: 8 })).toEqual([
      { start: 5, end: 6 },
      { start: 6, end: 7 },
      { start: 7, end: 8 },
    ]);
  });

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

  it('routes table-risk PDF pages to vision so rescue can split them if coverage is low', () => {
    const page = scorePdfTextPage(`
Câu 1: Chọn đáp án đúng A. Một B. Hai C. Ba D. Bốn
Câu 2: Chọn đáp án đúng A. Một B. Hai C. Ba D. Bốn
Câu 3: Chọn đáp án đúng A. Một B. Hai C. Ba D. Bốn
`.repeat(8), 2);
    const analysis = buildPdfTextAnalysisFromPages([
      page,
      scorePdfTextPage(page.text, 2),
      scorePdfTextPage(page.text, 3),
      scorePdfTextPage(page.text, 4),
    ], 3, 1, 10);

    expect(page.tableRisk).toBe(true);
    expect(analysis.visionPageRanges).toEqual([{ start: 1, end: 3 }, { start: 3, end: 4 }]);
    expect(splitPdfRangeForVisionRecovery(analysis.visionPageRanges[0])).toEqual([
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ]);
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
${'Nội dung bổ sung đủ dài.\n'.repeat(20)}
`, 1);
    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1);

    expect(page.quality).toBe('goodText');
    expect(analysis.textBatches).toHaveLength(0);
    expect(analysis.visionPageRanges).toEqual([{ start: 1, end: 1 }]);
  });

  it('does not swallow bare-numbered PDF questions after a complete A-D block', () => {
    const page = scorePdfTextPage(`
Câu 1: Cấu trúc nào tạo nên đáy tim?
A. Tâm thất trái và phần sau tâm thất phải
B. Tâm nhĩ phải và phần sau tâm nhĩ trái
C. Tâm nhĩ trái và phần sau tâm nhĩ phải
D. Tâm thất phải và phần sau tâm thất trái
2. Tĩnh mạch tim lớn đi trong rãnh nào?
A. Rãnh vành
B. Rãnh gian nhĩ
C. Rãnh tận cùng
D. Rãnh gian thất trước
Câu 3: Động mạch cấp máu cho lá tạng ngoại tâm mạc?
A. Động mạch vành
B. Động mạch màng ngoài tim
C. Động mạch gian thất trước
D. Động mạch mũ
${'Nội dung bổ sung đủ dài để text layer được chấm goodText.\n'.repeat(8)}
`, 1);

    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1, 10);
    const combinedText = analysis.textBatches.map((batch) => batch.text).join('\n');

    expect(analysis.detectedMcqCount).toBe(3);
    expect(combinedText).toContain('Question: Câu 1: Cấu trúc nào tạo nên đáy tim?');
    expect(combinedText).toContain('Question: 2. Tĩnh mạch tim lớn đi trong rãnh nào?');
    expect(combinedText).toContain('Question: Câu 3: Động mạch cấp máu cho lá tạng ngoại tâm mạc?');
  });

  it('keeps unnumbered PDF questions when the next line restarts at option A', () => {
    const page = scorePdfTextPage(`
Câu 1: Cấu trúc nào tạo nên đáy tim?
A. Tâm thất trái và phần sau tâm thất phải
B. Tâm nhĩ phải và phần sau tâm nhĩ trái
C. Tâm nhĩ trái và phần sau tâm nhĩ phải
D. Tâm thất phải và phần sau tâm thất trái
Tĩnh mạch tim lớn đi trong rãnh nào?
A. Rãnh vành
B. Rãnh gian nhĩ
C. Rãnh tận cùng
D. Rãnh gian thất trước
Động mạch cấp máu cho lá tạng ngoại tâm mạc?
A. Động mạch vành
B. Động mạch màng ngoài tim
C. Động mạch gian thất trước
D. Động mạch mũ
${'Nội dung bổ sung đủ dài để text layer được chấm goodText.\n'.repeat(8)}
`, 1);

    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1, 10);
    const combinedText = analysis.textBatches.map((batch) => batch.text).join('\n');

    expect(analysis.detectedMcqCount).toBe(3);
    expect(combinedText).toContain('Question: Tĩnh mạch tim lớn đi trong rãnh nào?');
    expect(combinedText).toContain('Question: Động mạch cấp máu cho lá tạng ngoại tâm mạc?');
  });

  it('preserves PDF text answer-key lines as correct option markers', () => {
    const page = scorePdfTextPage(`
Câu 1: Cấu trúc nào tạo nên đáy tim?
A. Tâm thất trái và phần sau tâm thất phải
B. Tâm nhĩ phải và phần sau tâm nhĩ trái
C. Tâm nhĩ trái và phần sau tâm nhĩ phải
D. Tâm thất phải và phần sau tâm thất trái
Đáp án: C
Câu 2: Tĩnh mạch tim lớn đi trong rãnh nào?
A. Rãnh vành
B. Rãnh gian nhĩ
C. Rãnh tận cùng
D. Rãnh gian thất trước
Answer - D. Rãnh gian thất trước
${'Nội dung bổ sung đủ dài để text layer được chấm goodText.\n'.repeat(8)}
`, 1);

    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1, 10);
    const combinedText = analysis.textBatches.map((batch) => batch.text).join('\n');

    expect(analysis.detectedMcqCount).toBe(2);
    expect(combinedText).toContain('✅ C. Tâm nhĩ trái và phần sau tâm nhĩ phải');
    expect(combinedText).toContain('✅ D. Rãnh gian thất trước');
    expect(combinedText).not.toContain('Tâm thất phải và phần sau tâm thất trái Đáp án');
  });

  it('does not silently undercount when question 10 starts inline after question 9', () => {
    const firstNine = Array.from({ length: 9 }, (_, index) => {
      const questionNumber = index + 1;
      const optionD = questionNumber === 9
        ? 'D. Lựa chọn D của câu 9 Câu 10: Câu hỏi thứ mười bắt đầu cùng dòng sau đáp án D'
        : `D. Lựa chọn D của câu ${questionNumber}`;
      return `
Câu ${questionNumber}: Nội dung riêng của câu ${questionNumber}?
A. Lựa chọn A của câu ${questionNumber}
B. Lựa chọn B của câu ${questionNumber}
C. Lựa chọn C của câu ${questionNumber}
${optionD}
Giải thích đủ dài để text layer ổn định cho câu ${questionNumber}.
`;
    }).join('\n');
    const page = scorePdfTextPage(`
${firstNine}
A. Lựa chọn A của câu 10
B. Lựa chọn B của câu 10
C. Lựa chọn C của câu 10
D. Lựa chọn D của câu 10
Giải thích đủ dài để text layer ổn định cho câu 10.
`, 1);

    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1, 10);
    const combinedText = analysis.textBatches.map((batch) => batch.text).join('\n');

    expect(analysis.detectedMcqCount).toBe(10);
    for (let questionNumber = 1; questionNumber <= 10; questionNumber++) {
      expect(combinedText).toContain(`Question: Câu ${questionNumber}:`);
    }
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

  it('keeps overlap when merged vision ranges cross clinical page boundaries', () => {
    const pages = Array.from({ length: 5 }, (_, index) => scorePdfTextPage(`
Tình huống lâm sàng cho câu 41-42 nằm sát mép trang ${index + 1}.
Bệnh nhân đau ngực, huyết áp tụt, cần đọc tiếp trang kế tiếp.
`, index + 1));

    const analysis = buildPdfTextAnalysisFromPages(pages, 3, 1);

    expect(analysis.textBatches).toHaveLength(0);
    expect(analysis.visionPageRanges).toEqual([
      { start: 1, end: 3 },
      { start: 3, end: 5 },
    ]);
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

    expect(combinedText).toContain('Question: [TÌNH HUỐNG]');
    expect(combinedText).toContain('Tình huống lâm sàng sau dùng cho câu 93-98');
    expect(combinedText).toContain('Bệnh nhân nữ 30 tuổi, nhập viện vì khó thở');
    expect(combinedText).toContain('Câu 95. Đặc điểm suy tim của bệnh nhân này là?');
  });

  it('detects plain Vietnamese shared case headers with repeated question numbers', () => {
    const sharedCase = 'Tình huống cho câu 11-12-13-14: Bệnh nhân nữ có siêu âm tử cung trống beta 1300. Siêu âm có 1 khối echo hỗn hợp cạnh buồng trứng.';
    const page = scorePdfTextPage(`
${sharedCase}
Câu 11: Chẩn đoán:
A. Thai chưa xác định vị trí.
B. Thai ngoài tử cung.
C. Xảy thai trọn.
D. Thai nghén thất bại sớm.
Câu 12: Xử trí tiếp theo là gì?
A. 1 bộ đôi Beta + siêu âm 48H.
B. 1 loạt bộ đôi mỗi 48h.
C. Điều trị thai ngoài tử cung.
D. Không có chỉ định điều trị nội khoa.
Câu 13: Lâm sàng hướng đến sảy thai trọn. cần làm gì thêm.
A. Không làm gì thêm.
B. Theo dõi beta.
C. Siêu âm kiểm tra.
D. Điều trị nội khoa.
`, 1);

    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1, 10);
    const combinedText = analysis.textBatches.map((batch) => batch.text).join('\n');

    expect(combinedText).toContain('Question: [TÌNH HUỐNG]');
    expect(combinedText).toContain('Tình huống cho câu 11-12-13-14');
    expect(combinedText).toContain('Bệnh nhân nữ có siêu âm tử cung trống beta 1300');
    expect(combinedText).toContain('Câu 13: Lâm sàng hướng đến sảy thai trọn');
  });
});
