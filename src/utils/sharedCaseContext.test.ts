import { describe, expect, it } from 'vitest';
import {
  applySharedCaseContextToBlocks,
  applySharedCaseContextToQuestion,
  extractSharedCaseContexts,
} from './sharedCaseContext';

describe('shared case context detection', () => {
  it('detects repeated Vietnamese question numbers in a shared situation header', () => {
    const contexts = extractSharedCaseContexts(`
Tình huống cho câu 11-12-13-14: Bệnh nhân nữ có siêu âm tử cung trống beta 1300. Siêu âm có 1 khối echo hỗn hợp cạnh buồng trứng.
Câu 11: Chẩn đoán:
`);

    expect(contexts[0]).toMatchObject({
      startQuestion: 11,
      endQuestion: 14,
      confidence: 'explicit',
    });
    expect(contexts[0].stem).toContain('beta 1300');
  });

  it('detects Vietnamese range words and OCR whitespace', () => {
    const contexts = extractSharedCaseContexts(`
Dữ kiện sau
áp dụng cho các câu
11 đến 14
Bệnh nhân nam 60 tuổi đau ngực, khó thở, SpO2 giảm.
Câu 11. Chẩn đoán phù hợp nhất?
`);

    expect(contexts[0].startQuestion).toBe(11);
    expect(contexts[0].endQuestion).toBe(14);
    expect(contexts[0].stem).toContain('SpO2 giảm');
  });

  it('detects English case and vignette item-set forms', () => {
    const caseContexts = extractSharedCaseContexts(`
Case for questions 11, 12, 13, and 14: A 30-year-old woman presents with pelvic pain and positive beta-hCG.
Question 11: Most likely diagnosis?
`);
    const vignetteContexts = extractSharedCaseContexts(`
Clinical vignette for questions 21 through 23
A 45-year-old man presents with chest pain and diaphoresis.
Question 21. Next best step?
`);
    const itemSetContexts = extractSharedCaseContexts(`
Item set 31-33: A newborn has cyanosis after feeding and a loud murmur.
Question 31. Diagnosis?
`);

    expect(caseContexts[0]).toMatchObject({ startQuestion: 11, endQuestion: 14 });
    expect(vignetteContexts[0]).toMatchObject({ startQuestion: 21, endQuestion: 23 });
    expect(itemSetContexts[0]).toMatchObject({ startQuestion: 31, endQuestion: 33 });
  });

  it('detects a shared stem ending on one page before questions start on the next page', () => {
    const contexts = extractSharedCaseContexts(`
--- Trang 1 ---
Bệnh cảnh sau dùng cho câu 41 và 42
Bệnh nhân nữ 55 tuổi đau ngực dữ dội, mạch nhanh, huyết áp tụt sau bó bột chi dưới.
--- Trang 2 ---
Câu 41. Chẩn đoán phù hợp nhất?
`);

    expect(contexts[0]).toMatchObject({ startQuestion: 41, endQuestion: 42 });
    expect(contexts[0].stem).toContain('huyết áp tụt');
  });

  it('expands parsed MCQ blocks when the clinical stem is split by a page boundary', () => {
    const source = `
--- Trang 7 ---
Tình huống lâm sàng sau dùng cho câu 41-42
Bệnh nhân nữ 63 tuổi đau ngực dữ dội, khó thở, mạch nhanh,
huyết áp tụt sau phẫu thuật thay khớp háng.
--- Trang 8 ---
Câu 41. Chẩn đoán phù hợp nhất?
A. Thuyên tắc phổi
B. Viêm phổi
C. Tràn khí màng phổi
D. Nhồi máu cơ tim
`;
    const blocks = applySharedCaseContextToBlocks(source, [
      [
        '<<<MCQ 1>>>',
        'Question: Câu 41. Chẩn đoán phù hợp nhất?',
        'A. Thuyên tắc phổi',
        'B. Viêm phổi',
      ].join('\n'),
    ]);

    expect(blocks[0]).toContain('[TÌNH HUỐNG]');
    expect(blocks[0]).toContain('đau ngực dữ dội, khó thở, mạch nhanh');
    expect(blocks[0]).toContain('huyết áp tụt sau phẫu thuật thay khớp háng');
    expect(blocks[0]).toContain('[CÂU HỎI]');
  });

  it('prepends a stable shared-case block without duplicating existing stems', () => {
    const source = `
Tình huống cho câu 11-12-13-14: Bệnh nhân nữ có siêu âm tử cung trống beta 1300. Siêu âm có 1 khối echo hỗn hợp cạnh buồng trứng.
Câu 11: Chẩn đoán:
`;
    const contexts = extractSharedCaseContexts(source);
    const expanded = applySharedCaseContextToQuestion('Câu 11: Chẩn đoán:', contexts);

    expect(expanded).toContain('[TÌNH HUỐNG]');
    expect(expanded).toContain('[CÂU HỎI]');
    expect(expanded).toContain('Bệnh nhân nữ có siêu âm tử cung trống beta 1300');
    expect(applySharedCaseContextToQuestion(expanded, contexts)).toBe(expanded);
  });
});
