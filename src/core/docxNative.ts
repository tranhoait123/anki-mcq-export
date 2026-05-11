import JSZip from 'jszip';
import { applySharedCaseContextToQuestion, extractSharedCaseContexts } from '../utils/sharedCaseContext';

export interface DocxParagraph {
  text: string;
  highlighted: boolean;
  highlightRanges?: TextRange[];
  styleId?: string;
  numbering?: {
    numId: string;
    ilvl: string;
    numFmt?: string;
    lvlText?: string;
  };
}

export interface NativeDocxMcq {
  question: string;
  options: string[];
  correctAnswer: string;
}

export interface DocxEmbeddedImage {
  name: string;
  mimeType: string;
  base64: string;
  index: number;
  relationshipId: string;
}

export interface NativeDocxParseResult {
  paragraphs: DocxParagraph[];
  mcqs: NativeDocxMcq[];
  embeddedImages: DocxEmbeddedImage[];
  unsupportedImageCount: number;
  structuredBlockCount: number;
  nativeText: string;
  structuredText: string;
  plainText: string;
}

const OPTION_PATTERN = /^([A-E])\s*[\.:)]\s*(.+)$/i;
const PAREN_OPTION_PATTERN = /^\(?([A-E])\)?\s*[\.:)-]\s*(.+)$/i;
const QUESTION_PATTERN = /^(?:câu|cau|question|q)\s*\d+\s*[:.)-]/i;
const MCQ_MARKER_PATTERN = /^<<<MCQ\s+\d+>>>$/m;
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const LETTER_NUMBER_FORMATS = new Set(['upperLetter', 'lowerLetter']);
const ANSWER_SYMBOL_PATTERN = /^(?:[✓✔☑✅*•●■]\s*)+/;
const ANSWER_KEY_LINE_PATTERN = /^(?:đáp\s*án|dap\s*an|đáp\s*án\s*đúng|dap\s*an\s*dung|answer|correct\s*answer|key)\s*(?:đúng|dung)?\s*[:：.\-]?\s*(?:\(?([A-E])\)?|([A-E])\s*[\.:)-])/i;
const ANSWER_KEY_SECTION_PATTERN = /^(?:đáp\s*án|dap\s*an|bảng\s*đáp\s*án|bang\s*dap\s*an|answer\s*key|answers?|key)\b/i;
const ANSWER_KEY_PAIR_PATTERN = /(?:^|[\s,;|]+)(?:câu|cau|question|q)?\s*(\d{1,3})\s*(?:[\.:)\-]\s*)?([A-E])(?:\b|$)/gi;
const SUPPORTED_IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

type NumberingDefinitions = Record<string, Record<string, { numFmt?: string; lvlText?: string }>>;
type TextRange = { start: number; end: number };
type TextSegment = { text: string; highlighted: boolean };

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

const extractSharedCaseContextsFromParagraphs = (paragraphs: DocxParagraph[]) =>
  extractSharedCaseContexts(paragraphs.map(paragraph => normalizeParagraphText(paragraph.text)).filter(Boolean).join('\n'));

const repairQuestionMarker = (text: string): string =>
  text.replace(/^(?:âu|au)(\s*\d+\s*[:.)-])/i, (_match: string, suffix: string) => `Câu${suffix}`);

const hasHighlight = (paragraphXml: string): boolean =>
  /<w:highlight\b(?![^>]*w:val="none")[^>]*\/?>/i.test(paragraphXml);

const hasRedAnswerColor = (paragraphXml: string): boolean =>
  /<w:color\b[^>]*w:val="(?:FF0000|E60000|C00000|C00|RED)"[^>]*\/?>/i.test(paragraphXml);

const hasShadingAnswerFill = (paragraphXml: string): boolean => {
  const fills = [...paragraphXml.matchAll(/<w:shd\b[^>]*w:fill="([^"]+)"[^>]*\/?>/gi)].map((match) => match[1].toUpperCase());
  return fills.some((fill) => fill && !['AUTO', 'FFFFFF', 'FFFFFF00', '000000'].includes(fill));
};

