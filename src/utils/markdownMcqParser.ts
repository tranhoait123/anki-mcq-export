/**
 * Markdown MCQ Parser
 *
 * Parses markdown text containing MCQ questions and converts them into the same
 * structured format produced by `buildNativeMcqText` / `buildQuestionMarkerStructuredText`
 * in `docxNative.ts`.
 *
 * Output format:
 *   [MARKDOWN_MCQ_COUNT: N]
 *
 *   <<<MCQ 1>>>
 *   Question: ...
 *   A. ...
 *   ...
 *   [✅ A. ... — if answer is marked]
 *
 * Supports:
 *   - Vietnamese labels (Câu, Cau, Bài tập, …)
 *   - English labels (Question, Q, Case, …)
 *   - Markdown headers with question labels (## Câu 1, ### Q2, …)
 *   - Pure numbered items (1. …) when followed by A/B/C/D options
 *   - Multiple option formats: A. / A) / A: / (A) / - A. / * B.
 *   - Answer detection via ✅/✓/✔, bold, blockquote, or explicit answer lines
 *   - Shared clinical vignettes / case contexts
 */

import {
  extractSharedCaseContexts,
  applySharedCaseContextToQuestion,
} from './sharedCaseContext';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface MarkdownMcqParseResult {
  /** Text with <<<MCQ N>>> markers and [MARKDOWN_MCQ_COUNT: N] prefix */
  structuredText: string;
  /** Number of MCQ blocks detected */
  mcqCount: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface RawMcq {
  questionLines: string[];
  options: ParsedOption[];
  correctAnswer: string;
}

interface ParsedOption {
  letter: string;
  text: string;
  isAnswer: boolean;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/**
 * Question label at the start of a line (optionally preceded by markdown header
 * markers). Captures:
 *   - Vietnamese: Câu, Cau, Câu số, Câu hỏi, Bài tập
 *   - English: Question, Q, Case
 */
const QUESTION_LABEL_RE = new RegExp(
  '^(?:#{1,6}\\s+)?' +                                              // optional markdown header
  '(?:' +
    '(?:câu\\s*(?:hỏi|hoi|số|so)?|cau\\s*(?:hoi|so)?)' +           // Vietnamese
    '|(?:bài\\s*tập|bai\\s*tap)' +                                  // Bài tập
    '|question' +                                                    // English full
    '|case' +                                                        // Case N
    '|q(?=\\s*\\d)' +                                                // Q followed by digit
  ')' +
  '\\s*\\d+\\s*(?:[:.)-]|\\b|$)',                                    // number + optional separator
  'i',
);

/**
 * Pure numbered line: `1. ` or `1)` or `[1]` at start (used only when look-ahead confirms
 * options nearby).
 */
const PURE_NUMBERED_RE = /^\[?(\d+)\]?[\s.:)\-/]+\s*/;

/** Markdown header line with a question label inside. */
const MD_HEADER_QUESTION_RE = new RegExp(
  '^#{1,6}\\s+' +
  '(?:' +
    '(?:câu|cau|câu\\s*(?:hỏi|hoi|số|so)?|cau\\s*(?:hoi|so)?)' +
    '|(?:bài\\s*tập|bai\\s*tap)' +
    '|question|case|q(?=\\s*\\d)' +
  ')' +
  '\\s*\\d+',
  'i',
);

/**
 * Option line – captures the letter (A–E) and the option body text.
 * Handles formats: `A. text`, `A) text`, `A: text`, `(A) text`,
 * `- A. text`, `* B. text`
 */
const OPTION_LINE_RE = /^(?:[-*]\s+)?(?:\(([A-Ea-e])\)|([A-Ea-e]))\s*[.:)]\s+(.+)/;

/**
 * Answer detection — explicit answer line after options.
 * Matches: Đáp án: A, Đáp án đúng: B, Answer: C, Correct answer: D
 */
const ANSWER_KEY_RE = new RegExp(
  '^(?:[>]\\s*)?' +                               // optional blockquote
  '(?:đáp\\s*án(?:\\s*đúng)?|dap\\s*an(?:\\s*dung)?' +
  '|answer|correct\\s*answer)' +
  '\\s*[:：.\\-]?\\s*' +
  '(?:\\(?([A-Ea-e])\\)?)',                        // captured letter
  'i',
);

/** Check-mark symbols used to flag the correct option inline. */
const ANSWER_SYMBOL_RE = /^[✅✓✔]/;

/** Bold wrapper patterns (`**text**` or `__text__`). */
const BOLD_RE = /^\*\*(.+)\*\*$|^__(.+)__$/;

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];

// ---------------------------------------------------------------------------
// Helpers – markdown stripping
// ---------------------------------------------------------------------------

