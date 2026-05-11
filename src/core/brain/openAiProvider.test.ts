import { describe, expect, it } from 'vitest';
import { toOpenAIContentFromPart } from './openAiProvider';

describe('OpenAI-compatible provider vision payloads', () => {
  it('keeps multi-page PDF vision batches together with text-layer context', () => {
    const content = toOpenAIContentFromPart({
      text: 'Tình huống lâm sàng cho câu 41-42. Bệnh nhân đau ngực sát cuối trang.',
      inlineDataParts: [
        { mimeType: 'image/jpeg', data: 'page-1' },
        { mimeType: 'image/jpeg', data: 'page-2' },
      ],
      sourceLabel: 'case.pdf | Trang 1-2',
    });

    expect(content).toEqual([
      { type: 'text', text: '[PDF_TEXT_LAYER_CONTEXT]\nTình huống lâm sàng cho câu 41-42. Bệnh nhân đau ngực sát cuối trang.' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,page-1' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,page-2' } },
    ]);
  });
});