const hasAnswerSymbol = (text: string): boolean => ANSWER_SYMBOL_PATTERN.test(text.trim());

const textHasAnswerMark = (text: string, ranges: TextRange[] = []): boolean =>
  hasAnswerSymbol(text) || ranges.length > 0;

const rangesOverlap = (ranges: TextRange[] = [], start: number, end: number): boolean =>
  ranges.some((range) => Math.max(range.start, start) < Math.min(range.end, end));

const buildLineFromSegments = (segments: TextSegment[]): { text: string; highlighted: boolean; highlightRanges: TextRange[] } | null => {
  const chars: string[] = [];
  const charHighlights: boolean[] = [];

  for (const segment of segments) {
    for (const rawChar of segment.text.replace(/\u00a0/g, ' ')) {
      const char = /[ \t]/.test(rawChar) ? ' ' : rawChar;
      if (char === ' ' && chars[chars.length - 1] === ' ') {
        const lastIndex = charHighlights.length - 1;
        if (lastIndex >= 0) charHighlights[lastIndex] = charHighlights[lastIndex] || segment.highlighted;
        continue;
      }
      chars.push(char);
      charHighlights.push(segment.highlighted);
    }
  }

  while (chars.length > 0 && chars[0] === ' ') {
    chars.shift();
    charHighlights.shift();
  }
  while (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop();
    charHighlights.pop();
  }

  const text = repairQuestionMarker(chars.join('').trim());
  if (!text) return null;

  const highlightRanges: TextRange[] = [];
  let rangeStart = -1;
  charHighlights.forEach((highlighted, index) => {
    if (highlighted && rangeStart < 0) rangeStart = index;
    if (!highlighted && rangeStart >= 0) {
      highlightRanges.push({ start: rangeStart, end: index });
      rangeStart = -1;
    }
  });
  if (rangeStart >= 0) highlightRanges.push({ start: rangeStart, end: charHighlights.length });

  return {
    text,
    highlighted: textHasAnswerMark(text, highlightRanges),
    highlightRanges,
  };
};

const extractParagraphLines = (paragraphXml: string): { text: string; highlighted: boolean; highlightRanges: TextRange[] }[] => {
  const lines: { text: string; highlighted: boolean; highlightRanges: TextRange[] }[] = [];
  let segments: TextSegment[] = [];
  const flush = () => {
    const line = buildLineFromSegments(segments);
    if (line) lines.push(line);
    segments = [];
  };

  for (const runMatch of paragraphXml.matchAll(/<w:r\b[\s\S]*?<\/w:r>/gi)) {
    const runXml = runMatch[0];
    const highlighted = hasHighlight(runXml) || hasRedAnswerColor(runXml) || hasShadingAnswerFill(runXml);
    for (const tokenMatch of runXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/gi)) {
      const [token, text] = tokenMatch;
      if (text !== undefined) {
        segments.push({ text: decodeXml(text), highlighted });
        continue;
      }
      if (/^<w:tab\b/i.test(token)) {
        segments.push({ text: ' ', highlighted: false });
        continue;
      }
      flush();
    }
  }

  flush();
  return lines;
};

const extractWordValue = (xml: string, tag: string): string | undefined => {
  const match = xml.match(new RegExp(`<w:${tag}\\b[^>]*w:val="([^"]+)"`, 'i'));
  return match?.[1];
};

const extractStyleId = (paragraphXml: string): string | undefined => extractWordValue(paragraphXml, 'pStyle');

const extractNumbering = (paragraphXml: string): DocxParagraph['numbering'] => {
  const numPr = paragraphXml.match(/<w:numPr\b[\s\S]*?<\/w:numPr>/i)?.[0];
  if (!numPr) return undefined;

  const numId = extractWordValue(numPr, 'numId');
  if (!numId) return undefined;

  return {
    numId,
    ilvl: extractWordValue(numPr, 'ilvl') || '0',
  };
};

