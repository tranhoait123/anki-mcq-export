export interface SharedCaseContext {
  startQuestion: number;
  endQuestion: number;
  stem: string;
}

const QUESTION_MARKER = /(?:^|\s)(?:câu|cau|question|q)\s*(?:số\s*)?(\d+)\s*[:.)-]/gi;
const SHARED_CASE_MARKER = /(?:tình\s*huống\s*lâm\s*sàng|tinh\s*huong\s*lam\s*sang|dữ\s*kiện|du\s*kien|bệnh\s*cảnh|benh\s*canh|case)[\s\S]{0,120}?(?:dùng|dung|sử\s*dụng|su\s*dung|áp\s*dụng|ap\s*dung|cho)\s+(?:các\s+)?câu\s+(\d+)\s*(?:[-–—]|đến|den|tới|toi)\s*(\d+)/gi;

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

const hasStemAlready = (question: string, stem: string): boolean => {
  const normalizedQuestion = normalizeWhitespace(question).toLowerCase();
  const normalizedStem = normalizeWhitespace(stem).toLowerCase();
  if (!normalizedStem) return true;
  return normalizedQuestion.includes(normalizedStem.slice(0, Math.min(80, normalizedStem.length)));
};

export const extractSharedCaseContexts = (text: string): SharedCaseContext[] => {
  const source = String(text || '');
  const contexts: SharedCaseContext[] = [];
  SHARED_CASE_MARKER.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = SHARED_CASE_MARKER.exec(source)) !== null) {
    const startQuestion = Number(match[1]);
    const endQuestion = Number(match[2]);
    if (!Number.isFinite(startQuestion) || !Number.isFinite(endQuestion) || endQuestion < startQuestion) continue;

    const firstQuestionIndex = findQuestionMarkerIndex(source, startQuestion, match.index + match[0].length);
    if (firstQuestionIndex < 0) continue;

    const stem = normalizeWhitespace(source.slice(match.index, firstQuestionIndex));
    if (stem.length < 30) continue;
    contexts.push({ startQuestion, endQuestion, stem });
  }

  return contexts;
};

export const applySharedCaseContextToQuestion = (question: string, contexts: SharedCaseContext[]): string => {
  const questionNumber = extractQuestionNumber(question);
  if (!questionNumber) return question;

  const context = contexts.find(item => questionNumber >= item.startQuestion && questionNumber <= item.endQuestion);
  if (!context || hasStemAlready(question, context.stem)) return question;

  return `${context.stem} ${question}`.replace(/\s+/g, ' ').trim();
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
