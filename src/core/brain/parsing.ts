const extractJson = (text: string): string => {
  if (!text) return "";

  let cleanText = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanText = codeBlockMatch[1];
  }

  const start = cleanText.indexOf('{');
  const aStart = cleanText.indexOf('[');

  let actualStart = -1;
  if (start !== -1 && aStart !== -1) actualStart = Math.min(start, aStart);
  else actualStart = start !== -1 ? start : aStart;

  if (actualStart === -1) return cleanText.trim();

  const subText = cleanText.substring(actualStart);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastStructuralEnd = -1;

  for (let i = 0; i < subText.length; i++) {
    const char = subText[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      stack.push('}');
    } else if (char === '[') {
      stack.push(']');
    } else if (char === '}' || char === ']') {
      lastStructuralEnd = i;
      if (stack[stack.length - 1] === char) {
        stack.pop();
        if (stack.length === 0) {
          return subText.substring(0, i + 1);
        }
      }
    }
  }

  if (lastStructuralEnd !== -1) {
    let result = subText.substring(0, lastStructuralEnd + 1);
    if (inString) result += '"';
    result += [...stack].reverse().join('');

    try {
      JSON.parse(result);
      return result;
    } catch {
      const lastComma = result.lastIndexOf(',');
      if (lastComma !== -1) {
        let fixed = result.substring(0, lastComma);
        let rb = 0, rbr = 0;
        let inStr = false, esc = false;
        for (const c of fixed) {
          if (esc) { esc = false; continue; }
          if (c === '\\' && inStr) { esc = true; continue; }
          if (c === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (c === '{') rb++; else if (c === '}') rb--;
          if (c === '[') rbr++; else if (c === ']') rbr--;
        }
        while (rb > 0) { fixed += '}'; rb--; }
        while (rbr > 0) { fixed += ']'; rbr--; }
        return fixed;
      }
    }
    return result;
  }

  return subText.trim();
};

const findBalancedObjectEnd = (text: string, startIndex: number): number => {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
};

const isCompleteQuestionObject = (value: any): boolean =>
  Boolean(
    value &&
    typeof value.question === 'string' &&
    value.question.trim().length > 0 &&
    Array.isArray(value.options) &&
    value.options.length >= 2 &&
    typeof value.correctAnswer === 'string' &&
    value.correctAnswer.trim().length > 0
  );

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];
const OPTION_CORRECT_MARKER_PATTERN = /^[\s✓✔☑✅*•●■]+/;

const withOptionLabel = (letter: string, value: any): string => {
  const text = String(value ?? '').replace(OPTION_CORRECT_MARKER_PATTERN, '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return /^[A-E][\s.:)-]/i.test(text) ? text : `${letter}. ${text}`;
};

const hasOptionCorrectMarker = (value: any): boolean =>
  OPTION_CORRECT_MARKER_PATTERN.test(String(value ?? ''));

const getAliasValue = (source: any, keys: string[]): any => {
  if (!source || typeof source !== 'object') return undefined;
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
};

const getOptionTextValue = (option: any): any => {
  if (!option || typeof option !== 'object' || Array.isArray(option)) return option;
  return getAliasValue(option, ['text', 'content', 'value', 'option', 'answer', 'labelText']) ?? option;
};

const getOptionLetterValue = (option: any): string | undefined => {
  if (!option || typeof option !== 'object' || Array.isArray(option)) return undefined;
  const raw = getAliasValue(option, ['letter', 'key', 'label', 'id']);
  const letter = String(raw ?? '').trim().match(/^[A-E]/i)?.[0]?.toUpperCase();
  return letter;
};

const getOptionLetterFromAny = (option: any): string | undefined => {
  const explicitLetter = getOptionLetterValue(option);
  if (explicitLetter) return explicitLetter;
  return String(getOptionTextValue(option) ?? '')
    .trim()
    .replace(OPTION_CORRECT_MARKER_PATTERN, '')
    .match(/^[A-E][\s.:)-]/i)?.[0]?.charAt(0).toUpperCase();
};

