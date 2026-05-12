import { describe, expect, it } from 'vitest';
import { MCQ } from '../types';
import { buildMCQFingerprint, createDuplicateLookup, findDuplicate, normalizeMCQField } from './dedupe';

const makeMCQ = (overrides: Partial<MCQ>): MCQ => ({
  id: overrides.id || 'q1',
  question: overrides.question || 'Câu 1. Chẩn đoán phù hợp nhất là gì?',
  options: overrides.options || [
    'A. Viêm phổi',
    'B. Lao phổi',
    'C. Hen phế quản',
    'D. COPD',
    'E. Suy tim',
  ],
  correctAnswer: overrides.correctAnswer || 'A',
  explanation: overrides.explanation || {
    core: '',
    evidence: '',
    analysis: '',
    warning: '',
  },
  source: overrides.source || '',
  difficulty: overrides.difficulty || 'Medium',
  depthAnalysis: overrides.depthAnalysis || '',
});

describe('MCQ dedupe utilities', () => {
  it('normalizes Vietnamese marks, HTML, labels, whitespace, and punctuation', () => {
    expect(normalizeMCQField('<b>Câu 12.</b> Tăng   huyết áp?')).toBe('tang huyet ap');
    expect(normalizeMCQField('A)  Đái tháo đường&nbsp;type 2.')).toBe('dai thao duong type 2');
  });

  it('builds the same fingerprint for exact Question + A/B/C/D/E duplicates with noisy labels', () => {
    const original = makeMCQ({
      question: 'Câu 1. Nguyên nhân thường gặp của suy tim trái?',
      options: ['A. Tăng huyết áp', 'B. Bệnh mạch vành', 'C. Bệnh van tim', 'D. Viêm cơ tim', 'E. Tất cả đúng'],
    });
    const noisy = makeMCQ({
      question: 'Question 1: Nguyen nhan thuong gap cua suy tim trai',
      options: ['(A) Tang huyet ap.', 'B) Benh mach vanh', 'C. Benh van tim', 'D- Viêm cơ tim', 'E: Tat ca dung'],
    });

    expect(buildMCQFingerprint(noisy)).toBe(buildMCQFingerprint(original));
    expect(findDuplicate(noisy, [original]).action).toBe('autoSkip');
  });

  it('detects OCR/no-accent duplicates across question and options', () => {
    const original = makeMCQ({
      question: 'Câu 2. Triệu chứng điển hình của nhồi máu cơ tim cấp là gì?',
      options: ['A. Đau ngực sau xương ức', 'B. Đau bụng hạ vị', 'C. Ho khan', 'D. Đau khớp', 'E. Ngứa da'],
    });
    const ocrVariant = makeMCQ({
      question: 'Trieu chung dien hinh cua nhoi mau co tim cap la gi',
      options: ['A. Dau nguc sau xuong uc', 'B. Dau bung ha vi', 'C. Ho khan', 'D. Dau khop', 'E. Ngua da'],
    });

    expect(findDuplicate(ocrVariant, [original]).isDup).toBe(true);
  });

  it('does not auto-skip when the question matches but option E differs', () => {
    const original = makeMCQ({
      question: 'Câu 3. Yếu tố nguy cơ của đột quỵ là gì?',
      options: ['A. Tăng huyết áp', 'B. Đái tháo đường', 'C. Rung nhĩ', 'D. Hút thuốc lá', 'E. Tuổi cao'],
    });
    const changedOption = makeMCQ({
      question: 'Yếu tố nguy cơ của đột quỵ là gì?',
      options: ['A. Tăng huyết áp', 'B. Đái tháo đường', 'C. Rung nhĩ', 'D. Hút thuốc lá', 'E. Tuổi trẻ'],
    });

    const result = findDuplicate(changedOption, [original]);
    expect(result.action).toBe('review');
    expect(result.reason).toContain('slot');
    expect(result.reason).toContain('set');
  });

  it('reviews instead of auto-skipping when options are the same but reordered', () => {
    const original = makeMCQ({
      question: 'Câu 3b. Điều trị đầu tay phù hợp nhất là gì?',
      options: ['A. Metformin', 'B. Insulin', 'C. Statin', 'D. Aspirin', 'E. Furosemide'],
      correctAnswer: 'A',
    });
    const reordered = makeMCQ({
      question: 'Điều trị đầu tay phù hợp nhất là gì?',
      options: ['A. Insulin', 'B. Metformin', 'C. Statin', 'D. Aspirin', 'E. Furosemide'],
      correctAnswer: 'B',
    });

    const result = findDuplicate(reordered, [original]);
    expect(result.action).toBe('review');
    expect(result.isAutoSkip).toBe(false);
    expect(result.reason).toContain('Options giống nhưng đổi vị trí');
    expect(result.fieldScores?.optionsAsSet).toBeGreaterThanOrEqual(0.95);
    expect(result.fieldScores?.optionsBySlot).toBeLessThan(0.9);
  });

  it('reviews high-similarity matches with missing options instead of auto-skipping', () => {
    const original = makeMCQ({
      question: 'Câu 3c. Yếu tố nguy cơ chính của bệnh mạch vành là gì?',
      options: ['A. Tăng huyết áp', 'B. Đái tháo đường', 'C. Hút thuốc lá', 'D. Rối loạn lipid máu', 'E. Tuổi cao'],
    });
    const missingOption = makeMCQ({
      question: 'Yếu tố nguy cơ chính của bệnh mạch vành là gì?',
      options: ['A. Tăng huyết áp', 'B. Đái tháo đường', 'C. Hút thuốc lá', 'D. Rối loạn lipid máu'],
    });

    const result = findDuplicate(missingOption, [original]);
    expect(result.action).toBe('review');
    expect(result.isAutoSkip).toBe(false);
  });

  it('rejects duplicates when negative logic flips', () => {
    const original = makeMCQ({
      question: 'Câu 4. Dấu hiệu nào gợi ý viêm màng não?',
    });
    const negated = makeMCQ({
      question: 'Dấu hiệu nào KHÔNG gợi ý viêm màng não?',
    });

    expect(findDuplicate(negated, [original]).isDup).toBe(false);
  });

  it('auto-skips exact negative or exception questions when Q+A-E are identical', () => {
    const original = makeMCQ({
      question: 'Câu 4a. Tất cả dấu hiệu sau gợi ý viêm màng não, NGOẠI TRỪ?',
      options: ['A. Sốt', 'B. Cứng gáy', 'C. Dấu Kernig', 'D. Ban xuất huyết', 'E. Chảy nước mũi trong'],
      correctAnswer: 'E',
    });
    const exact = makeMCQ({
      question: 'Tất cả dấu hiệu sau gợi ý viêm màng não, NGOẠI TRỪ?',
      options: ['A. Sốt', 'B. Cứng gáy', 'C. Dấu Kernig', 'D. Ban xuất huyết', 'E. Chảy nước mũi trong'],
      correctAnswer: 'E',
    });

    const result = findDuplicate(exact, [original]);
    expect(result.action).toBe('autoSkip');
    expect(result.score).toBe(1);
  });

  it('reviews equivalent false-choice wording instead of auto-skipping blindly', () => {
    const exceptQuestion = makeMCQ({
      question: 'Tất cả phát biểu sau về viêm phổi trẻ em đều đúng, NGOẠI TRỪ?',
      options: ['A. Có thể sốt', 'B. Có thể ho', 'C. Có thể thở nhanh', 'D. Có thể rút lõm ngực', 'E. Luôn không cần kháng sinh'],
      correctAnswer: 'E',
    });
    const notTrueQuestion = makeMCQ({
      question: 'Phát biểu nào KHÔNG đúng về viêm phổi trẻ em?',
      options: ['A. Có thể sốt', 'B. Có thể ho', 'C. Có thể thở nhanh', 'D. Có thể rút lõm ngực', 'E. Luôn không cần kháng sinh'],
      correctAnswer: 'E',
    });

    const result = findDuplicate(notTrueQuestion, [exceptQuestion]);
    expect(result.action).toBe('review');
    expect(result.isAutoSkip).toBe(false);
    expect(result.reason).toContain('phủ định/ngoại trừ');
  });

  it('keeps positive treatment and contraindication questions separate', () => {
    const indicated = makeMCQ({
      question: 'Thuốc nào nên dùng trong xử trí ban đầu cơn hen cấp?',
      options: ['A. Salbutamol khí dung', 'B. Morphin', 'C. Propranolol', 'D. Codein', 'E. Diazepam'],
      correctAnswer: 'A',
    });
    const notIndicated = makeMCQ({
      question: 'Thuốc nào KHÔNG nên dùng trong xử trí ban đầu cơn hen cấp?',
      options: ['A. Salbutamol khí dung', 'B. Morphin', 'C. Propranolol', 'D. Codein', 'E. Diazepam'],
      correctAnswer: 'C',
    });

    expect(findDuplicate(notIndicated, [indicated]).action).toBe('unique');
  });

  it('handles English NOT true versus EXCEPT as risky review', () => {
    const exceptQuestion = makeMCQ({
      question: 'All of the following are signs of meningitis EXCEPT?',
      options: ['A. Fever', 'B. Neck stiffness', 'C. Kernig sign', 'D. Photophobia', 'E. Normal CSF glucose always'],
      correctAnswer: 'E',
    });
    const notTrueQuestion = makeMCQ({
      question: 'Which statement is NOT true about signs of meningitis?',
      options: ['A. Fever', 'B. Neck stiffness', 'C. Kernig sign', 'D. Photophobia', 'E. Normal CSF glucose always'],
      correctAnswer: 'E',
    });

    const result = findDuplicate(notTrueQuestion, [exceptQuestion]);
    expect(result.action).toBe('review');
    expect(result.reason).toContain('phủ định/ngoại trừ');
  });

  it('uses partial matching for near-duplicate questions with short OCR insertions', () => {
    const original = makeMCQ({
      question: 'Bệnh nhân sốt cao co giật, cổ cứng, chẩn đoán phù hợp nhất là gì?',
      options: ['A. Viêm màng não', 'B. Viêm dạ dày ruột', 'C. Sốt siêu vi', 'D. Động kinh', 'E. Hạ đường huyết'],
      correctAnswer: 'A',
    });
    const ocrInserted = makeMCQ({
      question: 'Bệnh nhân sốt cao co giật tại nhà, sau đó cổ cứng, chẩn đoán phù hợp nhất là gì?',
      options: ['A. Viêm màng não', 'B. Viêm dạ dày ruột', 'C. Sốt siêu vi', 'D. Động kinh', 'E. Hạ đường huyết'],
      correctAnswer: 'A',
    });

    const result = findDuplicate(ocrInserted, [original]);
    expect(result.isDup).toBe(true);
    expect(result.fieldScores?.questionPartial).toBeGreaterThan(0.9);
  });

  it('keeps same-option near-duplicates in the candidate pool when the new stem is much longer', () => {
    const original = makeMCQ({
      id: 'target',
      question: 'Bệnh nhân sốt cao co giật, cổ cứng, chẩn đoán phù hợp nhất là gì?',
      options: ['A. Viêm màng não', 'B. Viêm dạ dày ruột', 'C. Sốt siêu vi', 'D. Động kinh', 'E. Hạ đường huyết'],
      correctAnswer: 'A',
    });
    const longerVariant = makeMCQ({
      question: 'Bệnh nhân sốt cao co giật tại nhà nhiều lần trước nhập viện, đã được người nhà xoa dầu, cạo gió và cho uống thuốc dân gian, sau đó xuất hiện cổ cứng, chẩn đoán phù hợp nhất là gì?',
      options: ['A. Viêm màng não', 'B. Viêm dạ dày ruột', 'C. Sốt siêu vi', 'D. Động kinh', 'E. Hạ đường huyết'],
      correctAnswer: 'A',
    });
    const distractors = Array.from({ length: 95 }, (_, index) => makeMCQ({
      id: `distractor-${index}`,
      question: `Tình huống lâm sàng nền dài tương đương số ${index} trong bệnh cảnh hô hấp nhi khoa cần xử trí bước ${index % 7} như thế nào cho phù hợp nhất hiện tại?`,
      options: [
        `A. Phương án alpha ${index}`,
        `B. Phương án beta ${index}`,
        `C. Phương án gamma ${index}`,
        `D. Phương án delta ${index}`,
        `E. Phương án epsilon ${index}`,
      ],
      correctAnswer: 'A',
    }));

    const result = findDuplicate(longerVariant, [original, ...distractors]);
    expect(result.action).toBe('autoSkip');
    expect(result.matchedData?.id).toBe('target');
  }, 10000);

  it('does not merge different questions that share a long clinical case stem', () => {
    const stem = 'Bệnh nhân nam 65 tuổi đau ngực dữ dội sau xương ức, vã mồ hôi, điện tâm đồ có ST chênh lên ở DII DIII aVF, tiền sử tăng huyết áp và hút thuốc lá lâu năm.';
    const diagnosis = makeMCQ({
      question: `${stem} Chẩn đoán phù hợp nhất là gì?`,
    });
    const treatment = makeMCQ({
      question: `${stem} Thuốc cần dùng ngay trong xử trí ban đầu là gì?`,
    });

    expect(findDuplicate(treatment, [diagnosis]).isDup).toBe(false);
  });

  it('keeps same-topic questions unique when the learning objective differs', () => {
    const diagnosis = makeMCQ({
      question: 'Bệnh nhân đau ngực sau xương ức lan tay trái. Chẩn đoán phù hợp nhất là gì?',
      options: ['A. Nhồi máu cơ tim', 'B. Viêm phổi', 'C. Trào ngược dạ dày', 'D. Cơn hoảng loạn', 'E. Viêm cơ tim'],
    });
    const prevention = makeMCQ({
      question: 'Bệnh nhân có nguy cơ bệnh mạch vành cao. Biện pháp dự phòng thứ phát quan trọng nhất là gì?',
      options: ['A. Statin', 'B. Kháng sinh', 'C. Thuốc ngủ', 'D. Corticoid', 'E. Kháng histamin'],
    });

    expect(findDuplicate(prevention, [diagnosis]).action).toBe('unique');
  });

  it('can be used to catch duplicates inside one incoming batch', () => {
    const incoming = [
      makeMCQ({ id: 'a', question: 'Câu 5. Điều trị đầu tay tăng huyết áp?', options: ['A. ACEi', 'B. Insulin', 'C. Kháng histamin', 'D. Corticoid', 'E. PPI'] }),
      makeMCQ({ id: 'b', question: 'Dieu tri dau tay tang huyet ap', options: ['A. ACEi', 'B. Insulin', 'C. Khang histamin', 'D. Corticoid', 'E. PPI'] }),
    ];
    const unique: MCQ[] = [];
    const duplicates = incoming.filter(q => {
      const result = findDuplicate(q, unique);
      if (!result.isDup) unique.push(q);
      return result.isDup;
    });

    expect(unique).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });

  it('filters retry batches against existing questions using full MCQ fields', () => {
    const existing = [
      makeMCQ({ id: 'existing', question: 'Câu 6. Biến chứng cấp của đái tháo đường?', options: ['A. Hôn mê nhiễm toan ceton', 'B. Gout', 'C. Viêm gan', 'D. Sỏi thận', 'E. Thiếu máu'] }),
    ];
    const retry = [
      makeMCQ({ id: 'retry', question: 'Bien chung cap cua dai thao duong', options: ['A. Hon me nhiem toan ceton', 'B. Gout', 'C. Viêm gan', 'D. Sỏi thận', 'E. Thiếu máu'] }),
    ];

    const uniqueRetry = retry.filter(q => !findDuplicate(q, existing).isDup);
    expect(uniqueRetry).toHaveLength(0);
  });

  it('duplicate lookup returns the same decisions as findDuplicate while allowing incremental additions', () => {
    const original = makeMCQ({
      id: 'original',
      question: 'Câu 6b. Biến chứng cấp của đái tháo đường?',
      options: ['A. Hôn mê nhiễm toan ceton', 'B. Gout', 'C. Viêm gan', 'D. Sỏi thận', 'E. Thiếu máu'],
    });
    const retry = makeMCQ({
      id: 'retry',
      question: 'Bien chung cap cua dai thao duong',
      options: ['A. Hon me nhiem toan ceton', 'B. Gout', 'C. Viêm gan', 'D. Sỏi thận', 'E. Thiếu máu'],
    });
    const lookup = createDuplicateLookup<MCQ>();

    expect(lookup.find(retry).action).toBe(findDuplicate(retry, []).action);
    lookup.add(original);
    expect(lookup.find(retry).action).toBe(findDuplicate(retry, [original]).action);
  });

  it('does not auto-skip exact fingerprints when the answer conflicts', () => {
    const original = makeMCQ({
      question: 'Câu 7. Thuốc nào là lựa chọn phù hợp nhất?',
      options: ['A. Metformin', 'B. Insulin', 'C. Statin', 'D. Aspirin', 'E. Furosemide'],
      correctAnswer: 'A',
    });
    const conflicting = makeMCQ({
      question: 'Thuốc nào là lựa chọn phù hợp nhất?',
      options: ['A. Metformin', 'B. Insulin', 'C. Statin', 'D. Aspirin', 'E. Furosemide'],
      correctAnswer: 'B',
    });

    const result = findDuplicate(conflicting, [original]);
    expect(result.isDup).toBe(true);
    expect(result.action).toBe('review');
  });

  it('does not auto-skip high shared-stem matches when the answer conflicts', () => {
    const stem = 'Bệnh nhân nam 72 tuổi đau ngực kéo dài, troponin tăng, điện tâm đồ biến đổi động theo thời gian, có tiền sử tăng huyết áp và đái tháo đường nhiều năm.';
    const original = makeMCQ({
      question: `${stem} Chẩn đoán phù hợp nhất là gì?`,
      options: ['A. STEMI', 'B. NSTEMI', 'C. Viêm màng ngoài tim', 'D. Bóc tách động mạch chủ', 'E. Trào ngược dạ dày thực quản'],
      correctAnswer: 'A',
    });
    const conflicting = makeMCQ({
      question: `${stem} Chẩn đoán phù hợp nhất là gì?`,
      options: ['A. STEMI', 'B. NSTEMI', 'C. Viêm màng ngoài tim', 'D. Bóc tách động mạch chủ', 'E. Trào ngược dạ dày thực quản'],
      correctAnswer: 'B',
    });

    const result = findDuplicate(conflicting, [original]);
    expect(result.isDup).toBe(true);
    expect(result.action).toBe('review');
  });

  it('prefers the strongest duplicate match instead of the first acceptable one', () => {
    const weakReview = makeMCQ({
      id: 'weak',
      question: 'Điều trị đầu tay của tăng huyết áp ở bệnh nhân đái tháo đường là gì?',
      options: ['A. ACEi', 'B. PPI', 'C. Kháng histamin', 'D. Morphin', 'E. Diazepam khác liều'],
    });
    const exact = makeMCQ({
      id: 'exact',
      question: 'Câu 8. Điều trị đầu tay của tăng huyết áp ở bệnh nhân đái tháo đường là gì?',
      options: ['A. ACEi', 'B. PPI', 'C. Kháng histamin', 'D. Morphin', 'E. Diazepam'],
    });
    const candidate = makeMCQ({
      question: 'Điều trị đầu tay của tăng huyết áp ở bệnh nhân đái tháo đường là gì?',
      options: ['A. ACEi', 'B. PPI', 'C. Kháng histamin', 'D. Morphin', 'E. Diazepam'],
    });

    const result = findDuplicate(candidate, [weakReview, exact]);
    expect(result.action).toBe('autoSkip');
    expect(result.matchedData?.id).toBe('exact');
  });

  it('detects duplicate on overlapping pages if same question number or highly similar stem even with different options', () => {
    const original = makeMCQ({
      question: 'Câu 49. Điểm giống nhau của adenomyosis và u xơ cơ tử cung là gì?',
      options: ['A. Không có gì', 'B. U lành', 'C. Đều phụ thuộc estrogen', 'D. Đều ác tính'],
      correctAnswer: 'C',
    });
    const duplicateSameNumber = makeMCQ({
      question: 'Câu 49. Điểm giống nhau của adenomyosis và u xơ cơ tử cung là gì?',
      options: ['A. Không giống nhau', 'B. Bệnh lành tính', 'C. Cùng nguồn gốc', 'D. Đáp ứng nội tiết'],
      correctAnswer: 'D',
    });
    const duplicateNoNumberButHighlySimilarStem = makeMCQ({
      question: 'Điểm giống nhau của adenomyosis và u xơ cơ tử cung là gì?',
      options: ['A. Là bệnh lý ác tính', 'B. Cực kỳ hiếm gặp', 'C. Không có triệu chứng gì', 'D. Chỉ gặp ở người trẻ'],
      correctAnswer: 'C',
    });

    const resultSameNumber = findDuplicate(duplicateSameNumber, [original]);
    expect(resultSameNumber.isDup).toBe(true);
    expect(resultSameNumber.action).toBe('review');
    expect(resultSameNumber.reason).toContain('Trùng số thứ tự câu hỏi');

    const resultHighlySimilarStem = findDuplicate(duplicateNoNumberButHighlySimilarStem, [original]);
    expect(resultHighlySimilarStem.isDup).toBe(true);
    expect(resultHighlySimilarStem.action).toBe('review');
    expect(resultHighlySimilarStem.reason).toContain('Trùng lặp thân câu hỏi');
  });

  it('detects duplicates when medical abbreviations are used interchangeably', () => {
    const original = makeMCQ({
      question: 'Bệnh nhân tăng huyết áp và đái tháo đường cần lưu ý gì khi dùng thuốc điều trị?',
      options: ['A. Hạn chế muối', 'B. Uống nhiều nước', 'C. Tập thể dục', 'D. Theo dõi đường huyết'],
    });
    const candidateWithAbbr = makeMCQ({
      question: 'BN THA và ĐTĐ cần lưu ý gì khi dùng thuốc điều trị?',
      options: ['A. Hạn chế muối', 'B. Uống nhiều nước', 'C. Tập thể dục', 'D. Theo dõi đường huyết'],
    });

    const result = findDuplicate(candidateWithAbbr, [original]);
    expect(result.isDup).toBe(true);
    expect(result.action).toBe('autoSkip');
  });

  it('detects duplicates when different question filler words or stopwords are used', () => {
    const original = makeMCQ({
      question: 'Câu hỏi nào sau đây là triệu chứng điển hình của viêm phổi thùy?',
      options: ['A. Sốt cao rét run', 'B. Ho khan', 'C. Đau bụng', 'D. Nôn mửa'],
    });
    const candidateWithDifferentStopwords = makeMCQ({
      question: 'Hãy chọn phát biểu về triệu chứng điển hình của viêm phổi thùy?',
      options: ['A. Sốt cao rét run', 'B. Ho khan', 'C. Đau bụng', 'D. Nôn mửa'],
    });

    const result = findDuplicate(candidateWithDifferentStopwords, [original]);
    expect(result.isDup).toBe(true);
    expect(result.action).toBe('autoSkip');
  });

  it('handles minor OCR typos robustly using Sørensen-Dice coefficient', () => {
    const original = makeMCQ({
      question: 'Chẩn đoán xác định u xơ tử cung dựa vào phương pháp cận lâm sàng nào?',
      options: ['A. Siêu âm ngả âm đạo', 'B. Chụp X-quang bụng', 'C. Thử thai', 'D. Nội soi buồng tử cung'],
    });
    const candidateWithTypos = makeMCQ({
      question: 'Chân doan xac dịnh u xo tu cung dựa vao phuong phap can lam sang nao?',
      options: ['A. Siêu âm ngả âm đạo', 'B. Chụp X-quang bụng', 'C. Thử thai', 'D. Nội soi buồng tử cung'],
    });

    const result = findDuplicate(candidateWithTypos, [original]);
    expect(result.isDup).toBe(true);
    expect(result.action).toBe('autoSkip');
  });

  it('keeps one shared clinical case as separate MCQs when diagnosis and treatment objectives differ', () => {
    const stem = 'Bệnh nhân nữ 58 tuổi đau ngực sau xương ức lan tay trái trong 40 phút, vã mồ hôi, huyết áp 150/90 mmHg, điện tâm đồ có ST chênh lên ở DII DIII aVF.';
    const diagnosis = makeMCQ({
      question: `${stem} Chẩn đoán phù hợp nhất là gì?`,
      options: ['A. Nhồi máu cơ tim cấp', 'B. Viêm màng ngoài tim', 'C. Trào ngược dạ dày', 'D. Cơn đau thắt ngực ổn định', 'E. Bóc tách động mạch chủ'],
      correctAnswer: 'A',
    });
    const treatment = makeMCQ({
      question: `${stem} Xử trí ban đầu phù hợp nhất là gì?`,
      options: ['A. Tái tưới máu khẩn cấp', 'B. Nội soi dạ dày', 'C. Kháng sinh phổ rộng', 'D. Theo dõi tại nhà', 'E. Chườm nóng ngực'],
      correctAnswer: 'A',
    });

    const result = findDuplicate(treatment, [diagnosis]);
    expect(result.action).toBe('unique');
    expect(result.isDup).toBe(false);
  });

  it('keeps one shared clinical case as separate MCQs when complication and investigation objectives differ', () => {
    const stem = 'Bệnh nhân nam 70 tuổi sau thay khớp háng ngày thứ ba, khó thở đột ngột, đau ngực kiểu màng phổi, SpO2 88%, mạch nhanh, chân phải sưng đau.';
    const complication = makeMCQ({
      question: `${stem} Biến chứng phù hợp nhất là gì?`,
      options: ['A. Thuyên tắc phổi', 'B. Viêm phổi hít', 'C. Suy tim mạn', 'D. Cơn hen', 'E. Tràn khí màng phổi'],
      correctAnswer: 'A',
    });
    const investigation = makeMCQ({
      question: `${stem} Cận lâm sàng nên ưu tiên để xác định chẩn đoán là gì?`,
      options: ['A. CT động mạch phổi', 'B. X-quang bụng', 'C. Nội soi phế quản thường quy', 'D. Siêu âm tuyến giáp', 'E. Điện não đồ'],
      correctAnswer: 'A',
    });

    expect(findDuplicate(investigation, [complication]).action).toBe('unique');
  });

  it('does not treat identical options as duplicate when the clinical objective and correct answer differ', () => {
    const stem = 'Bệnh nhân nữ 34 tuổi đau hạ vị, trễ kinh 7 tuần, ra huyết âm đạo ít, beta-hCG tăng, siêu âm chưa thấy túi thai trong buồng tử cung.';
    const diagnosis = makeMCQ({
      question: `${stem} Chẩn đoán cần nghĩ tới nhất là gì?`,
      options: ['A. Thai ngoài tử cung', 'B. Sảy thai hoàn toàn', 'C. Viêm ruột thừa', 'D. U nang buồng trứng xoắn', 'E. Viêm cổ tử cung'],
      correctAnswer: 'A',
    });
    const management = makeMCQ({
      question: `${stem} Xử trí tiếp theo phù hợp nhất là gì?`,
      options: ['A. Thai ngoài tử cung', 'B. Sảy thai hoàn toàn', 'C. Viêm ruột thừa', 'D. U nang buồng trứng xoắn', 'E. Viêm cổ tử cung'],
      correctAnswer: 'B',
    });

    const result = findDuplicate(management, [diagnosis]);
    expect(result.action).toBe('unique');
    expect(result.isAutoSkip).toBe(false);
  });

  it('keeps positive and exception wording separate when one asks for the true statement and the other asks EXCEPT', () => {
    const positive = makeMCQ({
      question: 'Điều nào đúng về điều trị viêm phổi cộng đồng?',
      options: ['A. Cần đánh giá mức độ nặng', 'B. Luôn không dùng kháng sinh', 'C. Không cần theo dõi SpO2', 'D. Chỉ điều trị bằng giảm đau', 'E. Luôn xuất viện ngay'],
      correctAnswer: 'A',
    });
    const except = makeMCQ({
      question: 'Tất cả đều đúng về điều trị viêm phổi cộng đồng, NGOẠI TRỪ?',
      options: ['A. Cần đánh giá mức độ nặng', 'B. Luôn không dùng kháng sinh', 'C. Không cần theo dõi SpO2', 'D. Chỉ điều trị bằng giảm đau', 'E. Luôn xuất viện ngay'],
      correctAnswer: 'B',
    });

    expect(findDuplicate(except, [positive]).action).toBe('unique');
  });

  it('detects English least-likely wording as exception intent and avoids unsafe auto-skip', () => {
    const likely = makeMCQ({
      question: 'Which finding is most likely in acute bacterial meningitis?',
      options: ['A. Fever', 'B. Neck stiffness', 'C. Low CSF glucose', 'D. Photophobia', 'E. Normal CSF protein'],
      correctAnswer: 'C',
    });
    const leastLikely = makeMCQ({
      question: 'Which finding is least likely in acute bacterial meningitis?',
      options: ['A. Fever', 'B. Neck stiffness', 'C. Low CSF glucose', 'D. Photophobia', 'E. Normal CSF protein'],
      correctAnswer: 'E',
    });

    const result = findDuplicate(leastLikely, [likely]);
    expect(result.action).toBe('unique');
    expect(result.isAutoSkip).toBe(false);
  });

  it('does not flag same option sets as duplicates when the question stem is different', () => {
    const diagnosis = makeMCQ({
      question: 'Chẩn đoán phù hợp nhất trong bệnh nhân đau ngực cấp là gì?',
      options: ['A. Nhồi máu cơ tim', 'B. Viêm phổi', 'C. Trào ngược dạ dày', 'D. Cơn hoảng loạn', 'E. Viêm cơ tim'],
      correctAnswer: 'A',
    });
    const riskFactor = makeMCQ({
      question: 'Yếu tố nguy cơ quan trọng nhất cần khai thác ở bệnh nhân nghi bệnh mạch vành là gì?',
      options: ['A. Nhồi máu cơ tim', 'B. Viêm phổi', 'C. Trào ngược dạ dày', 'D. Cơn hoảng loạn', 'E. Viêm cơ tim'],
      correctAnswer: 'E',
    });

    expect(findDuplicate(riskFactor, [diagnosis]).action).toBe('unique');
  });

  it('does not dedupe merely because the answer letter is the same when option contents differ', () => {
    const original = makeMCQ({
      question: 'Điều trị đầu tay của tăng huyết áp không biến chứng là gì?',
      options: ['A. ACEi', 'B. Insulin', 'C. Kháng histamin', 'D. Morphin', 'E. Diazepam'],
      correctAnswer: 'A',
    });
    const different = makeMCQ({
      question: 'Chẩn đoán phù hợp nhất khi bệnh nhân sốt, ho đàm, ran nổ khu trú là gì?',
      options: ['A. Viêm phổi', 'B. Hen phế quản', 'C. Lao phổi tiềm ẩn', 'D. Suy tim', 'E. Thuyên tắc phổi'],
      correctAnswer: 'A',
    });

    expect(findDuplicate(different, [original]).action).toBe('unique');
  });

  it('keeps few-hundred-question dedupe fast enough for interactive review', () => {
    const unique: MCQ[] = [];
    const incoming = Array.from({ length: 300 }, (_, index) => makeMCQ({
      id: `bench-${index}`,
      question: `Câu ${index + 10}. Dấu hiệu đặc hiệu số ${index} trong bệnh cảnh ${index % 17} là gì?`,
      options: [
        `A. Lựa chọn alpha ${index}`,
        `B. Lựa chọn beta ${index}`,
        `C. Lựa chọn gamma ${index}`,
        `D. Lựa chọn delta ${index}`,
        `E. Lựa chọn epsilon ${index}`,
      ],
    }));

    const startedAt = performance.now();
    for (const q of incoming) {
      const result = findDuplicate(q, unique);
      if (!result.isDup) unique.push(q);
    }
    const elapsedMs = performance.now() - startedAt;

    expect(unique.length).toBeGreaterThan(0);
    expect(unique.length).toBeLessThanOrEqual(300);
    expect(elapsedMs).toBeLessThan(4000);
  });
});