const getXmlAttr = (xml: string, attr: string): string | undefined => {
  const match = xml.match(new RegExp(`\\b${attr}="([^"]+)"`, 'i'));
  return match?.[1];
};

const parseNumberingDefinitions = (numberingXml = ''): NumberingDefinitions => {
  const abstractDefs: NumberingDefinitions = {};
  const numToAbstract: Record<string, string> = {};

  for (const abstractMatch of numberingXml.matchAll(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/gi)) {
    const abstractXml = abstractMatch[0];
    const abstractId = getXmlAttr(abstractXml, 'w:abstractNumId');
    if (!abstractId) continue;

    abstractDefs[abstractId] = {};
    for (const lvlMatch of abstractXml.matchAll(/<w:lvl\b[\s\S]*?<\/w:lvl>/gi)) {
      const lvlXml = lvlMatch[0];
      const ilvl = getXmlAttr(lvlXml, 'w:ilvl') || '0';
      abstractDefs[abstractId][ilvl] = {
        numFmt: extractWordValue(lvlXml, 'numFmt'),
        lvlText: extractWordValue(lvlXml, 'lvlText'),
      };
    }
  }

  for (const numMatch of numberingXml.matchAll(/<w:num\b[\s\S]*?<\/w:num>/gi)) {
    const numXml = numMatch[0];
    const numId = getXmlAttr(numXml, 'w:numId');
    const abstractId = extractWordValue(numXml, 'abstractNumId');
    if (numId && abstractId) numToAbstract[numId] = abstractId;
  }

  const defs: NumberingDefinitions = {};
  Object.entries(numToAbstract).forEach(([numId, abstractId]) => {
    defs[numId] = abstractDefs[abstractId] || {};
  });
  return defs;
};

const parseStyleNumbering = (stylesXml: string, numberingDefs: NumberingDefinitions): Record<string, DocxParagraph['numbering']> => {
  const styleNumbering: Record<string, DocxParagraph['numbering']> = {};
  for (const styleMatch of stylesXml.matchAll(/<w:style\b[\s\S]*?<\/w:style>/gi)) {
    const styleXml = styleMatch[0];
    const styleId = getXmlAttr(styleXml, 'w:styleId');
    if (!styleId) continue;
    const numbering = extractNumbering(styleXml);
    if (!numbering) continue;
    const definition = numberingDefs[numbering.numId]?.[numbering.ilvl] || {};
    styleNumbering[styleId] = { ...numbering, ...definition };
  }
  return styleNumbering;
};

const enrichNumbering = (
  numbering: DocxParagraph['numbering'],
  numberingDefs: NumberingDefinitions,
): DocxParagraph['numbering'] => {
  if (!numbering) return undefined;
  const definition = numberingDefs[numbering.numId]?.[numbering.ilvl] || {};
  return { ...numbering, ...definition };
};

const cleanOptionText = (text: string): string => text.replace(ANSWER_SYMBOL_PATTERN, '').trim();

const getOptionMatch = (text: string): RegExpMatchArray | null => text.match(OPTION_PATTERN) || text.match(PAREN_OPTION_PATTERN);

const getAnswerKeyLetter = (text: string): string => {
  const cleanText = normalizeParagraphText(text);
  const match = cleanText.match(ANSWER_KEY_LINE_PATTERN);
  return (match?.[1] || match?.[2] || '').toUpperCase();
};

const extractQuestionNumber = (text: string): number | null => {
  const cleanText = normalizeParagraphText(text);
  const match = cleanText.match(/(?:câu|cau|question|q)\s*(?:số\s*)?(\d{1,3})/i) || cleanText.match(/^(\d{1,3})\s*[\.:)-]/);
  return match ? Number(match[1]) : null;
};

const extractAnswerKeyPairs = (text: string): Map<number, string> => {
  const answers = new Map<number, string>();
  ANSWER_KEY_PAIR_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANSWER_KEY_PAIR_PATTERN.exec(text)) !== null) {
    const questionNumber = Number(match[1]);
    const answer = match[2]?.toUpperCase();
    if (questionNumber > 0 && answer && OPTION_LETTERS.includes(answer)) answers.set(questionNumber, answer);
  }
  return answers;
};

