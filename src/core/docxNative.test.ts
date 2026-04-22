import { describe, expect, it } from 'vitest';
import { getNativeMcqBlocks, parseDocxDocumentXml, splitNativeMcqTextIntoBatches } from './docxNative';

const p = (text: string, highlighted = false) => `
  <w:p>
    <w:r>${highlighted ? '<w:rPr><w:highlight w:val="yellow"/></w:rPr>' : ''}<w:t>${text}</w:t></w:r>
  </w:p>
`;

describe('DOCX native MCQ parser', () => {
  it('extracts MCQs and uses yellow highlight as the correct answer', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${p('Về động mạch và tĩnh mạch vành, câu nào sau đây sai?')}
          ${p('A. Tĩnh mạch tim lớn đi trong rãnh gian thất trước')}
          ${p('B. Tĩnh mạch tim giữa đổ vào xoang tĩnh mạch vành')}
          ${p('C. Động mạch vành trái cho nhánh động mạch gian thất trước')}
          ${p('D. Nhánh gian thất sau thường xuất phát từ động mạch mũ', true)}
          ${p('Đáy tim được tạo bởi')}
          ${p('A. Tâm thất trái và phần sau tâm thất phải')}
          ${p('B. Tâm nhĩ phải và phần sau tâm nhĩ trái')}
          ${p('C. Tâm nhĩ trái và phần sau tâm nhĩ phải', true)}
          ${p('D. Tâm thất phải và phần sau tâm thất trái')}
        </w:body>
      </w:document>
    `;

    const result = parseDocxDocumentXml(xml);

    expect(result.mcqs).toHaveLength(2);
    expect(result.mcqs[0].question).toContain('câu nào sau đây sai');
    expect(result.mcqs[0].options).toHaveLength(4);
    expect(result.mcqs[0].correctAnswer).toBe('D');
    expect(result.mcqs[1].correctAnswer).toBe('C');
    expect(result.nativeText).toContain('✅ D.');
    expect(result.nativeText).toContain('[DOCX_NATIVE_MCQ_COUNT: 2]');
  });

  it('supports five-option questions and leaves correct answer empty without highlight', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${p('Câu hỏi không có đáp án tô vàng')}
          ${p('A. Một')}
          ${p('B. Hai')}
          ${p('C. Ba')}
          ${p('D. Bốn')}
          ${p('E. Năm')}
        </w:body>
      </w:document>
    `;

    const result = parseDocxDocumentXml(xml);

    expect(result.mcqs).toHaveLength(1);
    expect(result.mcqs[0].options).toHaveLength(5);
    expect(result.mcqs[0].correctAnswer).toBe('');
  });

  it('splits native DOCX MCQs into fixed-size batches without cutting questions', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${Array.from({ length: 12 }, (_, index) => `
            ${p(`Câu hỏi ${index + 1}`)}
            ${p('A. Một')}
            ${p('B. Hai', true)}
            ${p('C. Ba')}
            ${p('D. Bốn')}
          `).join('')}
        </w:body>
      </w:document>
    `;

    const result = parseDocxDocumentXml(xml);
    const batches = splitNativeMcqTextIntoBatches(result.nativeText, 10);

    expect(result.mcqs).toHaveLength(12);
    expect(batches).toHaveLength(2);
    expect(getNativeMcqBlocks(batches[0])).toHaveLength(10);
    expect(getNativeMcqBlocks(batches[1])).toHaveLength(2);
  });
});
