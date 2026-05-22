import { cleanQuestionText, extractQuestionNumberFromText, createStreamingQuestionBuffer } from './parsing';

describe('cleanQuestionText', () => {
  it('strips standard Vietnamese question prefixes', () => {
    expect(cleanQuestionText('Câu 1: Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('Câu hỏi 1. Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('Cau 1 - Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('câu 12: Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
  });

  it('strips standard English question prefixes', () => {
    expect(cleanQuestionText('Question 1: What is...?')).toBe('What is...?');
    expect(cleanQuestionText('Q1) What is...?')).toBe('What is...?');
    expect(cleanQuestionText('q 1: What is...?')).toBe('What is...?');
  });

  it('strips bare numbers with space or specific separators', () => {
    expect(cleanQuestionText('1. Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('1) Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('1: Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('1 - Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('I. Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('IX. Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
  });

  it('preserves decimals in text', () => {
    // If there is no space after the dot, it should NOT strip "1.5 "
    expect(cleanQuestionText('1.5 là giá trị của...')).toBe('1.5 là giá trị của...');
    // But if there is a space after the dot, it strips "1."
    expect(cleanQuestionText('1. 5 là giá trị của...')).toBe('5 là giá trị của...');
  });

  it('strips prefixes with difficulty tags or brackets', () => {
    expect(cleanQuestionText('Câu 1 (Mức độ khó): Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('Câu 1 [VD]: Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('1 (TH). Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('[Câu 1] Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('(1) Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('<Câu 1> Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
  });

  it('strips markdown formatting around prefixes', () => {
    expect(cleanQuestionText('**Câu 1:** Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('*1.* Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('__Câu 1:__ Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
  });

  it('handles letters in question numbers', () => {
    expect(cleanQuestionText('Câu 1a: Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
    expect(cleanQuestionText('Câu 12B: Nội dung câu hỏi')).toBe('Nội dung câu hỏi');
  });

  it('handles padding words and hierarchical numbers (absolute smartest cases)', () => {
    expect(cleanQuestionText('Câu số 1: Nội dung')).toBe('Nội dung');
    expect(cleanQuestionText('Câu thứ 1: Nội dung')).toBe('Nội dung');
    expect(cleanQuestionText('Question No. 1: Nội dung')).toBe('Nội dung');
    expect(cleanQuestionText('Bài tập 1: Nội dung')).toBe('Nội dung');
    expect(cleanQuestionText('Câu 1.1: Nội dung')).toBe('Nội dung');
    expect(cleanQuestionText('1.2.3. Nội dung')).toBe('Nội dung');
  });

  it('handles Case title prefix stripping and preservation under vignette wrappers', () => {
    expect(cleanQuestionText('Case 5.2 — Hình ảnh siêu âm')).toBe('Hình ảnh siêu âm');
    expect(cleanQuestionText('[TÌNH HUỐNG]\nCase 5.2 — Hình ảnh siêu âm')).toBe('[TÌNH HUỐNG]\nCase 5.2 — Hình ảnh siêu âm');
  });

  it('returns original string if stripping makes it empty', () => {
    expect(cleanQuestionText('Câu 1:')).toBe('Câu 1:');
    expect(cleanQuestionText('1.')).toBe('1.');
  });
});

describe('extractQuestionNumberFromText', () => {
  it('extracts number from standard prefixes', () => {
    expect(extractQuestionNumberFromText('Câu 1: Nội dung')).toBe(1);
    expect(extractQuestionNumberFromText('Question 123. What is...')).toBe(123);
    expect(extractQuestionNumberFromText('Q 42) Hello')).toBe(42);
  });

  it('extracts number from Case prefixes and wide dashes', () => {
    expect(extractQuestionNumberFromText('Case 5.3 — Gợi ý thai trứng')).toBe(5);
    expect(extractQuestionNumberFromText('Case 5.2 — Hình ảnh siêu âm')).toBe(5);
    expect(extractQuestionNumberFromText('Case 12 – Title')).toBe(12);
  });

  it('bypasses [TÌNH HUỐNG] and [CÂU HỎI] wrappers', () => {
    expect(extractQuestionNumberFromText('[TÌNH HUỐNG]\nCase 5.2 — Hình ảnh siêu âm')).toBe(5);
    expect(extractQuestionNumberFromText('[CÂU HỎI]\nCâu 47. Xét nghiệm cần thực hiện?')).toBe(47);
    expect(extractQuestionNumberFromText('[TÌNH HUỐNG]\nCase 1: Bệnh nhân nam 60 tuổi...\n\n[CÂU HỎI]\nCâu 5: Chẩn đoán nào phù hợp?')).toBe(5);
    expect(extractQuestionNumberFromText('[TÌNH HUỐNG]\nTinh huong 3: Bệnh nhi...\n\n[CAU HOI]\nCâu 12 - Điều trị tiếp theo?')).toBe(12);
  });
});

describe('createStreamingQuestionBuffer', () => {
  const question = (id: number) => ({
    question: `Câu ${id}: Nội dung câu hỏi ${id}?`,
    options: ['A. Một', 'B. Hai', 'C. Ba', 'D. Bốn'],
    correctAnswer: 'A',
    explanation: { core: `Core ${id}`, evidence: '', analysis: '', warning: '' },
    source: 'stream-fixture',
    difficulty: 'Easy',
    depthAnalysis: '',
  });

  it('emits each completed streamed question once without rescanning the full payload', () => {
    const buffer = createStreamingQuestionBuffer();
    const payload = JSON.stringify({ questions: [question(1), question(2), question(3)] });
    const chunks = payload.match(/.{1,23}/g) || [];
    const emitted = chunks.flatMap(chunk => {
      buffer.append(chunk);
      return buffer.drain();
    });

    expect(emitted.map(item => item.question)).toEqual([
      'Nội dung câu hỏi 1?',
      'Nội dung câu hỏi 2?',
      'Nội dung câu hỏi 3?',
    ]);
    expect(buffer.drain()).toEqual([]);
  });

  it('waits for an object to close before emitting it', () => {
    const buffer = createStreamingQuestionBuffer();
    const payload = JSON.stringify({ questions: [question(1)] });
    const splitAt = payload.indexOf('"correctAnswer"');

    buffer.append(payload.slice(0, splitAt));
    expect(buffer.drain()).toEqual([]);

    buffer.append(payload.slice(splitAt));
    expect(buffer.drain()).toHaveLength(1);
    expect(buffer.drain()).toEqual([]);
  });
});