const extractTrailingAnswerKeyMap = (paragraphs: DocxParagraph[]): Map<number, string> => {
  const answers = new Map<number, string>();
  let inAnswerKeySection = false;

  for (const paragraph of paragraphs) {
    const text = normalizeParagraphText(paragraph.text);
    if (!text) continue;

    const pairs = extractAnswerKeyPairs(text);
    const isSectionHeader = ANSWER_KEY_SECTION_PATTERN.test(text);

    if (isSectionHeader || (pairs.size >= 3 && !QUESTION_PATTERN.test(text))) {
      pairs.forEach((answer, questionNumber) => answers.set(questionNumber, answer));
      inAnswerKeySection = true;
      continue;
    }

    if (!inAnswerKeySection) continue;
    if (pairs.size > 0) {
      pairs.forEach((answer, questionNumber) => answers.set(questionNumber, answer));
      continue;
    }

    if (QUESTION_PATTERN.test(text) || getOptionMatch(cleanOptionText(text))) {
      inAnswerKeySection = false;
    } else {
      inAnswerKeySection = false;
    }
  }

  return answers;
};

const applyTrailingAnswerKeyMap = (mcqs: NativeDocxMcq[], answerKeyMap: Map<number, string>): NativeDocxMcq[] => {
  if (answerKeyMap.size === 0) return mcqs;
  return mcqs.map((mcq, index) => {
    if (mcq.correctAnswer) return mcq;
    const questionNumber = extractQuestionNumber(mcq.question) ?? index + 1;
    const answer = answerKeyMap.get(questionNumber);
    if (!answer || !mcq.options.some(option => option.match(/^([A-E])\s*[\.:)]/i)?.[1]?.toUpperCase() === answer)) return mcq;
    return { ...mcq, correctAnswer: answer };
  });
};

const parseInlineOptions = (
  text: string,
  highlighted: boolean,
  highlightRanges: TextRange[] = [],
): { letter: string; text: string; highlighted: boolean }[] => {
  const sourceText = text.trim();
  if (!sourceText) return [];

  const markers: { letter: string; markerStart: number; contentStart: number; symbolMarked: boolean }[] = [];
  const pattern = /(?:^|[\n\r;|]|\s{2,}|\s+)([✓✔☑✅*•●■]\s*)?\(?([A-E])\)?\s*[\.:)-]\s+/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sourceText)) !== null) {
    markers.push({
      letter: match[2].toUpperCase(),
      markerStart: match.index + match[0].search(/[✓✔☑✅*•●■]|\(?[A-E]\)?/i),
      contentStart: match.index + match[0].length,
      symbolMarked: Boolean(match[1]),
    });
  }

  if (markers.length < 2) return [];

  return markers
    .map((marker, index) => {
      const end = markers[index + 1]?.markerStart ?? sourceText.length;
      return {
        letter: marker.letter,
        text: cleanOptionText(sourceText.slice(marker.contentStart, end)),
        highlighted: marker.symbolMarked || (highlighted && highlightRanges.length === 0) || rangesOverlap(highlightRanges, marker.markerStart, end),
      };
    })
    .filter((option) => option.text);
};

const isLetterNumbering = (numbering?: DocxParagraph['numbering']): boolean =>
  Boolean(numbering && (!numbering.numFmt || LETTER_NUMBER_FORMATS.has(numbering.numFmt)));