const parseOptionsFromString = (value: string): { options: string[]; markedAnswer?: string } => {
  const text = String(value || '').trim();
  if (!text) return { options: [] };

  const collectMarkers = (pattern: RegExp) => {
    const markers: { letter: string; markerStart: number; contentStart: number; marked: boolean }[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      const letterIndex = raw.search(/[A-E]/i);
      if (letterIndex < 0) continue;
      const markerPrefix = raw.slice(0, letterIndex);
      const markerIndex = markerPrefix.search(/[✓✔☑✅*•●■]/);
      markers.push({
        letter: raw[letterIndex].toUpperCase(),
        markerStart: match.index + (markerIndex >= 0 ? markerIndex : letterIndex),
        contentStart: match.index + raw.length,
        marked: markerIndex >= 0,
      });
    }
    return markers;
  };

  let markers = collectMarkers(/(?:^|[\n\r;|]|\s{2,}|\s+)\s*[✓✔☑✅*•●■]?\s*\(?[A-E]\)?[\s.:)-]+/gi);
  if (markers.length < 2) {
    const inlineMarkers = collectMarkers(/(?:^|\s+)[✓✔☑✅*•●■]?\s*\(?[A-E]\)?[\s.:)-]+/gi);
    if (inlineMarkers.length >= 3) markers = inlineMarkers;
  }
  if (markers.length < 2) return { options: [] };

  const options = markers
    .map((marker, index) => {
      const end = markers[index + 1]?.markerStart ?? text.length;
      return withOptionLabel(marker.letter, text.slice(marker.contentStart, end));
    })
    .filter(Boolean);
  return { options, markedAnswer: markers.find(marker => marker.marked)?.letter };
};

const normalizeOptionPayload = (value: any): { options: string[]; markedAnswer?: string } => {
  if (Array.isArray(value)) {
    const labeledOptions = value.map((option, index) => ({
      letter: getOptionLetterFromAny(option),
      originalIndex: index,
      value: option,
      marked: hasOptionCorrectMarker(getOptionTextValue(option)),
    }));
    const shouldSortByLetter = labeledOptions.filter(item => item.letter).length >= 2;
    const orderedOptions = shouldSortByLetter
      ? labeledOptions.slice().sort((a, b) => {
        const aIndex = OPTION_LETTERS.indexOf(a.letter || '');
        const bIndex = OPTION_LETTERS.indexOf(b.letter || '');
        if (aIndex !== -1 || bIndex !== -1) {
          return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
        }
        return a.originalIndex - b.originalIndex;
      })
      : labeledOptions;

    return {
      options: orderedOptions
      .map((item, index) => withOptionLabel(
        item.letter || OPTION_LETTERS[index] || String(index + 1),
        getOptionTextValue(item.value)
      ))
      .filter(Boolean),
      markedAnswer: orderedOptions.find(item => item.marked)?.letter,
    };
  }

  if (typeof value === 'string') return parseOptionsFromString(value);

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, option]) => option !== null && option !== undefined && String(option).trim())
      .sort(([a], [b]) => {
        const aIndex = OPTION_LETTERS.indexOf(a.trim().toUpperCase());
        const bIndex = OPTION_LETTERS.indexOf(b.trim().toUpperCase());
        if (aIndex !== -1 || bIndex !== -1) {
          return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
        }
        return a.localeCompare(b, undefined, { numeric: true });
      });

    const markedAnswer = entries
      .map(([key, option], index) => ({
        letter: OPTION_LETTERS.includes(key.trim().toUpperCase()) ? key.trim().toUpperCase() : (OPTION_LETTERS[index] || String(index + 1)),
        marked: hasOptionCorrectMarker(option),
      }))
      .find(item => item.marked)?.letter;

    return {
      options: entries
      .map(([key, option], index) => {
        const letter = OPTION_LETTERS.includes(key.trim().toUpperCase())
          ? key.trim().toUpperCase()
          : (OPTION_LETTERS[index] || String(index + 1));
        return withOptionLabel(letter, option);
      })
      .filter(Boolean),
      markedAnswer,
    };
  }

  return { options: [] };
};

