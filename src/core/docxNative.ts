import JSZip from 'jszip';

export interface DocxParagraph {
  text: string;
  highlighted: boolean;
}

export interface NativeDocxMcq {
  question: string;
  options: string[];
  correctAnswer: string;
}

export interface NativeDocxParseResult {
  paragraphs: DocxParagraph[];
  mcqs: NativeDocxMcq[];
  nativeText: string;
}

const OPTION_PATTERN = /^([A-E])\s*[\.:)]\s*(.+)$/i;
const MCQ_MARKER_PATTERN = /^<<<MCQ\s+\d+>>>$/m;

const decodeXml = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const normalizeParagraphText = (value: string): string =>
  value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim();

const extractParagraphText = (paragraphXml: string): string => {
  const pieces: string[] = [];
  const tokenPattern = /<w:(t|tab|br)\b([^>]*)>([\s\S]*?)<\/w:t>|<w:(tab|br)\b[^>]*\/>/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(paragraphXml)) !== null) {
    const token = match[1] || match[4];
    if (token === 't') pieces.push(decodeXml(match[3] || ''));
    if (token === 'tab') pieces.push('\t');
    if (token === 'br') pieces.push('\n');
  }

  return normalizeParagraphText(pieces.join(''));
};

const hasHighlight = (paragraphXml: string): boolean =>
  /<w:highlight\b(?![^>]*w:val="none")[^>]*\/?>/i.test(paragraphXml);

export const parseDocxDocumentXml = (documentXml: string): NativeDocxParseResult => {
  const paragraphs = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [])
    .map((paragraphXml) => ({
      text: extractParagraphText(paragraphXml),
      highlighted: hasHighlight(paragraphXml),
    }))
    .filter((paragraph) => paragraph.text.length > 0);

  const mcqs = parseMcqsFromParagraphs(paragraphs);
  return {
    paragraphs,
    mcqs,
    nativeText: buildNativeMcqText(mcqs),
  };
};

export const parseNativeDocxMcqs = async (arrayBuffer: ArrayBuffer): Promise<NativeDocxParseResult> => {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('Không tìm thấy word/document.xml trong file DOCX');
  return parseDocxDocumentXml(documentXml);
};

export const parseMcqsFromParagraphs = (paragraphs: DocxParagraph[]): NativeDocxMcq[] => {
  const mcqs: NativeDocxMcq[] = [];
  let questionLines: string[] = [];
  let options: { letter: string; text: string; highlighted: boolean }[] = [];

  const flush = () => {
    const cleanQuestion = questionLines.join(' ').replace(/\s+/g, ' ').trim();
    const cleanOptions = options.map((option) => `${option.letter}. ${option.text.replace(/\s+/g, ' ').trim()}`);
    if (cleanQuestion && cleanOptions.length >= 4) {
      const highlightedOption = options.find((option) => option.highlighted);
      mcqs.push({
        question: cleanQuestion,
        options: cleanOptions,
        correctAnswer: highlightedOption?.letter || '',
      });
    }
    questionLines = [];
    options = [];
  };

  for (const paragraph of paragraphs) {
    const text = normalizeParagraphText(paragraph.text);
    if (!text) continue;

    const optionMatch = text.match(OPTION_PATTERN);
    if (optionMatch) {
      if (options.length >= 5) flush();
      if (questionLines.length === 0 && mcqs.length > 0) {
        continue;
      }
      options.push({
        letter: optionMatch[1].toUpperCase(),
        text: optionMatch[2],
        highlighted: paragraph.highlighted,
      });
      continue;
    }

    if (options.length >= 4) flush();

    if (options.length > 0) {
      const lastOption = options[options.length - 1];
      lastOption.text = `${lastOption.text} ${text}`.trim();
      lastOption.highlighted = lastOption.highlighted || paragraph.highlighted;
    } else {
      questionLines.push(text);
    }
  }

  flush();
  return mcqs;
};

export const buildNativeMcqText = (mcqs: NativeDocxMcq[]): string => {
  if (mcqs.length === 0) return '';

  const blocks = mcqs.map((mcq, index) => {
    const optionLines = mcq.options.map((option) => {
      const letter = option.match(/^([A-E])\s*[\.:)]/i)?.[1]?.toUpperCase();
      return letter && letter === mcq.correctAnswer ? `✅ ${option}` : option;
    });
    return [`<<<MCQ ${index + 1}>>>`, `Question: ${mcq.question}`, ...optionLines].join('\n');
  });

  return `[DOCX_NATIVE_MCQ_COUNT: ${mcqs.length}]\n\n${blocks.join('\n\n')}`;
};

export const getNativeMcqBlocks = (nativeText: string): string[] => {
  const text = String(nativeText || '').trim();
  if (!text || !MCQ_MARKER_PATTERN.test(text)) return [];

  return text
    .replace(/^\[DOCX_NATIVE_(?:MCQ|BATCH)_COUNT:\s*\d+\]\s*/i, '')
    .split(/(?=^<<<MCQ\s+\d+>>>$)/gm)
    .map((block) => block.trim())
    .filter(Boolean);
};

export const buildNativeMcqBatchText = (blocks: string[]): string =>
  `[DOCX_NATIVE_BATCH_COUNT: ${blocks.length}]\n\n${blocks.join('\n\n')}`;

export const splitNativeMcqTextIntoBatches = (nativeText: string, batchSize = 10): string[] => {
  const blocks = getNativeMcqBlocks(nativeText);
  if (blocks.length === 0) return [];

  const batches: string[] = [];
  for (let i = 0; i < blocks.length; i += batchSize) {
    batches.push(buildNativeMcqBatchText(blocks.slice(i, i + batchSize)));
  }
  return batches;
};
