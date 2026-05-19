import { describe, expect, it } from 'vitest';
import {
  applySharedCaseContextToBlocks,
  applySharedCaseContextToQuestion,
  extractSharedCaseContexts,
  normalizeSharedCaseQuestion,
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

  it('does NOT double-prepend when OCR stem lacks diacritics but AI question has them', () => {
    // This reproduces the exact bug: PDF has OCR text layer without Vietnamese diacritics,
    // but AI reads the image and returns proper Vietnamese text. The stem comparison must
    // be diacritics-insensitive to avoid duplicating the clinical context.
    const ocrSource = `
Tinh huong lam sang cho cau 13-14: Benh nhan nu, 54 tuoi, tang huyet ap vo can, benh than man.
Cau 13. Vi sao nguoi benh nay co chi dinh kiem tra nhiem H.pylori?
`;
    const contexts = extractSharedCaseContexts(ocrSource);
    // AI returns question with proper Vietnamese diacritics INCLUDING the stem already
    const aiQuestion = 'Tình huống lâm sàng cho câu 13-14: Bệnh nhân nữ, 54 tuổi, tăng huyết áp vô căn, bệnh thận mạn. Câu 13. Vì sao người bệnh này có chỉ định kiểm tra nhiễm H.pylori?';
    const result = applySharedCaseContextToQuestion(aiQuestion, contexts);
    // Should NOT prepend the OCR stem because the stem content is already present (just with diacritics)
    expect(result).toBe(aiQuestion);
    expect(result).not.toContain('[TÌNH HUỐNG]');
  });

  it('detects diacritics-variant stem overlap even with mixed OCR artifacts', () => {
    const ocrSource = `
Tinh huong cho cau 25-26: Benh nhan nam, 68 tuoi, suy tim, tang huyet ap.
Cau 25. Mot can lam sang nao can lam ngay?
`;
    const contexts = extractSharedCaseContexts(ocrSource);
    // AI question already contains the stem content with proper Vietnamese
    const aiQuestion = '[TÌNH HUỐNG]\nTình huống cho câu 25-26: Bệnh nhân nam, 68 tuổi, suy tim, tăng huyết áp.\n\n[CÂU HỎI]\nCâu 25. Một cận lâm sàng nào cần làm ngay?';
    const result = applySharedCaseContextToQuestion(aiQuestion, contexts);
    // Must NOT double-prepend
    expect(result).toBe(aiQuestion);
  });

  it('collapses nested shared-case wrappers and keeps the cleaner clinical stem', () => {
    const duplicated = [
      '[TÌNH HUỐNG]',
      'Tinh huong sau sir dung cho cau 25-26 Benh nhan nam, 68 tui, 2 tuan nay ty ngung dieu tri Suy tim, Ying huyet ap. Cach nhap vien 4 gid, benh nhan dang ngu thi dot ngOt kho the phai nam dau cao nen nhap vien.',
      '',
      '[CÂU HỎI]',
      '[TÌNH HUỐNG]',
      'Bệnh nhân nam, 68 tuổi, 2 tuần nay tự ngừng điều trị Suy tim, tăng huyết áp. Cách nhập viện 4 giờ, bệnh nhân đang ngủ thì đột ngột khó thở phải nằm đầu cao nên nhập viện. Tại bệnh viện: người bệnh có vẻ kích động, da ẩm rịn mồ hôi, khó thở co kéo các hố hấp phụ, huyết áp 200/100mmHg, SpO2 88%, tim T1 và T2 đều, nghe T3 rõ ở mỏm, tần số tim 120 lần/phút, phổi ran ẩm hai phế trường.',
      '',
      '[CÂU HỎI]',
      '25. Một cận lâm sàng nào cần làm ngay để chẩn đoán bệnh cảnh trên:',
    ].join('\n');

    const normalized = normalizeSharedCaseQuestion(duplicated);

    expect(normalized.match(/\[TÌNH HUỐNG\]/g)).toHaveLength(1);
    expect(normalized.match(/\[CÂU HỎI\]/g)).toHaveLength(1);
    expect(normalized).toContain('Bệnh nhân nam, 68 tuổi');
    expect(normalized).toContain('25. Một cận lâm sàng nào cần làm ngay');
    expect(normalized).not.toContain('sir dung');
    expect(normalized).not.toContain('Ying huyet ap');
  });

  it('recognizes an already-present clean Vision stem despite a noisy OCR text-layer context', () => {
    const noisyOcrSource = `
Tinh huong sau sir dung cho cau 25-26 Benh nhan nam, 68 tui, 2 tuan nay ty ngung dieu tri Suy tim, Ying huyet ap. Cach nhap vien 4 gid, benh nhan dang ngu thi dot ngOt kho the phai nam dau cao nen nhap vien.
Cau 25. Mot can lam sang nao can lam ngay de chan doan?
`;
    const contexts = extractSharedCaseContexts(noisyOcrSource);
    const aiQuestion = [
      '[TÌNH HUỐNG]',
      'Bệnh nhân nam, 68 tuổi, 2 tuần nay tự ngừng điều trị Suy tim, tăng huyết áp. Cách nhập viện 4 giờ, bệnh nhân đang ngủ thì đột ngột khó thở phải nằm đầu cao nên nhập viện.',
      '',
      '[CÂU HỎI]',
      '25. Một cận lâm sàng nào cần làm ngay để chẩn đoán bệnh cảnh trên:',
    ].join('\n');

    const result = applySharedCaseContextToQuestion(aiQuestion, contexts);

    expect(result).toBe(normalizeSharedCaseQuestion(aiQuestion));
    expect(result.match(/\[TÌNH HUỐNG\]/g)).toHaveLength(1);
    expect(result).not.toContain('sir dung');
  });

  it('does NOT match a scrambled text layer where keyword is far from range without transitions', () => {
    const scrambledSource = `
35. Xử trí nào sau đây phù hợp nhất trong tình huống này?
A. Truyền tĩnh mạch NatriBicarbonate 1,4%
B. Truyền tĩnh mạch Natri Chlorua 0,9%
C. Truyền tĩnh mạch Furosemide
D. Truyền tĩnh mạch Dopamin
36. Sau giai đoạn xử trí ban đầu kể trên, cần đánh giá triệu chứng nào sau đây để biết được bệnh nhân có đáp ứng điều trị hay không?
A. Lượng nước tiểu theo giờ
B. Động mạch cổ
C. Âm thổi ở tim
D. Nhiệt độ cơ thể
Tình huống sau sử dụng cho câu 39-40
Một bệnh nhân có kết quả điện giải đồ máu như sau: Na+ 188 mEq/l, K+ 3.3 mEq/l
39. Bệnh nhân này bị rối loạn điện giải gì?
`;
    const contexts = extractSharedCaseContexts(scrambledSource);
    
    expect(contexts).toHaveLength(1);
    expect(contexts[0].startQuestion).toBe(39);
    expect(contexts[0].endQuestion).toBe(40);
    expect(contexts[0].stem).not.toContain('tình huống này?');
    expect(contexts[0].stem).toContain('Một bệnh nhân có kết quả');
  });
});

