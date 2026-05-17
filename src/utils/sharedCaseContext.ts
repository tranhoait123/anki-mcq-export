export interface SharedCaseContext {
  startQuestion: number;
  endQuestion: number;
  stem: string;
  confidence: 'explicit';
}

const QUESTION_MARKER = /(?:^|\s)(?:(?:câu|cau|question|q)\s*(?:số\s*)?)?(\d+)\s*[:.)-]/gi;
const RANGE_JOINER = String.raw`(?:[-–—,;]|và|va|and|&|đến|den|tới|toi|to|through)`;
const SHARED_CASE_MARKER = new RegExp(
  String.raw`(?:tình\s*huống(?:\s*lâm\s*sàng)?|tinh\s*huong(?:\s*lam\s*sang)?|dữ\s*kiện|du\s*kien|bệnh\s*cảnh|benh\s*canh|(?:clinical\s+)?vignette|case|item\s*set)[\s\S]{0,180}?` +
  String.raw`(?:(?:dùng|dung|sử\s*dụng|su\s*dung|áp\s*dụng|ap\s*dung|cho|for|covers?|applies?\s+to)\s+)?` +
  String.raw`(?:các\s+|the\s+)?(?:câu|cau|questions?|items?|q)?\s*` +
  String.raw`(\d+(?:(?:\s*${RANGE_JOINER}\s*)+\d+)+)`,
  'gi'
);
const SHARED_CASE_PREFIX = '[TÌNH HUỐNG]';
const SHARED_CASE_QUESTION_PREFIX = '[CÂU HỎI]';
const SHARED_CASE_SECTION_MARKER = /\[\s*(tình\s*huống|tinh\s*huong|câu\s*hỏi|cau\s*hoi)\s*\]/gi;
const SHARED_CASE_INTRO_PATTERN = new RegExp(
  String.raw`^(?:tình\s*huống(?:\s*lâm\s*sàng)?|tinh\s*huong(?:\s*lam\s*sang)?|dữ\s*kiện|du\s*kien|bệnh\s*cảnh|benh\s*canh|(?:clinical\s+)?vignette|case|item\s*set)` +
  String.raw`[\s\S]{0,160}?\b\d+(?:(?:\s*${RANGE_JOINER}\s*)+\d+)+\s*[:.)-]?\s*`,
  'i'
);
const STOP_WORDS = new Set([
  'cho',
  'cau',
  'hoi',
  'dung',
  'dungcho',
  'sau',
  'the',
  'and',
  'for',
  'questions',
  'question',
  'items',
  'item',
  'tinh',
  'huong',
  'lam',
  'sang',
]);

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const extractQuestionNumber = (value: string): number | null => {
  QUESTION_MARKER.lastIndex = 0;
  const match = QUESTION_MARKER.exec(value || '');
  return match ? Number(match[1]) : null;
};

const getQuestionLine = (block: string): string => {
  const match = block.match(/^Question:\s*(.*)$/im);
  return match?.[1]?.trim() || '';
};

const findQuestionMarkerIndex = (text: string, questionNumber: number, fromIndex: number): number => {
  QUESTION_MARKER.lastIndex = Math.max(0, fromIndex);
  let match: RegExpExecArray | null;
  while ((match = QUESTION_MARKER.exec(text)) !== null) {
    if (Number(match[1]) === questionNumber) return match.index + (match[0].match(/^\s/) ? 1 : 0);
  }
  return -1;
};

const getDeclaredQuestionRange = (value: string): { startQuestion: number; endQuestion: number } | null => {
  const numbers = (value.match(/\d+/g) || [])
    .map(Number)
    .filter(number => Number.isFinite(number));
  if (numbers.length < 2) return null;
  return {
    startQuestion: Math.min(...numbers),
    endQuestion: Math.max(...numbers),
  };
};

/** Strip Vietnamese diacritics + combining marks for fuzzy comparison */
const stripDiacritics = (text: string): string =>
  text.normalize('NFD').replace(/[\u0300-\u036f\u0301-\u0309\u0323]/g, '').replace(/[đĐ]/g, 'd');

const stripSharedCaseIntro = (value: string): string =>
  normalizeWhitespace(value.replace(SHARED_CASE_INTRO_PATTERN, ''));

const stripSharedCaseSectionMarkers = (value: string): string =>
  value.replace(SHARED_CASE_SECTION_MARKER, ' ');

