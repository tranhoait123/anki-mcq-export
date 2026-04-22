import { describe, expect, it } from 'vitest';
import { getNativeMcqBlocks, parseDocxDocumentXml, splitNativeMcqTextIntoBatches } from './docxNative';

const p = (text: string, highlighted = false) => `
  <w:p>
    <w:r>${highlighted ? '<w:rPr><w:highlight w:val="yellow"/></w:rPr>' : ''}<w:t>${text}</w:t></w:r>
  </w:p>
`;

const numberedP = (text: string, numId: number, red = false) => `
  <w:p>
    <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>
    <w:r>${red ? '<w:rPr><w:color w:val="FF0000"/></w:rPr>' : ''}<w:t>${text}</w:t></w:r>
  </w:p>
`;

const numberingXml = `
  <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
    <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
    <w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
    <w:num w:numId="11"><w:abstractNumId w:val="1"/></w:num>
    <w:num w:numId="22"><w:abstractNumId w:val="2"/></w:num>
  </w:numbering>
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
    expect(result.plainText).toContain('Đáy tim được tạo bởi');
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

  it('does not treat a numbered next question as option E after four literal options', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${numberedP('Về động mạch và tĩnh mạch vành, câu nào sau đây sai?', 1)}
          ${p('A. Tĩnh mạch tim lớn đi trong rãnh gian thất trước')}
          ${p('B. Tĩnh mạch tim giữa đổ vào xoang tĩnh mạch vành')}
          ${p('C. Động mạch vành trái cho nhánh động mạch gian thất trước')}
          ${p('D. Nhánh gian thất sau thường xuất phát từ động mạch mũ', true)}
          ${numberedP('Đáy tim được tạo bởi', 1)}
          ${p('A. Tâm thất trái và phần sau tâm thất phải')}
          ${p('B. Tâm nhĩ phải và phần sau tâm nhĩ trái')}
          ${p('C. Tâm nhĩ trái và phần sau tâm nhĩ phải', true)}
          ${p('D. Tâm thất phải và phần sau tâm thất trái')}
        </w:body>
      </w:document>
    `;

    const result = parseDocxDocumentXml(xml);

    expect(result.mcqs).toHaveLength(2);
    expect(result.mcqs[0].options).toHaveLength(4);
    expect(result.mcqs[0].options.join('\n')).not.toContain('Đáy tim được tạo bởi');
    expect(result.mcqs[1].question).toBe('Đáy tim được tạo bởi');
  });

  it('extracts Word auto-numbered options and uses red text as the correct answer', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${p('Câu 1: Động mạch cấp máu cho lá tạng ngoại tâm mạc:')}
          ${numberedP('Động mạch vành', 1, true)}
          ${numberedP('Động mạch màng ngoài tim', 1)}
          ${numberedP('Động mạch gian thất trước', 1)}
          ${numberedP('Động mạch mũ', 1)}
          ${p('Câu 2: Tĩnh mạch tim lớn đi trong rãnh nào?')}
          ${numberedP('Rãnh vành', 2)}
          ${numberedP('Rãnh gian nhĩ', 2)}
          ${numberedP('Rãnh tận cùng', 2)}
          ${numberedP('Rãnh gian thất trước', 2, true)}
        </w:body>
      </w:document>
    `;

    const result = parseDocxDocumentXml(xml);

    expect(result.mcqs).toHaveLength(2);
    expect(result.mcqs[0].options).toEqual([
      'A. Động mạch vành',
      'B. Động mạch màng ngoài tim',
      'C. Động mạch gian thất trước',
      'D. Động mạch mũ',
    ]);
    expect(result.mcqs[0].correctAnswer).toBe('A');
    expect(result.mcqs[1].correctAnswer).toBe('D');
    expect(result.nativeText).toContain('✅ A. Động mạch vành');
    expect(result.nativeText).toContain('✅ D. Rãnh gian thất trước');
  });

  it('uses numbering.xml to tell letter options apart from decimal question numbering', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${numberedP('Câu hỏi đánh số bằng decimal trong Word', 22)}
          ${numberedP('Lựa chọn một', 11)}
          ${numberedP('Lựa chọn hai', 11)}
          ${numberedP('Lựa chọn ba', 11)}
          ${numberedP('Lựa chọn bốn', 11, true)}
          ${numberedP('Câu hỏi decimal kế tiếp', 22)}
          ${numberedP('Một', 11)}
          ${numberedP('Hai', 11, true)}
          ${numberedP('Ba', 11)}
          ${numberedP('Bốn', 11)}
        </w:body>
      </w:document>
    `;

    const result = parseDocxDocumentXml(xml, numberingXml);

    expect(result.mcqs).toHaveLength(2);
    expect(result.mcqs[0].question).toBe('Câu hỏi đánh số bằng decimal trong Word');
    expect(result.mcqs[0].options).toEqual(['A. Lựa chọn một', 'B. Lựa chọn hai', 'C. Lựa chọn ba', 'D. Lựa chọn bốn']);
    expect(result.mcqs[0].correctAnswer).toBe('D');
    expect(result.mcqs[1].question).toBe('Câu hỏi decimal kế tiếp');
    expect(result.mcqs[1].correctAnswer).toBe('B');
  });

  it('recognizes shaded and symbol-marked answers plus parenthesized options', () => {
    const shadedP = (text: string) => `
      <w:p>
        <w:r><w:rPr><w:shd w:fill="FFF2CC"/></w:rPr><w:t>${text}</w:t></w:r>
      </w:p>
    `;
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${p('Câu 1: Marker bằng shading')}
          ${p('(A) Một')}
          ${shadedP('(B) Hai')}
          ${p('(C) Ba')}
          ${p('(D) Bốn')}
          ${p('Câu 2: Marker bằng ký hiệu')}
          ${p('A) Một')}
          ${p('B) Hai')}
          ${p('✓ C) Ba')}
          ${p('D) Bốn')}
        </w:body>
      </w:document>
    `;

    const result = parseDocxDocumentXml(xml);

    expect(result.mcqs).toHaveLength(2);
    expect(result.mcqs[0].correctAnswer).toBe('B');
    expect(result.mcqs[1].correctAnswer).toBe('C');
    expect(result.mcqs[1].options[2]).toBe('C. Ba');
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

  it('keeps DOCX structured fallback batches for many unmarked questions under 15000 chars', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:body>
          ${Array.from({ length: 40 }, (_, index) => `
            ${p(`Câu ${index + 1}: Chọn đáp án đúng`)}
            ${p('A. Một')}
            ${p('B. Hai')}
            ${p('C. Ba')}
            ${p('D. Bốn')}
          `).join('')}
        </w:body>
      </w:document>
    `;

    const result = parseDocxDocumentXml(xml);
    const batches = splitNativeMcqTextIntoBatches(result.structuredText, 10);

    expect(result.mcqs).toHaveLength(40);
    expect(result.mcqs.every((mcq) => mcq.correctAnswer === '')).toBe(true);
    expect(result.structuredText.length).toBeLessThan(15000);
    expect(batches).toHaveLength(4);
    expect(getNativeMcqBlocks(batches[0])).toHaveLength(10);
  });
});
