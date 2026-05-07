import { describe, expect, it } from 'vitest';
import { parseDocxDocumentXml } from '../core/docxNative';
import { parseQuestionsFromModelText } from '../core/brain';
import { buildPdfTextAnalysisFromPages, scorePdfTextPage } from '../utils/pdfProcessor';
import { applySharedCaseContextToQuestion, extractSharedCaseContexts } from '../utils/sharedCaseContext';
import { findDuplicate } from '../utils/dedupe';
import { MCQ } from '../types';

const explanation = {
  core: 'Core',
  evidence: 'Evidence',
  analysis: 'Analysis',
  warning: 'Warning',
};

const makeQuestion = (question: string, answer = 'A'): MCQ => ({
  id: `q-${question}`,
  question,
  options: ['A. One', 'B. Two', 'C. Three', 'D. Four'],
  correctAnswer: answer,
  explanation,
  source: 'audit-fixture',
  difficulty: 'Medium',
  depthAnalysis: '> Key',
});

describe('question format audit baseline', () => {
  it('routes same-line option PDF text to Vision instead of trusting broken table text', () => {
    const page = scorePdfTextPage(`
Câu 1: Chọn đáp án đúng A. Một B. Hai C. Ba D. Bốn
Câu 2: Chọn đáp án đúng A. Một B. Hai C. Ba D. Bốn
`.repeat(8), 1);
    const analysis = buildPdfTextAnalysisFromPages([page], 3, 1, 10);

    expect(page.tableRisk).toBe(true);
    expect(analysis.textBatches).toHaveLength(0);
    expect(analysis.visionPageRanges).toEqual([{ start: 1, end: 1 }]);
  });

  it('keeps clean PDF text questions in structured text batches', () => {
    const text = Array.from({ length: 6 }, (_, index) => `
Câu ${index + 1}: Nội dung câu hỏi ${index + 1}?
A. Đáp án A
B. Đáp án B
C. Đáp án C
D. Đáp án D
Giải thích đủ dài để text layer được xem là ổn định.
`).join('\n');
    const analysis = buildPdfTextAnalysisFromPages([scorePdfTextPage(text, 1)], 3, 1, 10);

    expect(analysis.detectedMcqCount).toBe(6);
    expect(analysis.visionPageRanges).toHaveLength(0);
  });

  it('preserves DOCX highlighted answers and structured fallback blocks', () => {
    const p = (text: string, highlighted = false) => `
      <w:p><w:r>${highlighted ? '<w:rPr><w:highlight w:val="yellow"/></w:rPr>' : ''}<w:t>${text}</w:t></w:r></w:p>
    `;
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${p('Câu 1: Marker bằng highlight')}
          ${p('A. Một')}
          ${p('B. Hai', true)}
          ${p('C. Ba')}
          ${p('D. Bốn')}
          ${p('Câu 2: Không có đáp án tô màu')}
          ${p('A. Một')}
          ${p('B. Hai')}
          ${p('C. Ba')}
          ${p('D. Bốn')}
        </w:body>
      </w:document>
    `;

    const result = parseDocxDocumentXml(xml);

    expect(result.mcqs).toHaveLength(2);
    expect(result.mcqs[0].correctAnswer).toBe('B');
    expect(result.mcqs[1].correctAnswer).toBe('');
    expect(result.structuredBlockCount).toBe(2);
  });

  it('can expand shared case stems before model extraction output is finalized', () => {
    const source = `
Tình huống cho câu 11-13: Bệnh nhân nữ 28 tuổi đau bụng hạ vị, beta hCG 1300 IU/L.
Câu 11: Chẩn đoán?
`;
    const contexts = extractSharedCaseContexts(source);

    expect(applySharedCaseContextToQuestion('Câu 12: Xử trí tiếp theo?', contexts))
      .toContain('[TÌNH HUỐNG]');
    expect(applySharedCaseContextToQuestion('Câu 12: Xử trí tiếp theo?', contexts))
      .toContain('beta hCG 1300');
  });

  it('accepts model JSON for true-false, fill-blank, and matching-style audit cases when options are present', () => {
    const payload = {
      questions: [
        {
          question: 'Question 1: True or false: Troponin can rise in myocardial infarction.',
          options: ['A. True', 'B. False'],
          correctAnswer: 'A',
          explanation,
          source: 'quizlet_mixed_modes.md',
          difficulty: 'Easy',
          depthAnalysis: '> True/false item',
        },
        {
          question: 'Question 2: Fill in the blank: HbA1c reflects ____ glucose control.',
          options: ['A. long-term', 'B. immediate', 'C. renal', 'D. hepatic'],
          correctAnswer: 'A',
          explanation,
          source: 'quizlet_mixed_modes.md',
          difficulty: 'Medium',
          depthAnalysis: '> Fill blank item',
        },
        {
          question: 'Question 3: Match each sign with the correct system.',
          options: ['A. Wheeze-respiratory', 'B. Wheeze-urinary', 'C. Jaundice-neurologic', 'D. Hematuria-hepatic'],
          correctAnswer: 'A',
          explanation,
          source: 'slideshare_slide_style.md',
          difficulty: 'Medium',
          depthAnalysis: '> Matching item',
        },
      ],
    };

    const parsed = parseQuestionsFromModelText(JSON.stringify(payload), 0, 3);

    expect(parsed).toHaveLength(3);
    expect(parsed.map(q => q.options.length)).toEqual([2, 4, 4]);
  });

  it('marks negative duplicate intent as review/unique instead of unsafe auto-skip', () => {
    const positive = makeQuestion('Câu 1: Phát biểu nào sau đây đúng về hen phế quản?');
    const negative = makeQuestion('Câu 1: Phát biểu nào sau đây SAI về hen phế quản?');

    const result = findDuplicate(negative, [positive]);

    expect(result.isAutoSkip).toBe(false);
    expect(result.action === 'unique' || result.action === 'review').toBe(true);
  });
});

