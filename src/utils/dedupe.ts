import { MCQ } from '../types';

export interface DuplicateFieldScores {
  question: number;
  optionsBySlot: number;
  optionsAsSet: number;
  composite: number;
}

export interface DuplicateMatch<T = Partial<MCQ>> {
  action: 'unique' | 'review' | 'autoSkip';
  isDup: boolean;
  isAutoSkip: boolean;
  reason?: string;
  matchedWith?: string;
  matchedData?: T;
  score?: number;
  fieldScores?: DuplicateFieldScores;
}

type MCQLike = Partial<MCQ> & {
  question?: string;
  options?: string[];
  correctAnswer?: string;
};

const NEGATIVE_PATTERNS = [
  /\bkhong\b/,
  /\bkhong\s+phai\b/,
  /\bngoai\s+tru\b/,
  /\btru\b/,
  /\bnot\b/,
  /\bexcept\b/,
];

const htmlEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const decodeEntities = (text: string): string =>
  text.replace(/&(#(\d+)|#x([\da-f]+)|[a-z]+);/gi, (match, _body, dec, hex) => {
    if (dec) return String.fromCharCode(Number(dec));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return htmlEntities[match.slice(1, -1).toLowerCase()] ?? ' ';
  });

const stripVietnameseMarks = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd');

export const normalizeMCQField = (text: string = ''): string => {
  const withoutHtml = decodeEntities(String(text))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]]*?\]/g, ' ');

  return stripVietnameseMarks(withoutHtml)
    .toLowerCase()
    .replace(/(?:^|\s)(?:cau|question|bai)\s*(?:so\s*)?\d+\s*[.:)\]-]?\s*/g, ' ')
    .replace(/^\s*(?:\(?[a-e]\)?|[0-9]{1,2})\s*[.:)\]-]\s*/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeAnswer = (text: string = ''): string => {
  const normalized = normalizeMCQField(text);
  const letter = String(text).trim().match(/^[A-E]/i)?.[0]?.toLowerCase();
  return letter || normalized;
};

const getOptions = (mcq: MCQLike): string[] => {
  const options = Array.isArray(mcq.options) ? mcq.options.slice(0, 5) : [];
  while (options.length < 5) options.push('');
  return options;
};

export const buildMCQFingerprint = (mcq: MCQLike): string => {
  const fields = [mcq.question || '', ...getOptions(mcq)];
  return fields.map(normalizeMCQField).join('|');
};

const tokenize = (text: string): string[] =>
  normalizeMCQField(text)
    .split(' ')
    .filter(token => token.length > 1);

const levenshteinSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return 1 - previous[b.length] / Math.max(a.length, b.length);
};

const ratioFromTokens = (tokensA: string[], tokensB: string[]): number => {
  const a = tokensA.join(' ');
  const b = tokensB.join(' ');
  return levenshteinSimilarity(a, b);
};

const tokenSortRatio = (a: string, b: string): number => {
  const tokensA = tokenize(a).sort();
  const tokensB = tokenize(b).sort();
  if (tokensA.length === 0 || tokensB.length === 0) return tokensA.length === tokensB.length ? 1 : 0;
  return ratioFromTokens(tokensA, tokensB);
};

const tokenSetRatio = (a: string, b: string): number => {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return setA.size === setB.size ? 1 : 0;

  const common: string[] = [];
  const diffA: string[] = [];
  const diffB: string[] = [];

  setA.forEach(token => {
    if (setB.has(token)) common.push(token);
    else diffA.push(token);
  });
  setB.forEach(token => {
    if (!setA.has(token)) diffB.push(token);
  });

  if (common.length === 0) return 0;
  if (diffA.length === 0 || diffB.length === 0) return 1;

  const commonText = common.sort().join(' ');
  const combinedA = [...common, ...diffA].sort().join(' ');
  const combinedB = [...common, ...diffB].sort().join(' ');
  return Math.max(
    levenshteinSimilarity(combinedA, combinedB),
    levenshteinSimilarity(commonText, combinedA),
    levenshteinSimilarity(commonText, combinedB)
  );
};

const tokenRatio = (a: string, b: string): number =>
  Math.max(tokenSortRatio(a, b), tokenSetRatio(a, b));

const hasNegativeLogic = (text: string): boolean => {
  const normalized = normalizeMCQField(text);
  return NEGATIVE_PATTERNS.some(pattern => pattern.test(normalized));
};

const tailAfterSharedStemScore = (a: string, b: string): number | null => {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const maxLen = Math.max(tokensA.length, tokensB.length);
  if (maxLen < 18) return null;

  let prefix = 0;
  const minLen = Math.min(tokensA.length, tokensB.length);
  while (prefix < minLen && tokensA[prefix] === tokensB[prefix]) prefix++;

  if (prefix < 10 || prefix / maxLen < 0.45) return null;

  const tailA = tokensA.slice(prefix).join(' ');
  const tailB = tokensB.slice(prefix).join(' ');
  if (!tailA && !tailB) return 1;
  if (!tailA || !tailB) return 0.45;
  return tokenRatio(tailA, tailB);
};

