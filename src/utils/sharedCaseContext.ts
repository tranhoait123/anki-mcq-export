export interface SharedCaseContext {
  startQuestion: number;
  endQuestion: number;
  stem: string;
  confidence: 'explicit';
}

const QUESTION_MARKER = /(?:^|\s)(?:câu|cau|question|q)\s*(?:số\s*)?(\d+)\s*[:.)-]/gi;
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

const hasStemAlready = (question: string, stem: string): boolean => {
  const normalizedQuestion = normalizeWhitespace(question).toLowerCase();
  const normalizedStem = normalizeWhitespace(stem).toLowerCase();
  if (!normalizedStem) return true;
  return normalizedQuestion.includes(normalizedStem.slice(0, Math.min(80, normalizedStem.length)));
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

    const firstQuestionIndex = findQuestionMarkerIndex(source, startQuestion, match.index + match[0].length);
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
  const context = getSharedCaseContextForQuestion(question, contexts);
  if (!context || hasStemAlready(question, context.stem)) return question;

  return formatSharedCaseQuestion(question, context.stem);
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