export const parseDocxDocumentXml = (documentXml: string, numberingXml = '', stylesXml = ''): NativeDocxParseResult => {
  const numberingDefs = parseNumberingDefinitions(numberingXml);
  const styleNumbering = parseStyleNumbering(stylesXml, numberingDefs);
  const paragraphs = (documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [])
    .flatMap((paragraphXml) => {
      const styleId = extractStyleId(paragraphXml);
      const directNumbering = enrichNumbering(extractNumbering(paragraphXml), numberingDefs);
      const numbering = directNumbering || (styleId ? styleNumbering[styleId] : undefined);
      return extractParagraphLines(paragraphXml).map((line, lineIndex) => ({
        ...line,
        styleId,
        numbering: lineIndex === 0 ? numbering : undefined,
      }));
    })
    .filter((paragraph) => paragraph.text.length > 0);

  const mcqs = parseMcqsFromParagraphs(paragraphs);
  const questionMarkerText = buildQuestionMarkerStructuredText(paragraphs);
  const questionMarkerBlocks = getNativeMcqBlocks(questionMarkerText);
  const nativeText = buildNativeMcqText(mcqs);
  const structuredText = questionMarkerBlocks.length > mcqs.length ? questionMarkerText : nativeText;
  return {
    paragraphs,
    mcqs,
    embeddedImages: [],
    unsupportedImageCount: 0,
    structuredBlockCount: Math.max(mcqs.length, questionMarkerBlocks.length),
    nativeText,
    structuredText,
    plainText: paragraphs.map((paragraph) => paragraph.text).join('\n').trim(),
  };
};

export const parseNativeDocxMcqs = async (arrayBuffer: ArrayBuffer): Promise<NativeDocxParseResult> => {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) throw new Error('Không tìm thấy word/document.xml trong file DOCX');
  const [numberingXml, stylesXml, relsXml] = await Promise.all([
    zip.file('word/numbering.xml')?.async('string') || Promise.resolve(''),
    zip.file('word/styles.xml')?.async('string') || Promise.resolve(''),
    zip.file('word/_rels/document.xml.rels')?.async('string') || Promise.resolve(''),
  ]);
  const result = parseDocxDocumentXml(documentXml, numberingXml, stylesXml);
  const { embeddedImages, unsupportedImageCount } = await extractDocxEmbeddedImages(zip, documentXml, relsXml);
  return { ...result, embeddedImages, unsupportedImageCount };
};

const getImageMimeType = (target: string): string | undefined => {
  const extension = target.split('.').pop()?.toLowerCase() || '';
  return SUPPORTED_IMAGE_MIME_TYPES[extension];
};

const resolveDocxTarget = (target: string): string => {
  const cleanTarget = target.replace(/^\/+/, '');
  return cleanTarget.startsWith('word/') ? cleanTarget : `word/${cleanTarget}`;
};

export const parseDocxImageRelationships = (relsXml: string): Record<string, string> => {
  const relationships: Record<string, string> = {};
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Type="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/?>/gi)) {
    const [, id, type, target] = match;
    if (type.endsWith('/image')) relationships[id] = resolveDocxTarget(target);
  }
  return relationships;
};

export const getDocxDrawingEmbedIds = (documentXml: string): string[] =>
  [...documentXml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/gi)]
    .map((match) => match[0].match(/r:embed="([^"]+)"/i)?.[1])
    .filter((id): id is string => Boolean(id));

export const extractDocxEmbeddedImages = async (
  zip: JSZip,
  documentXml: string,
  relsXml: string,
): Promise<{ embeddedImages: DocxEmbeddedImage[]; unsupportedImageCount: number }> => {
  const rels = parseDocxImageRelationships(relsXml);
  const embeddedImages: DocxEmbeddedImage[] = [];
  let unsupportedImageCount = 0;
  const seen = new Map<string, number>();

  for (const relationshipId of getDocxDrawingEmbedIds(documentXml)) {
    const target = rels[relationshipId];
    if (!target) continue;
    const mimeType = getImageMimeType(target);
    const file = zip.file(target);
    if (!mimeType || !file) {
      unsupportedImageCount++;
      continue;
    }
    const duplicateCount = seen.get(target) || 0;
    seen.set(target, duplicateCount + 1);
    const baseName = target.split('/').pop() || `image-${embeddedImages.length + 1}`;
    embeddedImages.push({
      name: duplicateCount > 0 ? `${baseName}#${duplicateCount + 1}` : baseName,
      mimeType,
      base64: await file.async('base64'),
      index: embeddedImages.length + 1,
      relationshipId,
    });
  }

  return { embeddedImages, unsupportedImageCount };
};

