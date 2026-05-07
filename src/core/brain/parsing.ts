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
        for (const c of fixed) {
          if (c === '{') rb++; else if (c === '}') rb--;
          if (c === '[') rbr++; else if (c === ']') rbr--;
        }
        while (rb > 0) { fixed += '}'; rb--; }
        while (rbr > 0) { fixed += ']'; rbr--; }
        return fixed + ']';
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
    Array.isArray(value.options) &&
    value.options.length >= 2 &&
    typeof value.correctAnswer === 'string'
  );

const fillMissingQuestionFields = (q: any): any => {
  if (!q || typeof q !== 'object') return q;
  if (!q.explanation || typeof q.explanation !== 'object') {
    q.explanation = { core: '', evidence: '', analysis: '', warning: '' };
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
        if (parsed && isCompleteQuestionObject(parsed)) {
          questions.push(fillMissingQuestionFields(parsed));
        }
      }
      break;
    }

    try {
      const parsed = JSON.parse(jsonText.substring(objectStart, objectEnd + 1));
      if (isCompleteQuestionObject(parsed)) questions.push(fillMissingQuestionFields(parsed));
    } catch {
      // Keep scanning; one malformed object should not discard previous complete MCQs.
    }
    cursor = objectEnd + 1;
  }

  return questions;
};

interface ParseQuestionsOptions {
  allowEmpty?: boolean;
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

  try {
    jsonStr = jsonStr.replace(/,\s*([\]\}])/g, '$1');

    const parsed = JSON.parse(jsonStr);
    const questions = Array.isArray(parsed) ? parsed : (parsed?.questions || []);
    questions.forEach(fillMissingQuestionFields);
    if (questions.length === 0) {
      if (!allowEmpty || expectedQuestions > 0) {
        throw new Error("📄 AI đã xử lý nhưng không tìm thấy câu hỏi trắc nghiệm nào trong phần này. Batch sẽ được chia nhỏ để quét kỹ hơn.");
      }
      return questions;
    }
    if (expectedQuestions > 0 && questions.length < expectedQuestions) {
      (questions as any).__salvagedPartial = true;
      (questions as any).__missingCount = expectedQuestions - questions.length;
    }
    return questions;
  } catch (error) {
    const salvaged = salvageCompleteQuestionsFromJson(text);
    if (salvaged.length > 0) {
      (salvaged as any).__salvagedPartial = true;
      (salvaged as any).__missingCount = expectedQuestions > 0 ? Math.max(0, expectedQuestions - salvaged.length) : 0;
      console.warn(`🧩 Salvaged ${salvaged.length}${expectedQuestions > 0 ? `/${expectedQuestions}` : ''} complete questions from malformed JSON in batch ${batchIndex + 1}.`);
      return salvaged;
    }
    console.error("JSON Parse Error info:", error, "Raw string:", jsonStr.substring(0, 100) + "...");
    throw new Error(`📄 Dữ liệu AI ở Phần ${batchIndex + 1} bị lỗi cấu trúc (JSON). Hệ thống đang tự động chia nhỏ và thử lại...`);
  }
};

export const parseJsonFromModelText = <T = any>(text: string): T => JSON.parse(extractJson(text)) as T;