const normalizeForComparison = (value: string): string =>
  stripDiacritics(stripSharedCaseSectionMarkers(value).toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getMeaningfulStem = (value: string): string =>
  normalizeForComparison(stripSharedCaseIntro(value));

const tokenizeForOverlap = (value: string): string[] =>
  getMeaningfulStem(value)
    .split(' ')
    .filter(token => (token.length >= 3 || /^\d+$/.test(token)) && !STOP_WORDS.has(token));

const tokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(tokenizeForOverlap(left));
  const rightTokens = new Set(tokenizeForOverlap(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let shared = 0;
  leftTokens.forEach(token => {
    if (rightTokens.has(token)) shared++;
  });
  return shared / Math.min(leftTokens.size, rightTokens.size);
};

const looksLikeOcrArtifact = (value: string): boolean =>
  /\b\w*\d+\w*\b/.test(stripDiacritics(value)) || /\b(?:sir|gid|ngot|d6ng|kh6|g8y|teorong|ph[ée]di)\b/i.test(value);

const countVietnameseSignals = (value: string): number =>
  (value.match(/[ăâêôơưđáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/gi) || []).length;

const chooseBestCaseStem = (stems: string[]): string => {
  const candidates = stems
    .map(stem => normalizeWhitespace(stem))
    .filter(stem => stem.length >= 20);
  if (candidates.length === 0) return '';

  return candidates
    .map((stem, index) => ({
      stem,
      score: (
        Math.min(tokenizeForOverlap(stem).length, 80) +
        countVietnameseSignals(stem) * 2 +
        index * 3 -
        (looksLikeOcrArtifact(stem) ? 25 : 0)
      ),
    }))
    .sort((left, right) => right.score - left.score)[0].stem;
};

export const normalizeSharedCaseQuestion = (question: string): string => {
  const source = String(question || '');
  SHARED_CASE_SECTION_MARKER.lastIndex = 0;

  const sections: Array<{ kind: 'case' | 'question'; text: string }> = [];
  let activeKind: 'case' | 'question' | null = null;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = SHARED_CASE_SECTION_MARKER.exec(source)) !== null) {
    const text = normalizeWhitespace(source.slice(cursor, match.index));
    if (activeKind && text) sections.push({ kind: activeKind, text });
    activeKind = stripDiacritics(match[1]).toLowerCase().includes('cau') ? 'question' : 'case';
    cursor = match.index + match[0].length;
  }

  const trailingText = normalizeWhitespace(source.slice(cursor));
  if (activeKind && trailingText) sections.push({ kind: activeKind, text: trailingText });

  const caseStems = sections.filter(section => section.kind === 'case').map(section => section.text);
  const questionPayloads = sections.filter(section => section.kind === 'question').map(section => section.text);
  if (caseStems.length === 0 || questionPayloads.length === 0) return normalizeWhitespace(source);

  const stem = chooseBestCaseStem(caseStems);
  const questionPayload = questionPayloads[questionPayloads.length - 1];
  if (!stem || !questionPayload) return normalizeWhitespace(source);

  return formatSharedCaseQuestion(questionPayload, stem);
};

const hasStemAlready = (question: string, stem: string): boolean => {
  const normalizedQuestion = normalizeForComparison(question);
  const normalizedStem = getMeaningfulStem(stem);
  if (!normalizedStem) return true;
  const prefixLength = Math.min(80, normalizedStem.length);
  if (prefixLength >= 24 && normalizedQuestion.includes(normalizedStem.slice(0, prefixLength))) {
    return true;
  }
  const overlap = tokenOverlap(stem, question);
  const stemTokenCount = tokenizeForOverlap(stem).length;
  return stemTokenCount >= 6 && overlap >= (stemTokenCount <= 10 ? 0.7 : 0.52);
};

export const hasSharedCaseStem = hasStemAlready;

export const extractSharedCaseContexts = (text: string): SharedCaseContext[] => {
  const source = String(text || '');
  const contexts: SharedCaseContext[] = [];
  SHARED_CASE_MARKER.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SHARED_CASE_MARKER.exec(source)) !== null) {
    const range = getDeclaredQuestionRange(match[1]);
    if (!range) continue;
    const { startQuestion, endQuestion } = range;

    let firstQuestionIndex = -1;
    for (let qNum = startQuestion; qNum <= endQuestion; qNum++) {
      firstQuestionIndex = findQuestionMarkerIndex(source, qNum, match.index + match[0].length);
      if (firstQuestionIndex >= 0) break;
    }
    if (firstQuestionIndex < 0) continue;

    const stem = normalizeWhitespace(source.slice(match.index, firstQuestionIndex));
    if (stem.length < 30) continue;
    contexts.push({ startQuestion, endQuestion, stem, confidence: 'explicit' });
  }

  return contexts;
};

export const getSharedCaseContextForQuestion = (question: string, contexts: SharedCaseContext[]): SharedCaseContext | null => {
  const questionNumber = extractQuestionNumber(question);
  if (!questionNumber) return null;
  return contexts.find(item => questionNumber >= item.startQuestion && questionNumber <= item.endQuestion) || null;
};

export const formatSharedCaseQuestion = (question: string, stem: string): string =>
  `${SHARED_CASE_PREFIX}\n${stem}\n\n${SHARED_CASE_QUESTION_PREFIX}\n${question}`.replace(/[ \t]+\n/g, '\n').trim();

export const applySharedCaseContextToQuestion = (question: string, contexts: SharedCaseContext[]): string => {
  const normalizedQuestion = normalizeSharedCaseQuestion(question);
  const context = getSharedCaseContextForQuestion(normalizedQuestion, contexts);
  if (!context || hasStemAlready(normalizedQuestion, context.stem)) return normalizedQuestion;

  return formatSharedCaseQuestion(normalizedQuestion, context.stem);
};

export const applySharedCaseContextToBlocks = (sourceText: string, blocks: string[]): string[] => {
  const contexts = extractSharedCaseContexts(sourceText);
  if (contexts.length === 0) return blocks;

  return blocks.map((block) => {
    const question = getQuestionLine(block);
    const expandedQuestion = applySharedCaseContextToQuestion(question, contexts);
    if (expandedQuestion === question) return block;
    return block.replace(/^Question:\s*.*$/im, `Question: ${expandedQuestion}`);
  });
};