const normalizeCorrectAnswer = (value: any, options: string[]): string => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const raw = rawValue && typeof rawValue === 'object'
    ? getAliasValue(rawValue, ['letter', 'answer', 'correctAnswer', 'correct_answer', 'value', 'text'])
    : rawValue;
  if (typeof raw === 'number') {
    const answerIndex = raw >= 1 && raw <= options.length ? raw - 1 : raw;
    if (answerIndex >= 0 && answerIndex < options.length) return OPTION_LETTERS[answerIndex] || String(raw);
  }
  const text = String(raw ?? '').trim();
  if (!text) return '';

  const letter = text.match(/^[A-E](?:$|[\s.:)-])/i)?.[0]?.trim().charAt(0).toUpperCase();
  if (letter) return letter;

  const normalizedAnswer = text
    .replace(/^[A-E][\s.:)-]+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  const matchedIndex = options.findIndex(option => option
    .replace(/^[A-E][\s.:)-]+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase() === normalizedAnswer);

  return matchedIndex >= 0 ? OPTION_LETTERS[matchedIndex] : text;
};

export const cleanQuestionText = (text: string): string => {
  let cleaned = text.trim();
  
  // Trích xuất tiền tố câu hỏi (Question Prefix) - PHIÊN BẢN THÔNG MINH TỐI ĐA (Absolute Smartest)
  // 1. Chấp nhận các chữ đệm: "Câu số 1", "Câu thứ 1", "Question No 1", "Bài tập 1"
  // 2. Chấp nhận số phân cấp (Hierarchical): "Câu 1.1", "1.2.3."
  // 3. Xử lý Markdown, Tags, Ngoặc kép, và bảo vệ số thập phân an toàn tuyệt đối.
  const prefixRegex = /^(?:[\s*_*\[\(<]*)(?:(?:(?:c[âa]u(?:\s*(?:h[ỏo]i|s[ốo]|th[ứu]))?|question(?:\s*no\.?)?|q|b[àa]i(?:\s*t[ậa]p)?)\s*(?:\d{1,3}(?:\.\d{1,3})*[a-zA-Z]?|[IVX]{1,8})(?:\s*[([<][^\])>]+[\])>])?\s*[:.)-]?)|(?:(?:\d{1,3}(?:\.\d{1,3})*[a-zA-Z]?|[IVX]{1,8})(?:\s*[([<][^\])>]+[\])>])?\s*(?:[:)-]|\.(?=[\s*_*\]\)>]))))(?:[\s*_*\]\)>]*)\s*/i;
  
  const stripped = cleaned.replace(prefixRegex, '');
  
  // Fallback về chuỗi gốc nếu sau khi cắt chuỗi bị rỗng hoàn toàn
  return stripped.trim() || cleaned;
};