export const parseMcqsFromParagraphs = (paragraphs: DocxParagraph[]): NativeDocxMcq[] => {
  const mcqs: NativeDocxMcq[] = [];
  const sharedCaseContexts = extractSharedCaseContextsFromParagraphs(paragraphs);
  const trailingAnswerKeyMap = extractTrailingAnswerKeyMap(paragraphs);
  let questionLines: string[] = [];
  let options: { letter: string; text: string; highlighted: boolean }[] = [];

  const flush = () => {
    const cleanQuestion = applySharedCaseContextToQuestion(
      questionLines.join(' ').replace(/\s+/g, ' ').trim(),
      sharedCaseContexts
    );
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

    const optionCandidateText = cleanOptionText(text);
    const optionMatch = getOptionMatch(optionCandidateText);
    const inlineOptions = parseInlineOptions(text, paragraph.highlighted, paragraph.highlightRanges);
    const answerKeyLetter = getAnswerKeyLetter(text);

    if (QUESTION_PATTERN.test(text) && (questionLines.length > 0 || options.length > 0)) {
      flush();
      questionLines.push(text);
      continue;
    }

    if (!optionMatch && paragraph.numbering && options.length >= 4) {
      flush();
      questionLines.push(text);
      continue;
    }

    if (inlineOptions.length >= 2) {
      if (questionLines.length === 0) continue;
      if (options.length + inlineOptions.length > OPTION_LETTERS.length) flush();
      options.push(...inlineOptions.slice(0, OPTION_LETTERS.length - options.length));
      continue;
    }

    if (answerKeyLetter && options.length >= 2) {
      const matchedOption = options.find((option) => option.letter === answerKeyLetter);
      if (matchedOption) matchedOption.highlighted = true;
      continue;
    }

    const numberedOptionLetter =
      !optionMatch && paragraph.numbering && isLetterNumbering(paragraph.numbering) && questionLines.length > 0 && options.length < OPTION_LETTERS.length
        ? OPTION_LETTERS[options.length]
        : '';

    if (optionMatch || numberedOptionLetter) {
      if (options.length >= 5) flush();
      if (questionLines.length === 0) {
        continue;
      }
      options.push({
        letter: optionMatch ? optionMatch[1].toUpperCase() : numberedOptionLetter,
        text: cleanOptionText(optionMatch ? optionMatch[2] : text),
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
  return applyTrailingAnswerKeyMap(mcqs, trailingAnswerKeyMap);
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

export const buildQuestionMarkerStructuredText = (paragraphs: DocxParagraph[]): string => {
  const blocks: string[][] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length > 0) blocks.push(current);
    current = [];
  };

  for (const paragraph of paragraphs) {
    const text = normalizeParagraphText(paragraph.text);
    if (!text) continue;

    if (QUESTION_PATTERN.test(text)) {
      flush();
      current.push(text);
      continue;
    }

    if (current.length > 0) current.push(text);
  }
  flush();

  if (blocks.length === 0) return '';

  const structuredBlocks = blocks.map((block, index) => {
    const [question, ...rest] = block;
    const lines = [`<<<MCQ ${index + 1}>>>`, `Question: ${question}`];
    if (rest.length > 0) {
      lines.push('Answer/Notes:');
      lines.push(...rest);
    }
    return lines.join('\n');
  });

  return `[DOCX_NATIVE_MCQ_COUNT: ${structuredBlocks.length}]\n\n${structuredBlocks.join('\n\n')}`;
};

export const getNativeMcqBlocks = (nativeText: string): string[] => {
  const text = String(nativeText || '').trim();
  if (!text || !MCQ_MARKER_PATTERN.test(text)) return [];

  return text
    .replace(/^\[(?:DOCX_NATIVE|PDF_TEXT)_(?:MCQ|BATCH)_COUNT:\s*\d+\]\s*/i, '')
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
