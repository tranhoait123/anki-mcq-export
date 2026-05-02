import { MCQ } from '../types';

export interface DuplicateFieldScores {
  question: number;
  questionTokenSort: number;
  questionPartial: number;
  optionsBySlot: number;
  optionsAsSet: number;
  composite: number;
  intentMismatch: boolean;
  intentReviewRequired: boolean;
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

type QuestionIntentKey = 'normal' | 'negative' | 'falseChoice' | 'contraindication';

interface QuestionIntentProfile {
  key: QuestionIntentKey;
  marker: 'none' | 'negative' | 'false' | 'exception' | 'contraindication';
  isRisky: boolean;
}

const LENGTH_BUCKET_SIZE = 40;
const GROUPING_MIN_CANDIDATES = 90;
const GROUPING_NEIGHBOR_RADIUS = 2;
const GROUPING_FALLBACK_MIN = 8;

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

const partialRatio = (a: string, b: string): number => {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) return tokensA.length === tokensB.length ? 1 : 0;

  const shorter = tokensA.length <= tokensB.length ? tokensA : tokensB;
  const longer = tokensA.length <= tokensB.length ? tokensB : tokensA;
  const shorterText = shorter.join(' ');
  const longerText = longer.join(' ');
  if (shorterText === longerText || longerText.includes(shorterText)) return 1;

  let best = 0;
  const minWindow = Math.max(1, shorter.length - 1);
  const maxWindow = Math.min(longer.length, shorter.length + 1);
  for (let windowSize = minWindow; windowSize <= maxWindow; windowSize++) {
    for (let start = 0; start <= longer.length - windowSize; start++) {
      best = Math.max(best, ratioFromTokens(shorter, longer.slice(start, start + windowSize)));
      if (best >= 0.995) return 1;
    }
  }

  const lcsPrevious = new Array(shorter.length + 1).fill(0);
  const lcsCurrent = new Array(shorter.length + 1).fill(0);
  for (let i = 1; i <= longer.length; i++) {
    for (let j = 1; j <= shorter.length; j++) {
      lcsCurrent[j] = longer[i - 1] === shorter[j - 1]
        ? lcsPrevious[j - 1] + 1
        : Math.max(lcsPrevious[j], lcsCurrent[j - 1]);
    }
    lcsPrevious.splice(0, lcsPrevious.length, ...lcsCurrent);
    lcsCurrent.fill(0);
  }

