import { describe, it, expect } from 'vitest';
import { buildGoogleBatchMessage, translateErrorForUser } from './brain';

describe('Core Logic', () => {
  it('should be able to run mathematical checks', () => {
    expect(1 + 1).toBe(2);
  });

  it('includes provider model and response details in translated API errors', () => {
    const message = translateErrorForUser(
      new Error('OpenRouter API Error: 400 | model=openai/gpt-5.4 | This model does not support response_format'),
      'Trích xuất'
    );

    expect(message).toContain('Model: openai/gpt-5.4');
    expect(message).toContain('response_format');
  });

  it('omits document parts from Google batch messages when context cache is available', () => {
    const part = { text: 'very long document part' };
    const prompt = 'Dựa trên tài liệu đã cache, hãy trích xuất Phần 1.';

    expect(buildGoogleBatchMessage(part, prompt, 'cachedContents/abc')).toEqual([{ text: prompt }]);
    expect(buildGoogleBatchMessage(part, prompt)).toEqual([part, { text: prompt }]);
  });
});