const scoreQuestion = (a: string = '', b: string = ''): number => {
  if (hasNegativeLogic(a) !== hasNegativeLogic(b)) return 0;

  const base = tokenRatio(a, b);
  const tailScore = tailAfterSharedStemScore(a, b);
  if (tailScore === null) return base;

  return Math.min(base, 0.55 + tailScore * 0.45);
};

const scoreOptionsBySlot = (a: string[], b: string[]): number => {
  const optionsA = a.slice(0, 5);
  const optionsB = b.slice(0, 5);
  while (optionsA.length < 5) optionsA.push('');
  while (optionsB.length < 5) optionsB.push('');

  const scores = optionsA.map((option, index) => {
    if (!option && !optionsB[index]) return 1;
    if (!option || !optionsB[index]) return 0;
    return tokenRatio(option, optionsB[index]);
  });

  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
};

const scoreOptionsAsSet = (a: string[], b: string[]): number => {
  const remaining = b.map(option => ({ option, used: false }));
  const scores = a.slice(0, 5).map(option => {
    if (!option) return remaining.some(item => !item.used && !item.option) ? 1 : 0;

    let bestIndex = -1;
    let bestScore = 0;
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].used) continue;
      const score = tokenRatio(option, remaining[i].option);
      if (score > bestScore) {
        bestIndex = i;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) remaining[bestIndex].used = true;
    return bestScore;
  });

  while (scores.length < 5) scores.push(0);
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
};

const answersConflict = (a: MCQLike, b: MCQLike): boolean => {
  if (!a.correctAnswer || !b.correctAnswer) return false;
  const answerA = normalizeAnswer(a.correctAnswer);
  const answerB = normalizeAnswer(b.correctAnswer);
  return Boolean(answerA && answerB && answerA !== answerB);
};

export const scoreMCQDuplicate = (a: MCQLike, b: MCQLike): DuplicateFieldScores => {
  const question = scoreQuestion(a.question || '', b.question || '');
  const optionsBySlot = scoreOptionsBySlot(getOptions(a), getOptions(b));
  const optionsAsSet = scoreOptionsAsSet(getOptions(a), getOptions(b));
  const optionsScore = Math.max(optionsBySlot, optionsAsSet * 0.96);
  const composite = question * 0.55 + optionsBySlot * 0.3 + optionsAsSet * 0.15;

  return {
    question,
    optionsBySlot,
    optionsAsSet,
    composite: Math.min(composite, question * 0.75 + optionsScore * 0.25),
  };
};

const formatPercent = (score: number): number => Math.round(score * 100);

export const findDuplicate = <T extends MCQLike>(candidate: MCQLike, existingQuestions: T[]): DuplicateMatch<T> => {
  const candidateFingerprint = buildMCQFingerprint(candidate);

  for (const existing of existingQuestions) {
    const exactFingerprint = candidateFingerprint === buildMCQFingerprint(existing);
    const fieldScores = scoreMCQDuplicate(candidate, existing);
    const optionsScore = Math.max(fieldScores.optionsBySlot, fieldScores.optionsAsSet);
    const answerConflict = answersConflict(candidate, existing);

    if (exactFingerprint) {
      return {
        action: 'autoSkip',
        isDup: true,
        isAutoSkip: true,
        reason: 'Trùng toàn bộ Question + A/B/C/D/E (100%)',
        matchedWith: (existing.question || '').substring(0, 60),
        matchedData: existing,
        score: 1,
        fieldScores: { question: 1, optionsBySlot: 1, optionsAsSet: 1, composite: 1 },
      };
    }

    if (
      fieldScores.composite >= 0.985 &&
      fieldScores.question >= 0.97 &&
      fieldScores.optionsBySlot >= 0.985 &&
      fieldScores.optionsAsSet >= 0.985 &&
      !answerConflict
    ) {
      return {
        action: 'autoSkip',
        isDup: true,
        isAutoSkip: true,
        reason: `Trùng gần như tuyệt đối Q+A-E (~${formatPercent(fieldScores.composite)}%)`,
        matchedWith: (existing.question || '').substring(0, 60),
        matchedData: existing,
        score: fieldScores.composite,
        fieldScores,
      };
    }

    if (
      fieldScores.composite >= 0.92 &&
      fieldScores.question >= 0.88 &&
      optionsScore >= 0.84
    ) {
      return {
        action: 'review',
        isDup: true,
        isAutoSkip: false,
        reason: `Question + A-E tương đồng cao (~${formatPercent(fieldScores.composite)}%; Q ${formatPercent(fieldScores.question)}%, A-E ${formatPercent(optionsScore)}%)`,
        matchedWith: (existing.question || '').substring(0, 60),
        matchedData: existing,
        score: fieldScores.composite,
        fieldScores,
      };
    }
  }

  return {
    action: 'unique',
    isDup: false,
    isAutoSkip: false,
  };
};