export const extractQuestionNumberFromText = (text: string = ''): number | null => {
  if (!text || typeof text !== 'string') return null;
  const match = text.match(/^\s*(?:[\s*_*\[\(<]*)(?:(?:c[âa]u(?:\s*(?:h[ỏo]i|s[ốo]|th[ứu]))?|question(?:\s*no\.?)?|q)\s*)?(\d{1,4})(?:\.\d{1,3})?[a-zA-Z]?\s*[:.)-]/i);
  return match ? Number(match[1]) : null;
};

const fillMissingQuestionFields = (q: any): any => {
  if (!q || typeof q !== 'object') return q;
  const questionValue = getAliasValue(q, ['question', 'stem', 'prompt', 'questionText', 'text']);
  if (typeof questionValue !== 'string') q.question = String(questionValue ?? '').trim();
  else q.question = questionValue.trim();
  const explicitQuestionNumber = Number(getAliasValue(q, ['questionNumber', 'questionNo', 'number', 'no', 'index']));
  const parsedQuestionNumber = Number.isFinite(explicitQuestionNumber)
    ? explicitQuestionNumber
    : extractQuestionNumberFromText(q.question);
  if (typeof parsedQuestionNumber === 'number' && Number.isFinite(parsedQuestionNumber) && parsedQuestionNumber > 0) {
    q.__questionNumber = Math.floor(parsedQuestionNumber);
  }
  
  // Tự động xoá tiền tố thừa (Câu 1:, v.v)
  q.question = cleanQuestionText(q.question);

  const optionsValue = getAliasValue(q, ['options', 'choices', 'answers', 'answerOptions']);
  const optionPayload = normalizeOptionPayload(optionsValue);
  q.options = optionPayload.options;

  const correctAnswerValue = getAliasValue(q, ['correctAnswer', 'answer', 'correct_answer', 'correctOption', 'correct', 'correctChoice']);
  q.correctAnswer = optionPayload.markedAnswer || normalizeCorrectAnswer(correctAnswerValue, q.options);
  if (!q.explanation || typeof q.explanation !== 'object') {
    const explanationValue = getAliasValue(q, ['explanation', 'rationale', 'reason', 'reasoning', 'explain']);
    q.explanation = { core: typeof explanationValue === 'string' ? explanationValue : '', evidence: '', analysis: '', warning: '' };
  } else {
    if (typeof q.explanation.core !== 'string') q.explanation.core = '';
    if (typeof q.explanation.evidence !== 'string') q.explanation.evidence = '';
    if (typeof q.explanation.analysis !== 'string') q.explanation.analysis = '';
    if (typeof q.explanation.warning !== 'string') q.explanation.warning = '';
  }
  if (typeof q.source !== 'string') q.source = '';
  if (typeof q.difficulty !== 'string') q.difficulty = 'Medium';
  if (typeof q.depthAnalysis !== 'string') q.depthAnalysis = '';
  return q;
};

const tryForceCloseObject = (subText: string): any | null => {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  const cleanText = subText;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if ((char === '}' || char === ']') && stack[stack.length - 1] === char) stack.pop();
  }

  let fixed = cleanText;
  if (inString) {
    fixed += '"';
  }
  fixed += [...stack].reverse().join('');
  try {
    const parsed = JSON.parse(fixed);
    return parsed;
  } catch {
    for (let len = cleanText.length - 1; len >= Math.max(0, cleanText.length - 200); len--) {
      let candidate = cleanText.substring(0, len);
      candidate = candidate.trim().replace(/,\s*$/, '');
      
      const repairStack: string[] = [];
      let isStr = false;
      let esc = false;
      for (let i = 0; i < candidate.length; i++) {
        const char = candidate[i];
        if (esc) { esc = false; continue; }
        if (char === '\\') { esc = true; continue; }
        if (char === '"') { isStr = !isStr; continue; }
        if (isStr) continue;
        if (char === '{') repairStack.push('}');
        else if (char === '[') repairStack.push(']');
        else if ((char === '}' || char === ']') && repairStack[repairStack.length - 1] === char) repairStack.pop();
      }
      let f = candidate;
      if (isStr) f += '"';
      f += [...repairStack].reverse().join('');
      try {
        const parsed = JSON.parse(f);
        return parsed;
      } catch {
        // continue stripping
      }
    }
  }
  return null;
};

