import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCQ } from '../../types';
import {
  compactQuestionForDedupe,
  createBatchPostprocessState,
  processBatchPostprocess,
} from './batchPostprocess';

const makeQuestion = (id: number): MCQ => ({
  id: `seed-${id}`,
  question: `Câu ${id}: Bệnh nhân số ${id} cần chọn đáp án nào?`,
  options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
  correctAnswer: 'A',
  explanation: {
    core: 'A đúng.',
    evidence: 'Bằng chứng mock.',
    analysis: 'Phân tích mock.',
    warning: '',
  },
  source: 'seed',
  difficulty: 'Easy',
  depthAnalysis: 'Nhận biết',
});

const countSharedCaseMarkers = (value: string): number =>
  (value.match(/\[\s*(?:TÌNH HUỐNG|CÂU HỎI)\s*\]/gi) || []).length;

describe('processBatchPostprocess', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps seed dedupe state compact while preserving match-critical fields', () => {
    const compact = compactQuestionForDedupe({
      ...makeQuestion(1),
      explanation: {
        core: 'x'.repeat(5000),
        evidence: 'heavy evidence',
        analysis: 'heavy analysis',
        warning: 'heavy warning',
      },
      trace: {
        fileId: 'file-1',
        fileName: 'deck.pdf',
        sourceLabel: 'deck.pdf | Trang 1',
        mode: 'pdfText',
      },
    });

    expect(compact).toMatchObject({
      id: 'seed-1',
      question: 'Câu 1: Bệnh nhân số 1 cần chọn đáp án nào?',
      options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
      correctAnswer: 'A',
      source: 'seed',
    });
    expect(compact.explanation).toEqual({
      core: '',
      evidence: '',
      analysis: '',
      warning: '',
    });
    expect(compact.trace?.sourceLabel).toBe('deck.pdf | Trang 1');
  });

  it('parses, dedupes, and tracks coverage off the generation hot path', async () => {
    const seed = makeQuestion(1);
    const fresh: MCQ = {
      ...makeQuestion(2),
      question: 'Câu 2: Cơ chế tác dụng chính của thuốc lợi tiểu quai là gì?',
      options: ['A. Ức chế NKCC2', 'B. Ức chế ACE', 'C. Chẹn beta', 'D. Tăng ADH'],
      correctAnswer: 'A',
    };
    const state = createBatchPostprocessState([seed]);
    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 2,
      fullText: JSON.stringify({ questions: [seed, fresh] }),
      partMeta: {
        sourceLabel: 'Nhi_10.pdf | Trang 1',
        text: '',
      },
      topLevelBatchNumber: 1,
    }, state);

    expect(result.rawQuestions).toHaveLength(2);
    expect(result.newQuestions).toHaveLength(1);
    expect(result.newQuestions[0].question).toBe(fresh.question.replace(/^Câu\s*\d+[:.]\s*/i, ''));
    expect(result.autoSkippedCount).toBe(1);
    expect(result.coverageKeys.length).toBeGreaterThanOrEqual(1);
  });

  it('does not count seeded questions from the same source as recovered duplicates', async () => {
    const seed = {
      ...makeQuestion(1),
      source: 'deck.docx | Nhóm 1',
    };
    const state = createBatchPostprocessState([seed]);

    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 1,
      fullText: JSON.stringify({ questions: [seed] }),
      partMeta: {
        sourceLabel: 'deck.docx | Nhóm 1',
        text: '',
      },
      topLevelBatchNumber: 1,
    }, state);

    expect(result.newQuestions).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
    expect(result.autoSkippedCount).toBe(0);
    expect(result.coverageKeys).toHaveLength(0);
  });

  it('replaces a bad seeded same-source question only during targeted retry', async () => {
    const sourceLabel = 'merged.pdf | Trang 4-5';
    const cleanStem = 'Bệnh nhân nam, 68 tuổi, 2 tuần nay tự ngừng điều trị suy tim, tăng huyết áp. Cách nhập viện 4 giờ, bệnh nhân đang ngủ thì đột ngột khó thở phải nằm đầu cao nên nhập viện.';
    const questionPayload = '25. Một cận lâm sàng nào cần làm ngay để chẩn đoán bệnh cảnh trên?';
    const options = ['A. Điện tâm đồ', 'B. X-Quang ngực', 'C. Siêu âm tim', 'D. Men tim'];
    const badSeed: MCQ = {
      ...makeQuestion(3),
      id: 'seed-batch-3',
      question: [
        '[TÌNH HUỐNG]',
        'Tinh huong sau sir dung cho cau 25-26 Benh nhan nam, 68 tuoi, 2 tuan nay ty ngung dieu tri Suy tim, Ying huyet ap.',
        '',
        '[CÂU HỎI]',
        '[TÌNH HUỐNG]',
        cleanStem,
        '',
        '[CÂU HỎI]',
        questionPayload,
      ].join('\n'),
      options,
      correctAnswer: 'A',
      source: sourceLabel,
    };
    const repairedQuestion = {
      ...makeQuestion(3),
      question: [
        '[TÌNH HUỐNG]',
        cleanStem,
        '',
        '[CÂU HỎI]',
        questionPayload,
      ].join('\n'),
      options,
      correctAnswer: 'A',
      source: sourceLabel,
    };
    const state = createBatchPostprocessState([badSeed]);

    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 2,
      expectedQuestions: 1,
      fullText: JSON.stringify({ questions: [repairedQuestion] }),
      partMeta: {
        sourceLabel,
        text: '',
      },
      replaceSeededSourceDuplicates: true,
      topLevelBatchNumber: 3,
    }, state);

    expect(result.newQuestions).toHaveLength(1);
    expect(result.newQuestions[0].id).toBe('seed-batch-3');
    expect(result.newQuestions[0].question).toContain(cleanStem);
    expect(result.newQuestions[0].question).not.toContain('sir dung');
    expect(result.newQuestions[0].question).not.toContain('Ying huyet ap');
    expect(countSharedCaseMarkers(result.newQuestions[0].question)).toBe(2);
    expect(result.duplicates).toHaveLength(0);
    expect(result.autoSkippedCount).toBe(0);
    expect(result.coverageKeys).toHaveLength(1);
  });

  it('keeps a good seeded same-source question instead of replacing it with a weaker duplicate', async () => {
    const sourceLabel = 'merged.pdf | Trang 4-5';
    const cleanStem = 'Bệnh nhân nam, 68 tuổi, 2 tuần nay tự ngừng điều trị suy tim, tăng huyết áp.';
    const questionPayload = '25. Một cận lâm sàng nào cần làm ngay để chẩn đoán bệnh cảnh trên?';
    const options = ['A. Điện tâm đồ', 'B. X-Quang ngực', 'C. Siêu âm tim', 'D. Men tim'];
    const goodSeed: MCQ = {
      ...makeQuestion(3),
      id: 'seed-good',
      question: [
        '[TÌNH HUỐNG]',
        cleanStem,
        '',
        '[CÂU HỎI]',
        questionPayload,
      ].join('\n'),
      options,
      correctAnswer: 'A',
      source: sourceLabel,
    };
    const weakerDuplicate = {
      ...makeQuestion(3),
      question: questionPayload,
      options,
      correctAnswer: 'A',
      source: sourceLabel,
    };
    const state = createBatchPostprocessState([goodSeed]);

    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 2,
      expectedQuestions: 1,
      fullText: JSON.stringify({ questions: [weakerDuplicate] }),
      partMeta: {
        sourceLabel,
        text: '',
      },
      replaceSeededSourceDuplicates: true,
      topLevelBatchNumber: 3,
    }, state);

    expect(result.newQuestions).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
    expect(result.autoSkippedCount).toBe(0);
    expect(result.coverageKeys).toHaveLength(0);
  });

  it('spends selective recovery budget when an existing question from another source covers the missing item', async () => {
    const seed = {
      ...makeQuestion(1),
      source: 'deck.docx | Nhóm khác',
    };
    const extra = {
      ...makeQuestion(2),
      question: 'Câu 2: Câu không nên xử lý khi budget đã đủ?',
    };
    const state = createBatchPostprocessState([seed]);

    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 2,
      fullText: JSON.stringify({ questions: [seed, extra] }),
      partMeta: {
        sourceLabel: 'deck.docx | Nhóm 1',
        text: '',
      },
      recoveryBudgetRemaining: 1,
      topLevelBatchNumber: 1,
    }, state);

    expect(result.autoSkippedCount).toBe(1);
    expect(result.coverageKeys).toHaveLength(1);
    expect(result.newQuestions).toHaveLength(0);
    expect(result.recoveryBudgetRemaining).toBe(0);
  });

  it('tracks coverage by question fingerprint even when generated ids collide', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const state = createBatchPostprocessState();

    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 2,
      fullText: JSON.stringify({
        questions: [
          {
            ...makeQuestion(1),
            question: 'Câu 1: Thuốc nào làm giảm tiền tải trong phù phổi cấp?',
            options: ['A. Nitroglycerin', 'B. Amoxicillin', 'C. Insulin', 'D. Omeprazole'],
          },
          {
            ...makeQuestion(2),
            question: 'Câu 2: Cận lâm sàng nào cần làm ngay khi nghi nhồi máu cơ tim?',
            options: ['A. Điện tâm đồ', 'B. Nội soi dạ dày', 'C. Soi đáy mắt', 'D. Đo loãng xương'],
          },
        ],
      }),
      partMeta: {
        sourceLabel: 'deck.docx | Nhóm 1',
        text: '',
      },
      topLevelBatchNumber: 1,
    }, state);

    expect(result.newQuestions).toHaveLength(2);
    expect(result.newQuestions[0].id).toBe(result.newQuestions[1].id);
    expect(result.coverageKeys).toHaveLength(2);
    expect(new Set(result.coverageKeys).size).toBe(2);
    expect(result.coverageKeys.every(key => key.startsWith('fp:'))).toBe(true);
  });

  it('keeps partial salvage metadata for recovery decisions', async () => {
    const state = createBatchPostprocessState();
    const result = await processBatchPostprocess({
      allowEmpty: false,
      batchIndex: 0,
      expectedQuestions: 3,
      fullText: JSON.stringify({ questions: [makeQuestion(1)] }),
      partMeta: { sourceLabel: 'partial.pdf' },
      topLevelBatchNumber: 1,
    }, state);

    expect(result.salvagedPartial).toBe(true);
    expect(result.missingCount).toBe(2);
    expect(result.newQuestions).toHaveLength(1);
  });
});