  return Math.max(best, lcsPrevious[shorter.length] / shorter.length);
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

const questionIntentProfile = (text: string): QuestionIntentProfile => {
  const normalized = normalizeMCQField(text);
  const hasException = /\bngoai\s+tru\b|\bexcept\b/.test(normalized);
  const hasContraindication = /\bchong\s+chi\s+dinh\b|\bkhong\s+nen\b|\bkhong\s+duoc\b|\bkhong\s+duoc\s+dung\b|\bcan\s+tranh\b|\btranh\s+dung\b/.test(normalized);
  const hasFalseChoice = hasException || /\bkhong\s+(?:dung|chinh\s+xac|phu\s+hop|phai|thuoc|bao\s+gom|goi\s+y)\b|\bnot\s+(?:true|correct|appropriate|indicated)\b|\bsai\b/.test(normalized);
  const hasGenericNegative = /\bkhong\b|\bnot\b|\bnone\b|\bwithout\b/.test(normalized);

  if (hasContraindication) return { key: 'contraindication', marker: 'contraindication', isRisky: true };
  if (hasException) return { key: 'falseChoice', marker: 'exception', isRisky: true };
  if (hasFalseChoice) return { key: 'falseChoice', marker: 'false', isRisky: true };
  if (hasGenericNegative) return { key: 'negative', marker: 'negative', isRisky: true };
  return { key: 'normal', marker: 'none', isRisky: false };
};

const areIntentsCompatible = (a: QuestionIntentProfile, b: QuestionIntentProfile): boolean => {
  if (a.key === b.key) return true;
  return false;
};

const needsIntentReview = (a: QuestionIntentProfile, b: QuestionIntentProfile): boolean => {
  if (!a.isRisky && !b.isRisky) return false;
  if (!areIntentsCompatible(a, b)) return true;
  return a.marker !== b.marker;
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

const scoreQuestionDetailed = (a: string = '', b: string = '') => {
  const intentA = questionIntentProfile(a);
  const intentB = questionIntentProfile(b);
  const intentMismatch = !areIntentsCompatible(intentA, intentB);
  const intentReviewRequired = needsIntentReview(intentA, intentB);
  const questionTokenSort = tokenSortRatio(a, b);
  const questionPartial = partialRatio(a, b);

  if (intentMismatch) {
    return {
      score: 0,
      questionTokenSort,
      questionPartial,
      intentMismatch,
      intentReviewRequired,
    };
  }

  const base = Math.max(tokenRatio(a, b), questionPartial * 0.97);
  const tailScore = tailAfterSharedStemScore(a, b);
  const score = tailScore === null ? base : Math.min(base, 0.55 + tailScore * 0.45);

  return {
    score,
    questionTokenSort,
    questionPartial,
    intentMismatch,
    intentReviewRequired,
  };
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
  const questionDetails = scoreQuestionDetailed(a.question || '', b.question || '');
  const question = questionDetails.score;
  const optionsBySlot = scoreOptionsBySlot(getOptions(a), getOptions(b));
  const optionsAsSet = scoreOptionsAsSet(getOptions(a), getOptions(b));
  const optionsScore = Math.max(optionsBySlot, optionsAsSet * 0.96);
  const compositeRaw = question * 0.55 + optionsBySlot * 0.3 + optionsAsSet * 0.15;
  // Length‑aware adjustment: short texts get a stricter score, long texts get a looser one
  const lenA = (a.question || '').length;
  const lenB = (b.question || '').length;
  const maxLen = Math.max(lenA, lenB);
  let lengthCoeff = 1;
  if (maxLen < 50) {
    // Very short questions – penalize differences more heavily
    lengthCoeff = 1.05; // boost score so threshold is harder to meet
  } else if (maxLen > 200) {
    // Long clinical cases – allow a bit more variance
    lengthCoeff = 0.95; // lower score so threshold is easier to meet
  }
  const composite = Math.min(compositeRaw * lengthCoeff, question * 0.75 + optionsScore * 0.25);

  return {
    question,
    questionTokenSort: questionDetails.questionTokenSort,
    questionPartial: questionDetails.questionPartial,
    optionsBySlot,
    optionsAsSet,
    composite,
    intentMismatch: questionDetails.intentMismatch,
    intentReviewRequired: questionDetails.intentReviewRequired,
  };
};

const formatPercent = (score: number): number => Math.round(score * 100);

const formatScoreSummary = (scores: DuplicateFieldScores, optionsScore: number, answerConflict: boolean): string =>
  `${answerConflict ? 'Trùng mạnh nhưng xung đột đáp án' : 'Question + A-E tương đồng cao'} ` +
  `(~${formatPercent(scores.composite)}%; Q ${formatPercent(scores.question)}%, ` +
  `partial ${formatPercent(scores.questionPartial)}%, sort ${formatPercent(scores.questionTokenSort)}%, ` +
  `slot ${formatPercent(scores.optionsBySlot)}%, set ${formatPercent(scores.optionsAsSet)}%, ` +
  `A-E ${formatPercent(optionsScore)}%)`;

const selectCandidatePool = <T extends MCQLike>(candidate: MCQLike, existingQuestions: T[]): T[] => {
  if (existingQuestions.length < GROUPING_MIN_CANDIDATES) return existingQuestions;

  const candidateQuestion = normalizeMCQField(candidate.question || '');
  const candidateBucket = Math.floor(candidateQuestion.length / LENGTH_BUCKET_SIZE);
  const selected: T[] = [];
  const seen = new Set<T>();

  for (const existing of existingQuestions) {
    const existingQuestion = normalizeMCQField(existing.question || '');
    const existingBucket = Math.floor(existingQuestion.length / LENGTH_BUCKET_SIZE);
    const sameLengthBand = Math.abs(existingBucket - candidateBucket) <= GROUPING_NEIGHBOR_RADIUS;
    const containmentMatch =
      candidateQuestion.length > 20 &&
      existingQuestion.length > 20 &&
      (candidateQuestion.includes(existingQuestion) || existingQuestion.includes(candidateQuestion));

    if ((sameLengthBand || containmentMatch) && !seen.has(existing)) {
      seen.add(existing);
      selected.push(existing);
    }
  }

  return selected.length >= GROUPING_FALLBACK_MIN ? selected : existingQuestions;
};

export const findDuplicate = <T extends MCQLike>(candidate: MCQLike, existingQuestions: T[]): DuplicateMatch<T> => {
  const candidateFingerprint = buildMCQFingerprint(candidate);
  const candidatesToCompare = selectCandidatePool(candidate, existingQuestions);
  let bestAutoSkipMatch: DuplicateMatch<T> | null = null;
  let bestAutoSkipPriority = -1;
  let bestAutoSkipScore = -1;
  let bestReviewMatch: DuplicateMatch<T> | null = null;
  let bestReviewScore = -1;

  for (const existing of candidatesToCompare) {
    const exactFingerprint = candidateFingerprint === buildMCQFingerprint(existing);
    const fieldScores = scoreMCQDuplicate(candidate, existing);
    const optionsScore = Math.max(fieldScores.optionsBySlot, fieldScores.optionsAsSet);
    const answerConflict = answersConflict(candidate, existing);
    const canAutoSkip = !answerConflict && !fieldScores.intentMismatch && !fieldScores.intentReviewRequired;

    if (exactFingerprint && !answerConflict) {
      const match: DuplicateMatch<T> = {
        action: 'autoSkip',
        isDup: true,
        isAutoSkip: true,
        reason: 'Trùng toàn bộ Question + A/B/C/D/E (100%)',
        matchedWith: (existing.question || '').substring(0, 60),
        matchedData: existing,
        score: 1,
        fieldScores: {
          question: 1,
          questionTokenSort: 1,
          questionPartial: 1,
          optionsBySlot: 1,
          optionsAsSet: 1,
          composite: 1,
          intentMismatch: false,
          intentReviewRequired: false,
        },
      };
      if (bestAutoSkipPriority < 3) {
        bestAutoSkipPriority = 3;
        bestAutoSkipScore = 1;
        bestAutoSkipMatch = match;
      }
    }

    if (
        fieldScores.composite >= 0.985 &&
        fieldScores.question >= 0.985 &&
        fieldScores.optionsBySlot >= 0.98 &&
        fieldScores.optionsAsSet >= 0.98 &&
        canAutoSkip
      ) {
      const match: DuplicateMatch<T> = {
        action: 'autoSkip',
        isDup: true,
        isAutoSkip: true,
        reason: `Trùng gần như tuyệt đối Q+A-E (~${formatPercent(fieldScores.composite)}%)`,
        matchedWith: (existing.question || '').substring(0, 60),
        matchedData: existing,
        score: fieldScores.composite,
        fieldScores,
      };
      if (bestAutoSkipPriority < 1 || (bestAutoSkipPriority === 1 && fieldScores.composite > bestAutoSkipScore)) {
        bestAutoSkipPriority = 1;
        bestAutoSkipScore = fieldScores.composite;
        bestAutoSkipMatch = match;
      }
    }

    const reorderedOptionsReview =
      fieldScores.question >= 0.9 &&
      fieldScores.optionsAsSet >= 0.95 &&
      fieldScores.optionsBySlot < 0.9;
    const partialReview =
      !fieldScores.intentMismatch &&
      fieldScores.questionPartial >= 0.92 &&
      fieldScores.questionTokenSort >= 0.65 &&
      optionsScore >= 0.82;
    const intentReview =
      fieldScores.intentReviewRequired &&
      !fieldScores.intentMismatch &&
      optionsScore >= 0.9 &&
      (
        optionsScore >= 0.98 ||
        fieldScores.question >= 0.72 ||
        (fieldScores.questionPartial >= 0.58 && fieldScores.questionTokenSort >= 0.32)
      );

    if (
        (
          fieldScores.composite >= 0.82 &&
          fieldScores.question >= 0.78 &&
          optionsScore >= 0.75
        ) ||
        reorderedOptionsReview ||
        partialReview ||
        intentReview
      ) {
      const reason = fieldScores.intentReviewRequired
        ? `Có phủ định/ngoại trừ cần review; ${formatScoreSummary(fieldScores, optionsScore, answerConflict)}`
        : reorderedOptionsReview
          ? 'Options giống nhưng đổi vị trí; cần review'
          : partialReview && fieldScores.question < 0.78
            ? `Nghi trùng do partial match; ${formatScoreSummary(fieldScores, optionsScore, answerConflict)}`
            : formatScoreSummary(fieldScores, optionsScore, answerConflict);
      const reviewMatch: DuplicateMatch<T> = {
        action: 'review',
        isDup: true,
        isAutoSkip: false,
        reason,
        matchedWith: (existing.question || '').substring(0, 60),
        matchedData: existing,
        score: fieldScores.composite,
        fieldScores,
      };
      const effectiveScore = fieldScores.composite + (answerConflict ? 0.03 : 0);
      if (effectiveScore > bestReviewScore) {
        bestReviewScore = effectiveScore;
        bestReviewMatch = reviewMatch;
      }
    }
  }

  if (bestAutoSkipMatch) return bestAutoSkipMatch;
  if (bestReviewMatch) return bestReviewMatch;

  return {
    action: 'unique',
    isDup: false,
    isAutoSkip: false,
  };
};