export const salvageCompleteQuestionsFromJson = (text: string, allowTruncatedSalvage = true): any[] => {
  let jsonText = text || '';
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonText = codeBlockMatch[1];
  if (!jsonText) return [];

  const questionsKeyIndex = jsonText.indexOf('"questions"');
  const arrayStart = questionsKeyIndex >= 0 ? jsonText.indexOf('[', questionsKeyIndex) : jsonText.indexOf('[');
  if (arrayStart < 0) return [];

  const questions: any[] = [];
  let cursor = arrayStart + 1;
  while (cursor < jsonText.length) {
    const objectStart = jsonText.indexOf('{', cursor);
    if (objectStart < 0) break;
    const objectEnd = findBalancedObjectEnd(jsonText, objectStart);
    if (objectEnd < 0) {
      if (allowTruncatedSalvage) {
        const rawSub = jsonText.substring(objectStart);
        const parsed = tryForceCloseObject(rawSub);
        const normalized = fillMissingQuestionFields(parsed);
        if (isCompleteQuestionObject(normalized)) {
          questions.push(normalized);
        }
      }
      break;
    }

    try {
      const parsed = JSON.parse(jsonText.substring(objectStart, objectEnd + 1));
      const normalized = fillMissingQuestionFields(parsed);
      if (isCompleteQuestionObject(normalized)) questions.push(normalized);
    } catch {
      // Keep scanning; one malformed object should not discard previous complete MCQs.
    }
    cursor = objectEnd + 1;
  }

  return questions;
};

export interface StreamingQuestionBuffer {
  append: (chunk: string) => void;
  drain: () => any[];
}

const buildStreamingQuestionKey = (question: any): string => [
  question?.question || '',
  ...(Array.isArray(question?.options) ? question.options : []),
  question?.correctAnswer || '',
].map(value => String(value).replace(/\s+/g, ' ').trim().toLowerCase()).join('\u0001');

export const createStreamingQuestionBuffer = (): StreamingQuestionBuffer => {
  let buffer = '';
  let cursor = 0;
  let foundQuestionsArray = false;
  const emittedKeys = new Set<string>();

  const ensureQuestionsArray = () => {
    if (foundQuestionsArray) return true;
    const questionsKeyIndex = buffer.indexOf('"questions"');
    const arrayStart = questionsKeyIndex >= 0
      ? buffer.indexOf('[', questionsKeyIndex)
      : buffer.indexOf('[');
    if (arrayStart < 0) return false;
    cursor = arrayStart + 1;
    foundQuestionsArray = true;
    return true;
  };

  const append = (chunk: string) => {
    if (!chunk) return;
    buffer += chunk;
  };

  const drain = () => {
    if (!ensureQuestionsArray()) return [];
    const questions: any[] = [];

    while (cursor < buffer.length) {
      const objectStart = buffer.indexOf('{', cursor);
      if (objectStart < 0) break;

      const arrayEnd = buffer.indexOf(']', cursor);
      if (arrayEnd >= 0 && arrayEnd < objectStart) {
        cursor = arrayEnd + 1;
        break;
      }

      const objectEnd = findBalancedObjectEnd(buffer, objectStart);
      if (objectEnd < 0) break;

      try {
        const parsed = JSON.parse(buffer.substring(objectStart, objectEnd + 1));
        const normalized = fillMissingQuestionFields(parsed);
        if (isCompleteQuestionObject(normalized)) {
          const key = buildStreamingQuestionKey(normalized);
          if (key && !emittedKeys.has(key)) {
            emittedKeys.add(key);
            questions.push(normalized);
          }
        }
      } catch {
        // Streaming preview is best-effort. The final batch parser still handles repair/salvage.
      }

      cursor = objectEnd + 1;
    }

    return questions;
  };

  return { append, drain };
};

