import { describe, expect, it } from 'vitest';
import { MCQ } from '../types';
import { buildMCQFingerprint, findDuplicate, normalizeMCQField } from './dedupe';

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
