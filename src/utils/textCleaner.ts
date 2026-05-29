/**
 * Safe, non-backtracking trailing options stripper.
 * Finds A., B., C. at the end of the text block and strips it,
 * avoiding backtracking performance issues.
 */
export const stripTrailingOptions = (text: string): string => {
  const clean = text.trim();
  const match = clean.match(/(?:^|\n|<br>|<br\/>|<br \/>|\t|[?:.]\s+)(A[.)]\s+[\s\S]+)$/i);
  if (!match) return text;
  
  const optionsPart = match[1];
  // Verify that optionsPart contains B. / B) and C. / C) in order
  const bMatch = optionsPart.match(/(?:\s+|^)(B[.)]\s+)/i);
  const cMatch = optionsPart.match(/(?:\s+|^)(C[.)]\s+)/i);
  
  if (bMatch && cMatch) {
    const bIndex = optionsPart.indexOf(bMatch[1]);
    const cIndex = optionsPart.indexOf(cMatch[1]);
    if (bIndex !== -1 && cIndex !== -1 && bIndex < cIndex) {
      const stripIndex = text.lastIndexOf(optionsPart);
      if (stripIndex !== -1) {
        return text.substring(0, stripIndex).trim();
      }
    }
  }
  return text;
};

/**
 * Strips prefix of question stems such as "Câu 1:", "Question No 2.", etc.
 */
export const cleanQuestionText = (text: string): string => {
  let cleaned = text.trim();
  
  // Smart prefix regex to strip question headers
  const prefixRegex = /^(?:[\s*_*\[\(<]*)(?:(?:(?:c[âa]u(?:\s*(?:h[ỏo]i|s[ốo]|th[ứu]))?|question(?:\s*no\.?)?|q|case|b[àa]i(?:\s*t[ậa]p)?)\s*(?:\d{1,3}(?:\.\d{1,3})*[a-zA-Z]?|[IVX]{1,8})(?:\s*[([<][^\])>]+[\])>])?\s*[:.)\-\u2013\u2014\u2212–—]?)|(?:(?:\d{1,3}(?:\.\d{1,3})*[a-zA-Z]?|[IVX]{1,8})(?:\s*[([<][^\])>]+[\])>])?\s*(?:[:)\-\u2013\u2014\u2212–—]|\.(?=[\s*_*\]\)>]))))(?:[\s*_*\]\)>]*)\s*/i;
  const stripped = cleaned.replace(prefixRegex, '');
  
  return stripped.trim() || cleaned;
};

/**
 * Standard sanitize function to remove control characters and clean whitespaces.
 */
export const sanitizeDocxText = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Core text cleaner used by both docxExport and appHelpers.
 */
export const cleanText = (text: string, type: 'question' | 'option'): string => {
  if (!text) return '';
  let cleaned = text.trim();
  if (type === 'question') {
    // Remove generated tags entirely for a seamless reading experience
    cleaned = cleaned.replace(/\[TÌNH HUỐNG\]\s*/gi, '');
    cleaned = cleaned.replace(/\[TÌNH HUỐNG LÂM SÀNG\]\s*/gi, '');
    cleaned = cleaned.replace(/\[CÂU HỎI\]\s*/gi, '');
    // Strip <<<MCQ ...>>> wrappers
    cleaned = cleaned.replace(/^\s*<<<[^>]+>>>\s*/i, '');
    
    // Clean question header prefix
    cleaned = cleanQuestionText(cleaned);
    
    // Strip trailing options safely
    cleaned = stripTrailingOptions(cleaned);
  } else {
    // Strip option prefix A., B., C.
    cleaned = cleaned.replace(/^[A-Ea-e][:.)]\s*/, '');
  }
  return cleaned.trim();
};