export const detectIfTextIsTruncated = (text: string): boolean => {
  if (!text) return true;

  // Clean the text from code blocks if present
  let cleanText = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanText = codeBlockMatch[1];
  }

  // Find where the questions array starts
  const questionsKeyIndex = cleanText.indexOf('"questions"');
  if (questionsKeyIndex < 0) {
    // If there is no "questions" key at all, it's either not JSON or extremely truncated/malformed
    return true;
  }

  const arrayStart = cleanText.indexOf('[', questionsKeyIndex);
  if (arrayStart < 0) {
    return true;
  }

  const subText = cleanText.substring(arrayStart);
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let arrayClosed = false;

  for (let i = 0; i < subText.length; i++) {
    const char = subText[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '[') {
      stack.push(']');
    } else if (char === '{') {
      stack.push('}');
    } else if (char === ']' || char === '}') {
      if (stack.length > 0 && stack[stack.length - 1] === char) {
        stack.pop();
        if (stack.length === 0) {
          // The outermost array '[' has been closed with matching ']'
          arrayClosed = true;
          break;
        }
      }
    }
  }

  // If the array is not closed, it is definitely truncated.
  return !arrayClosed;
};

interface ParseQuestionsOptions {
  allowEmpty?: boolean;
  enforceExpectedCount?: boolean;
}

export const parseQuestionsFromModelText = (
  text: string,
  batchIndex: number,
  expectedQuestions = 0,
  options: ParseQuestionsOptions = {}
): any[] => {
  let jsonStr = extractJson(text);
  if (!jsonStr) throw new Error("📄 AI không trả về dữ liệu đúng định dạng. Batch này sẽ được tự động chia nhỏ và thử lại.");
  const allowEmpty = options.allowEmpty ?? expectedQuestions === 0;
  const enforceExpectedCount = options.enforceExpectedCount ?? true;

  try {
    jsonStr = jsonStr.replace(/,\s*([\]\}])/g, '$1');

    const parsed = JSON.parse(jsonStr);
    const rawQuestions = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.questions) ? parsed.questions : []);
    const questions = rawQuestions
      .map(fillMissingQuestionFields)
      .filter(isCompleteQuestionObject);
    if (questions.length === 0) {
      if (!allowEmpty || expectedQuestions > 0) {
        console.info(`Empty AI result in batch ${batchIndex + 1}; splitting/retrying if the source is expected to contain MCQs.`);
        throw new Error("📄 AI đã xử lý nhưng không tìm thấy câu hỏi trắc nghiệm nào trong phần này. Batch sẽ được chia nhỏ để quét kỹ hơn.");
      }
      return questions;
    }
    if (enforceExpectedCount && expectedQuestions > 0 && questions.length < expectedQuestions) {
      (questions as any).__salvagedPartial = true;
      (questions as any).__missingCount = expectedQuestions - questions.length;
    }
    return questions;
  } catch (error) {
    const salvaged = salvageCompleteQuestionsFromJson(text);
    if (salvaged.length > 0) {
      const isTruncated = expectedQuestions > 0
        ? salvaged.length < expectedQuestions
        : detectIfTextIsTruncated(text);

      (salvaged as any).__salvagedPartial = isTruncated;
      (salvaged as any).__missingCount = enforceExpectedCount && expectedQuestions > 0 ? Math.max(0, expectedQuestions - salvaged.length) : 0;
      console.info(`🧩 Salvaged ${salvaged.length}${expectedQuestions > 0 ? `/${expectedQuestions}` : ''} complete questions from malformed JSON in batch ${batchIndex + 1}. Truncated = ${isTruncated}`);
      return salvaged;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('không tìm thấy câu hỏi trắc nghiệm')) {
      console.info("Empty AI result details:", message, "Raw string:", jsonStr.substring(0, 100) + "...");
      throw new Error(`📄 Dữ liệu AI ở Phần ${batchIndex + 1} bị lỗi cấu trúc (JSON). Hệ thống đang tự động chia nhỏ và thử lại...`);
    }
    console.debug("JSON Parse Error info:", error, "Raw string:", jsonStr.substring(0, 100) + "...");
    throw new Error(`📄 Dữ liệu AI ở Phần ${batchIndex + 1} bị lỗi cấu trúc (JSON). Hệ thống đang tự động chia nhỏ và thử lại...`);
  }
};

export const parseJsonFromModelText = <T = any>(text: string): T => JSON.parse(extractJson(text)) as T;
