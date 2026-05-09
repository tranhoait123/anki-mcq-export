import { describe, it, expect } from 'vitest';
import { cleanQuestionText } from './parsing';

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
