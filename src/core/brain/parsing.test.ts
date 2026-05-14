import { describe, it, expect } from 'vitest';
import { cleanQuestionText, createStreamingQuestionBuffer } from './parsing';

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

  it('returns original string if stripping makes it empty', () => {
    expect(cleanQuestionText('Câu 1:')).toBe('Câu 1:');
    expect(cleanQuestionText('1.')).toBe('1.');
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