/** Remove common markdown formatting characters from a string. */
const stripMarkdown = (text: string): string =>
  text
    .replace(/^#{1,6}\s+/, '')           // headers
    .replace(/\*\*(.+?)\*\*/g, '$1')     // bold **
    .replace(/__(.+?)__/g, '$1')         // bold __
    .replace(/\*(.+?)\*/g, '$1')         // italic *
    .replace(/_(.+?)_/g, '$1')           // italic _
    .replace(/~~(.+?)~~/g, '$1')         // strikethrough
    .replace(/`(.+?)`/g, '$1')           // inline code
    .replace(/^>\s*/, '')                // blockquote
    .replace(/^[-*+]\s+/, '')            // unordered list prefix
    .trim();

/** Normalize whitespace (collapse runs, trim). */
const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Line-level helpers
// ---------------------------------------------------------------------------

/** Try to parse a line as an option. Returns null if it doesn't match. */
const parseOptionLine = (raw: string): ParsedOption | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Check for answer symbol prefix (✅, ✓, ✔)
  let isAnswer = ANSWER_SYMBOL_RE.test(trimmed);
  let line = isAnswer ? trimmed.replace(ANSWER_SYMBOL_RE, '').trim() : trimmed;

  // Strip leading markdown list markers (- / *)
  line = line.replace(/^[-*]\s+/, '');

  const match = line.match(OPTION_LINE_RE) || raw.trim().match(OPTION_LINE_RE);
  if (!match) return null;

  const letter = (match[1] || match[2]).toUpperCase();
  let text = stripMarkdown(match[3]);

  // Detect bold-wrapped option text as an answer marker
  const boldMatch = match[3].trim().match(BOLD_RE);
  if (boldMatch) {
    isAnswer = true;
    text = (boldMatch[1] || boldMatch[2]).trim();
  }

  return { letter, text, isAnswer };
};

/** Check whether the next few lines after a given index contain options (at least 2 distinct option letters). */
const hasOptionsAhead = (lines: string[], startIndex: number, maxLookahead = 8): boolean => {
  const foundLetters = new Set<string>();
  for (let i = startIndex; i < Math.min(startIndex + maxLookahead, lines.length); i++) {
    const opt = parseOptionLine(lines[i]);
    if (opt) foundLetters.add(opt.letter);
    // Relaxed requirement: at least 2 distinct options (e.g. A and B) to detect MCQ structure
    if (foundLetters.size >= 2) {
      return true;
    }
  }
  return false;
};

/** Detect if a line is a question boundary. */
const isQuestionBoundary = (line: string, allLines: string[], lineIndex: number): boolean => {
  const cleanLine = stripMarkdown(line);
  const trimmed = cleanLine.trim();
  if (!trimmed) return false;

  // 1. Explicit question labels (checked on clean line)
  if (QUESTION_LABEL_RE.test(trimmed)) return true;

  // 1b. Check raw line with markdown headers (e.g. ## Q001)
  if (MD_HEADER_QUESTION_RE.test(line.trim())) return true;

  // 2. Pure numbered (1. text) — only if options A-D follow within a few lines
  if (PURE_NUMBERED_RE.test(trimmed)) {
    return hasOptionsAhead(allLines, lineIndex + 1);
  }

  return false;
};

/** Try to extract an answer letter from an answer-key line. */
const extractAnswerFromLine = (line: string): string => {
  const cleanLine = stripMarkdown(line);
  const match = cleanLine.match(ANSWER_KEY_RE);
  return match ? (match[1] || '').toUpperCase() : '';
};

// ---------------------------------------------------------------------------
// Answer key section detection (trailing answer key block)
// ---------------------------------------------------------------------------

const ANSWER_KEY_SECTION_RE = /^(?:đáp\s*án|dap\s*an|bảng\s*đáp\s*án|bang\s*dap\s*an|answer\s*key|answers?|key)\b/i;
const ANSWER_KEY_PAIR_RE = /(?:^|[\s,;|]+)(?:câu|cau|question|q)?\s*(\d{1,3})\s*(?:[.:)\-]\s*)?([A-Ea-e])(?:\b|$)/gi;

/** Extract a trailing answer-key map: question number → letter. */
const extractTrailingAnswerKeyMap = (lines: string[]): Map<number, string> => {
  const answers = new Map<number, string>();
  let inSection = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const pairs = extractAnswerKeyPairs(line);
    const isSectionHeader = ANSWER_KEY_SECTION_RE.test(line);

    if (isSectionHeader || (pairs.size >= 3 && !QUESTION_LABEL_RE.test(line))) {
      pairs.forEach((letter, num) => answers.set(num, letter));
      inSection = true;
      continue;
    }

    if (!inSection) continue;
    if (pairs.size > 0) {
      pairs.forEach((letter, num) => answers.set(num, letter));
      continue;
    }

    // Exit section when we encounter normal content again
    inSection = false;
  }

  return answers;
};

const extractAnswerKeyPairs = (text: string): Map<number, string> => {
  const map = new Map<number, string>();
  ANSWER_KEY_PAIR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANSWER_KEY_PAIR_RE.exec(text)) !== null) {
    const num = Number(m[1]);
    const letter = m[2].toUpperCase();
    if (num > 0 && OPTION_LETTERS.includes(letter)) {
      map.set(num, letter);
    }
  }
  return map;
};

// ---------------------------------------------------------------------------
// Question number extraction
// ---------------------------------------------------------------------------

const extractQuestionNumber = (text: string): number | null => {
  const m =
    text.match(/(?:câu|cau|question|q)\s*(?:số\s*)?(\d{1,3})/i) ||
    text.match(/(\d{1,3})\s*[.:)-]/);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

export const parseMarkdownMcqs = (markdownText: string): MarkdownMcqParseResult => {
  if (!markdownText || !markdownText.trim()) {
    return { structuredText: '', mcqCount: 0 };
  }

  // Normalize line endings
  const lines = markdownText.replace(/\r\n/g, '\n').split('\n');

  // ----- Pass 1: Identify question boundary indices -----
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isQuestionBoundary(lines[i], lines, i)) {
      boundaries.push(i);
    }
  }

  // If the first boundary is not 0 (or no boundaries found yet), but there are options
  // ahead of 0, treat the very start of the file (index 0) as the first question boundary.
  const firstBoundary = boundaries[0] ?? lines.length;
  if (firstBoundary > 0 && hasOptionsAhead(lines, 0, Math.min(firstBoundary, 15))) {
    boundaries.unshift(0);
  }

  if (boundaries.length === 0) {
    return { structuredText: '', mcqCount: 0 };
  }

  // ----- Pass 2: Collect shared case contexts from the full text -----
  const fullText = lines.map(l => stripMarkdown(l)).join('\n');
  const sharedCaseContexts = extractSharedCaseContexts(fullText);

  // ----- Pass 3: Extract trailing answer key map -----
  const trailingAnswerKeyMap = extractTrailingAnswerKeyMap(lines);

  // ----- Pass 4: Build raw MCQs -----
  const rawMcqs: RawMcq[] = [];

  for (let bi = 0; bi < boundaries.length; bi++) {
    const startLine = boundaries[bi];
    const endLine = bi + 1 < boundaries.length ? boundaries[bi + 1] : lines.length;

    const questionLines: string[] = [];
    const options: ParsedOption[] = [];
    let correctAnswer = '';
    let collectingOptions = false;

    for (let li = startLine; li < endLine; li++) {
      const raw = lines[li];
      const trimmed = raw.trim();

      // Skip empty lines
      if (!trimmed) continue;

      // Try parsing as an option
      const opt = parseOptionLine(trimmed);
      if (opt) {
        collectingOptions = true;
        options.push(opt);
        if (opt.isAnswer) correctAnswer = opt.letter;
        continue;
      }

      // Try detecting an answer-key line (Đáp án: A, Answer: B, etc.)
      const answerLetter = extractAnswerFromLine(trimmed);
      if (answerLetter && options.length >= 2) {
        correctAnswer = correctAnswer || answerLetter;
        continue;
      }

      // If we already started collecting options and this line is neither
      // an option nor an answer key, treat it as a continuation of the
      // last option (multi-line option text) — unless it looks like
      // explanation/noise that we should skip.
      if (collectingOptions && options.length > 0) {
        // Check if this is just explanation text (skip it)
        const isExplanation = /^(?:giải\s*thích|giai\s*thich|explanation|lời\s*giải|loi\s*giai|rationale)/i.test(trimmed);
        if (!isExplanation) {
          // Append to last option as continuation
          const lastOpt = options[options.length - 1];
          lastOpt.text = `${lastOpt.text} ${stripMarkdown(trimmed)}`;
        }
        continue;
      }

      // Otherwise, it's part of the question text
      questionLines.push(stripMarkdown(trimmed));
    }

    // Only include if we have a question and at least 2 options (relaxed from 4
    // since some partial MCQs may still be valid, but the DOCX parser uses >= 4)
    if (questionLines.length > 0 && options.length >= 2) {
      rawMcqs.push({ questionLines, options, correctAnswer });
    }
  }

  if (rawMcqs.length === 0) {
    return { structuredText: '', mcqCount: 0 };
  }

  // ----- Pass 5: Apply shared case contexts and trailing answer keys -----
  const mcqBlocks: string[] = rawMcqs.map((raw, index) => {
    // Build question text
    let questionText = normalizeWhitespace(raw.questionLines.join(' '));

    // Apply shared clinical vignette / case context
    questionText = applySharedCaseContextToQuestion(questionText, sharedCaseContexts);

    // Determine correct answer
    let answer = raw.correctAnswer;
    if (!answer && trailingAnswerKeyMap.size > 0) {
      const qNum = extractQuestionNumber(questionText);
      if (qNum !== null) {
        answer = trailingAnswerKeyMap.get(qNum) || '';
      }
    }

    // Build option lines, marking the correct answer with ✅
    const optionLines = raw.options.map((opt) => {
      const line = `${opt.letter}. ${normalizeWhitespace(opt.text)}`;
      return opt.letter === answer ? `✅ ${line}` : line;
    });

    return [
      `<<<MCQ ${index + 1}>>>`,
      `Question: ${questionText}`,
      ...optionLines,
    ].join('\n');
  });

  const structuredText = `[MARKDOWN_MCQ_COUNT: ${mcqBlocks.length}]\n\n${mcqBlocks.join('\n\n')}`;

  return {
    structuredText,
    mcqCount: mcqBlocks.length,
  };
};
