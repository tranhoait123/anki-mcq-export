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
  objectiveTail?: number | null;
  sharedClinicalStem?: number | null;
  clinicalObjectiveMismatch?: boolean;
}

export type DedupeRiskFlag =
  | 'answer_conflict'
  | 'intent_mismatch'
  | 'intent_review'
  | 'shared_clinical_stem_different_objective'
  | 'same_options_different_question'
  | 'same_question_number'
  | 'reordered_options'
  | 'partial_question_match';

export interface DedupeEvidence {
  decisionLabel: 'Trùng gần như chắc' | 'Cần review' | 'Không trùng';
  riskFlags: DedupeRiskFlag[];
  answerConflict: boolean;
  sameQuestionNumber: boolean;
  optionsScore: number;
  optionSignatureMatch: boolean;
  questionIntent: {
    candidate: QuestionIntentProfile;
    existing: QuestionIntentProfile;
  };
  clinicalStem?: {
    sharedTokenCount: number;
    sharedRatio: number;
    tailScore: number | null;
    candidateObjective: QuestionObjectiveKey;
    existingObjective: QuestionObjectiveKey;
    objectiveMismatch: boolean;
  };
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
  evidence?: DedupeEvidence;
}

type MCQLike = Partial<MCQ> & {
  question?: string;
  options?: string[];
  correctAnswer?: string;
};

type QuestionIntentKey = 'normal' | 'negative' | 'falseChoice' | 'contraindication';
type QuestionObjectiveKey = 'diagnosis' | 'treatment' | 'complication' | 'investigation' | 'contraindication' | 'prognosis' | 'mechanism' | 'normal';

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

const MEDICAL_ABBREVIATIONS: Record<string, string> = {
  bn: 'benh nhan',
  tha: 'tang huyet ap',
  dtd: 'dai thao duong',
  gpb: 'giai phau benh',
  ux: 'u xo',
  ct: 'cat lop vi tinh',
  cx: 'co tu cung',
  mri: 'cong huong tu',
  vq: 'vong kinh',
  stis: 'benh lay truyen qua duong tinh duc',
};

const MEDICAL_STOPWORDS = new Set([
  'nao sau day la',
  'nao sau day',
  'sau day',
  'hay chon',
  'chon phat bieu',
  'phat bieu nao',
  'trieu chung nao',
  'dau hieu nao',
  'cau hoi nao',
  'cau hoi',
  'phat bieu',
  'cau nao',
  'cau',
  'la',
  've',
]);

const expandMedicalTerms = (text: string): string => {
  let expanded = text;
  for (const [abbr, full] of Object.entries(MEDICAL_ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'g');
    expanded = expanded.replace(regex, full);
  }
  return expanded;
};

const removeMedicalStopwords = (text: string): string => {
  let cleaned = text;
  for (const stopword of MEDICAL_STOPWORDS) {
    cleaned = cleaned.replace(new RegExp(`\\b${stopword}\\b`, 'g'), ' ');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
};

export const normalizeSemanticField = (text: string = ''): string => {
  const base = normalizeMCQField(text);
  const expanded = expandMedicalTerms(base);
  return removeMedicalStopwords(expanded);
};

const getTrigrams = (text: string): Set<string> => {
  const trigrams = new Set<string>();
  for (let i = 0; i < text.length - 2; i++) {
    trigrams.add(text.substring(i, i + 3));
  }
  return trigrams;
};

const sorensenDiceSimilarity = (a: string, b: string): number => {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return levenshteinSimilarity(a, b);

  const trigramsA = getTrigrams(a);
  const trigramsB = getTrigrams(b);

  let intersection = 0;
  for (const trigram of trigramsA) {
    if (trigramsB.has(trigram)) {
      intersection++;
    }
  }

  return (2 * intersection) / (trigramsA.size + trigramsB.size);
};

const normalizeAnswer = (text: string = ''): string => {
  const normalized = normalizeMCQField(text);
  const letter = String(text).trim().match(/^[A-E]/i)?.[0]?.toLowerCase();
  return letter || normalized;
};

const extractQuestionNumber = (text: string): number | null => {
  if (!text || typeof text !== 'string') return null;
  const patterns = [
    /câu\s*(?:số\s*)?(\d+)/i,
    /question\s*(\d+)/i,
    /^(\d+)\s*[.:)\]]/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return null;
};

const getQuestionNumber = (mcq: MCQLike): number | null => (
  typeof mcq.trace?.questionNumber === 'number' && Number.isFinite(mcq.trace.questionNumber)
    ? mcq.trace.questionNumber
    : extractQuestionNumber(mcq.question || '')
);

const getOptions = (mcq: MCQLike): string[] => {
  const options = Array.isArray(mcq.options) ? mcq.options.slice(0, 5) : [];
  while (options.length < 5) options.push('');
  return options;
};

export const buildMCQFingerprint = (mcq: MCQLike): string => {
  const fields = [mcq.question || '', ...getOptions(mcq)];
  return fields.map(normalizeMCQField).join('|');
};

const buildOptionsFingerprint = (mcq: MCQLike): string =>
  getOptions(mcq).map(normalizeMCQField).join('|');

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
  const hasException = /\bngoai\s+tru\b|\bexcept\b|\bleast\s+likely\b|\bit\s+co\s+kha\s+nang\b/.test(normalized);
  const hasContraindication = /\bchong\s+chi\s+dinh\b|\bkhong\s+nen\b|\bkhong\s+duoc\b|\bkhong\s+duoc\s+dung\b|\bcan\s+tranh\b|\btranh\s+dung\b/.test(normalized);
  const hasFalseChoice = hasException || /\bkhong\s+(?:dung|chinh\s+xac|phu\s+hop|phai|thuoc|bao\s+gom|goi\s+y)\b|\bnot\s+(?:true|correct|appropriate|indicated|likely)\b|\bsai\b/.test(normalized);
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

interface SharedClinicalStemAnalysis {
  sharedTokenCount: number;
  sharedRatio: number;
  tailScore: number | null;
  tailA: string;
  tailB: string;
  objectiveA: QuestionObjectiveKey;
  objectiveB: QuestionObjectiveKey;
  objectiveMismatch: boolean;
}

const SHARED_CASE_SECTION_MARKER = /\[\s*(?:tình\s*huống|tinh\s*huong|câu\s*hỏi|cau\s*hoi)\s*\]/gi;
const SHARED_CASE_LEAD_IN = new RegExp(
  String.raw`(?:^|[\s:;,.([{-])` +
  String.raw`(?:tình\s*huống(?:\s*lâm\s*sàng)?|tinh\s*huong(?:\s*lam\s*sang)?|dữ\s*kiện|du\s*kien|bệnh\s*cảnh|benh\s*canh|(?:clinical\s+)?vignette|case|item\s*set)` +
  String.raw`(?:\s*(?:cho|dùng\s+cho|dung\s+cho|sử\s*dụng\s+cho|su\s+dung\s+cho|áp\s*dụng\s+cho|ap\s*dung\s+cho|for|covers?|applies?\s+to))?` +
  String.raw`\s*(?:các\s+|the\s+)?(?:câu|cau|questions?|items?|q)\s*` +
  String.raw`\d+(?:(?:\s*(?:[-–—,;]|và|va|and|&|đến|den|tới|toi|to|through)\s*)+\d+)*\s*[:.)-]?`,
  'gi'
);

const stripSharedCaseScaffold = (text: string): string =>
  String(text || '')
    .replace(SHARED_CASE_LEAD_IN, ' ')
    .replace(SHARED_CASE_SECTION_MARKER, ' ');

const normalizeClinicalComparisonField = (text: string): string =>
  normalizeSemanticField(stripSharedCaseScaffold(text));

const questionObjectiveProfile = (text: string): QuestionObjectiveKey => {
  const normalized = normalizeSemanticField(text);
  if (/\bchong\s+chi\s+dinh\b|\bkhong\s+nen\b|\bcontraindicat\b|\bavoid\b/.test(normalized)) return 'contraindication';
  if (/\bxu\s+tri\b|\bdieu\s+tri\b|\bthuoc\b|\bcan\s+lam\s+gi\b|\btreatment\b|\bmanagement\b|\bmanage\b|\bfirst\s+line\b/.test(normalized)) return 'treatment';
  if (/\bxet\s+nghiem\b|\bcan\s+lam\s+sang\b|\bsieu\s+am\b|\bct\b|\bmri\b|\btest\b|\binvestigation\b|\bimaging\b/.test(normalized)) return 'investigation';
  if (/\bbien\s+chung\b|\bcomplication\b|\bcomplicate\b/.test(normalized)) return 'complication';
  if (/\btien\s+luong\b|\bprognosis\b|\brisk\b|\byeu\s+to\s+nguy\s+co\b/.test(normalized)) return 'prognosis';
  if (/\bco\s+che\b|\bnguyen\s+nhan\b|\bpathophysiology\b|\bmechanism\b|\bcause\b/.test(normalized)) return 'mechanism';
  if (/\bchan\s+doan\b|\bdiagnosis\b|\bdiagnose\b|\bbenh\s+nao\b/.test(normalized)) return 'diagnosis';
  return 'normal';
};

const analyzeSharedClinicalStem = (a: string, b: string): SharedClinicalStemAnalysis | null => {
  const normalizedA = normalizeClinicalComparisonField(a);
  const normalizedB = normalizeClinicalComparisonField(b);
  const tokensA = normalizedA.split(' ').filter(token => token.length > 1);
  const tokensB = normalizedB.split(' ').filter(token => token.length > 1);
  const maxLen = Math.max(tokensA.length, tokensB.length);
  if (maxLen < 18) return null;

  let prefix = 0;
  const minLen = Math.min(tokensA.length, tokensB.length);
  while (prefix < minLen && tokensA[prefix] === tokensB[prefix]) prefix++;

  if (prefix < 10 || prefix / maxLen < 0.45) return null;

  const tailA = tokensA.slice(prefix).join(' ');
  const tailB = tokensB.slice(prefix).join(' ');
  let tailScore: number;
  if (!tailA && !tailB) tailScore = 1;
  else if (!tailA || !tailB) tailScore = 0.45;
  else tailScore = tokenRatio(tailA, tailB);

  const objectiveA = questionObjectiveProfile(tailA || a);
  const objectiveB = questionObjectiveProfile(tailB || b);
  const objectiveMismatch =
    objectiveA !== 'normal' &&
    objectiveB !== 'normal' &&
    objectiveA !== objectiveB &&
    tailScore < 0.86;

  return {
    sharedTokenCount: prefix,
    sharedRatio: prefix / maxLen,
    tailScore,
    tailA,
    tailB,
    objectiveA,
    objectiveB,
    objectiveMismatch,
  };
};

const scoreQuestionDetailed = (a: string = '', b: string = '') => {
  const intentA = questionIntentProfile(a);
  const intentB = questionIntentProfile(b);
  const intentMismatch = !areIntentsCompatible(intentA, intentB);
  const intentReviewRequired = needsIntentReview(intentA, intentB);

  const semA = normalizeSemanticField(a);
  const semB = normalizeSemanticField(b);

  const questionTokenSort = tokenSortRatio(semA, semB);
  const questionPartial = partialRatio(semA, semB);

  if (intentMismatch) {
    return {
      score: 0,
      questionTokenSort,
      questionPartial,
      intentMismatch,
      intentReviewRequired,
      objectiveTail: null,
      sharedClinicalStem: null,
      clinicalObjectiveMismatch: false,
    };
  }

  const tokenRatioScore = tokenRatio(semA, semB);
  const diceScore = sorensenDiceSimilarity(semA, semB);
  const levenshteinScore = levenshteinSimilarity(semA, semB);

  // Hybrid Score: 0.4 * TokenSortRatio + 0.35 * Sørensen-Dice + 0.25 * Levenshtein
  const hybridScore = 0.4 * questionTokenSort + 0.35 * diceScore + 0.25 * levenshteinScore;

  const base = Math.max(tokenRatioScore, hybridScore, questionPartial * 0.97);
  const clinicalStem = analyzeSharedClinicalStem(a, b);
  const tailScore = clinicalStem?.tailScore ?? null;
  const clinicalCeiling = clinicalStem === null
    ? base
    : clinicalStem.objectiveMismatch
      ? 0.69
      : 0.55 + (tailScore ?? 0) * 0.45;
  const score = clinicalStem === null ? base : Math.min(base, clinicalCeiling);

  return {
    score,
    questionTokenSort,
    questionPartial,
    intentMismatch,
    intentReviewRequired,
    objectiveTail: tailScore,
    sharedClinicalStem: clinicalStem?.sharedRatio ?? null,
    clinicalObjectiveMismatch: clinicalStem?.objectiveMismatch ?? false,
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
  
  let penaltyFactor = 1;
  if (maxLen < 50) {
    // Very short questions – penalize differences more heavily
    penaltyFactor = 1.5;
  } else if (maxLen > 200) {
    // Long clinical cases – allow a bit more variance
    penaltyFactor = 0.8;
  }
  
  const rawDiff = 1 - compositeRaw;
  const adjustedComposite = Math.max(0, 1 - rawDiff * penaltyFactor);
  
  const composite = Math.min(adjustedComposite, question * 0.75 + optionsScore * 0.25);

  return {
    question,
    questionTokenSort: questionDetails.questionTokenSort,
    questionPartial: questionDetails.questionPartial,
    optionsBySlot,
    optionsAsSet,
    composite,
    intentMismatch: questionDetails.intentMismatch,
    intentReviewRequired: questionDetails.intentReviewRequired,
    objectiveTail: questionDetails.objectiveTail,
    sharedClinicalStem: questionDetails.sharedClinicalStem,
    clinicalObjectiveMismatch: questionDetails.clinicalObjectiveMismatch,
  };
};

const formatPercent = (score: number): number => Math.round(score * 100);

const formatScoreSummary = (scores: DuplicateFieldScores, optionsScore: number, answerConflict: boolean): string =>
  `${answerConflict ? 'Trùng mạnh nhưng xung đột đáp án' : 'Question + A-E tương đồng cao'} ` +
  `(~${formatPercent(scores.composite)}%; Q ${formatPercent(scores.question)}%, ` +
  `partial ${formatPercent(scores.questionPartial)}%, sort ${formatPercent(scores.questionTokenSort)}%, ` +
  `slot ${formatPercent(scores.optionsBySlot)}%, set ${formatPercent(scores.optionsAsSet)}%, ` +
  `A-E ${formatPercent(optionsScore)}%)`;

const EXACT_FIELD_SCORES: DuplicateFieldScores = {
  question: 1,
  questionTokenSort: 1,
  questionPartial: 1,
  optionsBySlot: 1,
  optionsAsSet: 1,
  composite: 1,
  intentMismatch: false,
  intentReviewRequired: false,
  objectiveTail: 1,
  sharedClinicalStem: null,
  clinicalObjectiveMismatch: false,
};

const buildDedupeEvidence = (
  candidate: MCQLike,
  existing: MCQLike,
  scores: DuplicateFieldScores,
  answerConflict: boolean,
  exactFingerprint = false
): DedupeEvidence => {
  const optionsScore = Math.max(scores.optionsBySlot, scores.optionsAsSet);
  const numCandidate = getQuestionNumber(candidate);
  const numExisting = getQuestionNumber(existing);
  const sameQuestionNumber = numCandidate !== null && numExisting !== null && numCandidate === numExisting;
  const optionSignatureMatch = buildOptionsFingerprint(candidate) === buildOptionsFingerprint(existing);
  const clinicalStem = analyzeSharedClinicalStem(candidate.question || '', existing.question || '');
  const riskFlags: DedupeRiskFlag[] = [];

  if (answerConflict) riskFlags.push('answer_conflict');
  if (scores.intentMismatch) riskFlags.push('intent_mismatch');
  if (scores.intentReviewRequired) riskFlags.push('intent_review');
  if (sameQuestionNumber && !exactFingerprint) riskFlags.push('same_question_number');
  if (clinicalStem?.objectiveMismatch || scores.clinicalObjectiveMismatch) {
    riskFlags.push('shared_clinical_stem_different_objective');
  }
  if (optionSignatureMatch && scores.question < 0.78 && !exactFingerprint) {
    riskFlags.push('same_options_different_question');
  }
  if (scores.optionsAsSet >= 0.95 && scores.optionsBySlot < 0.9) {
    riskFlags.push('reordered_options');
  }
  if (scores.questionPartial >= 0.92 && scores.question < 0.78) {
    riskFlags.push('partial_question_match');
  }

  return {
    decisionLabel: 'Không trùng',
    riskFlags,
    answerConflict,
    sameQuestionNumber,
    optionsScore,
    optionSignatureMatch,
    questionIntent: {
      candidate: questionIntentProfile(candidate.question || ''),
      existing: questionIntentProfile(existing.question || ''),
    },
    clinicalStem: clinicalStem
      ? {
          sharedTokenCount: clinicalStem.sharedTokenCount,
          sharedRatio: clinicalStem.sharedRatio,
          tailScore: clinicalStem.tailScore,
          candidateObjective: clinicalStem.objectiveA,
          existingObjective: clinicalStem.objectiveB,
          objectiveMismatch: clinicalStem.objectiveMismatch,
        }
      : undefined,
  };
};

const hasUnsafeAutoSkipRisk = (evidence: DedupeEvidence): boolean =>
  evidence.riskFlags.some(flag =>
    flag === 'answer_conflict' ||
    flag === 'intent_mismatch' ||
    flag === 'intent_review' ||
    flag === 'shared_clinical_stem_different_objective' ||
    flag === 'same_options_different_question' ||
    flag === 'reordered_options'
  );

const withDecisionLabel = <T extends MCQLike>(match: DuplicateMatch<T>): DuplicateMatch<T> => {
  if (!match.evidence) return match;
  match.evidence.decisionLabel = match.action === 'autoSkip'
    ? 'Trùng gần như chắc'
    : match.action === 'review'
      ? 'Cần review'
      : 'Không trùng';
  return match;
};

const selectCandidatePool = <T extends MCQLike>(candidate: MCQLike, existingQuestions: T[]): T[] => {
  if (existingQuestions.length < GROUPING_MIN_CANDIDATES) return existingQuestions;

  const candidateQuestion = normalizeMCQField(candidate.question || '');
  const candidateOptionsFingerprint = buildOptionsFingerprint(candidate);
  const candidateBucket = Math.floor(candidateQuestion.length / LENGTH_BUCKET_SIZE);
  const selected: T[] = [];
  const seen = new Set<T>();
  let sameOptionsCount = 0;

  for (const existing of existingQuestions) {
    const existingQuestion = normalizeMCQField(existing.question || '');
    const sameOptions = buildOptionsFingerprint(existing) === candidateOptionsFingerprint;
    if (sameOptions) sameOptionsCount++;
    const existingBucket = Math.floor(existingQuestion.length / LENGTH_BUCKET_SIZE);
    const sameLengthBand = Math.abs(existingBucket - candidateBucket) <= GROUPING_NEIGHBOR_RADIUS;
    const containmentMatch =
      candidateQuestion.length > 20 &&
      existingQuestion.length > 20 &&
      (candidateQuestion.includes(existingQuestion) || existingQuestion.includes(candidateQuestion));

    if ((sameLengthBand || containmentMatch || sameOptions) && !seen.has(existing)) {
      seen.add(existing);
      selected.push(existing);
    }
  }

  if (sameOptionsCount > 0) return selected;
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
    const evidence = buildDedupeEvidence(candidate, existing, fieldScores, answerConflict, exactFingerprint);
    const canAutoSkip = !answerConflict && !fieldScores.intentMismatch && !fieldScores.intentReviewRequired && !hasUnsafeAutoSkipRisk(evidence);

    if (exactFingerprint && !answerConflict) {
      const match: DuplicateMatch<T> = withDecisionLabel({
        action: 'autoSkip',
        isDup: true,
        isAutoSkip: true,
        reason: 'Trùng toàn bộ Question + A/B/C/D/E (100%)',
        matchedWith: (existing.question || '').substring(0, 60),
        matchedData: existing,
        score: 1,
        fieldScores: EXACT_FIELD_SCORES,
        evidence: buildDedupeEvidence(candidate, existing, EXACT_FIELD_SCORES, false, true),
      });
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
      const match: DuplicateMatch<T> = withDecisionLabel({
        action: 'autoSkip',
        isDup: true,
        isAutoSkip: true,
        reason: `Trùng gần như tuyệt đối Q+A-E (~${formatPercent(fieldScores.composite)}%)`,
        matchedWith: (existing.question || '').substring(0, 60),
        matchedData: existing,
        score: fieldScores.composite,
        fieldScores,
        evidence,
      });
      if (bestAutoSkipPriority < 1 || (bestAutoSkipPriority === 1 && fieldScores.composite > bestAutoSkipScore)) {
        bestAutoSkipPriority = 1;
        bestAutoSkipScore = fieldScores.composite;
        bestAutoSkipMatch = match;
      }
    }

    if (fieldScores.clinicalObjectiveMismatch && fieldScores.question < 0.78) {
      continue;
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
    const numCandidate = getQuestionNumber(candidate);
    const numExisting = getQuestionNumber(existing);
    const sameNumber = numCandidate !== null && numExisting !== null && numCandidate === numExisting;
    const isQuestionHighlySimilar = fieldScores.question >= 0.88 || (sameNumber && fieldScores.question >= 0.70);
    
    // Heuristic: If questions share a long clinical stem, they might get a high question score due to partial matching.
    // We can distinguish them from split-page duplicates by checking if they have significantly different lengths
    // and their overall token sets are different (low tokenSortScore).
    const lenCandidate = (candidate.question || '').length;
    const lenExisting = (existing.question || '').length;
    const diffLen = Math.abs(lenCandidate - lenExisting);
    const minLen = Math.min(lenCandidate, lenExisting);
    
    // For very long clinical stems, the relative ratio might be > 0.85, but the absolute diff can still be > 100 chars.
    // If the difference is > 100 chars, or the ratio is < 0.88, it's highly likely a different sub-question.
    const isSignificantLengthDiff = diffLen > 100 || (diffLen > 60 && minLen / Math.max(lenCandidate, lenExisting) < 0.88);
    const isSharedClinicalStemLikely = isSignificantLengthDiff && fieldScores.questionTokenSort < 0.94;
    
    const overlappingPageDuplicate = !fieldScores.intentMismatch && isQuestionHighlySimilar && !isSharedClinicalStemLikely;

    if (
        (
          fieldScores.composite >= 0.82 &&
          fieldScores.question >= 0.78 &&
          optionsScore >= 0.75
        ) ||
        reorderedOptionsReview ||
        partialReview ||
        intentReview ||
        overlappingPageDuplicate
      ) {
      const reason = fieldScores.intentReviewRequired
        ? `Có phủ định/ngoại trừ cần review; ${formatScoreSummary(fieldScores, optionsScore, answerConflict)}`
        : reorderedOptionsReview
          ? 'Options giống nhưng đổi vị trí; cần review'
          : overlappingPageDuplicate && optionsScore < 0.75
            ? sameNumber
              ? `Trùng số thứ tự câu hỏi (Câu ${numCandidate}); các lựa chọn khác nhau hoặc xung đột đáp án`
              : `Trùng lặp thân câu hỏi (~${formatPercent(fieldScores.question)}%) từ các trang gối đầu; các lựa chọn khác nhau`
            : partialReview && fieldScores.question < 0.78
              ? `Nghi trùng do partial match; ${formatScoreSummary(fieldScores, optionsScore, answerConflict)}`
              : formatScoreSummary(fieldScores, optionsScore, answerConflict);
      const reviewMatch: DuplicateMatch<T> = withDecisionLabel({
        action: 'review',
        isDup: true,
        isAutoSkip: false,
        reason,
        matchedWith: (existing.question || '').substring(0, 60),
        matchedData: existing,
        score: fieldScores.composite,
        fieldScores,
        evidence,
      });
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

export interface DuplicateLookup<T extends MCQLike = MCQLike> {
  add: (question: T) => void;
  addMany: (questions: T[]) => void;
  find: (candidate: MCQLike) => DuplicateMatch<T>;
  getPool: () => T[];
}

export const createDuplicateLookup = <T extends MCQLike>(existingQuestions: T[] = []): DuplicateLookup<T> => {
  const pool = [...existingQuestions];
  const resultCache = new Map<string, DuplicateMatch<T>>();

  const getCacheKey = (candidate: MCQLike) =>
    `${pool.length}:${buildMCQFingerprint(candidate)}:${normalizeAnswer(candidate.correctAnswer || '')}`;

  return {
    add: (question: T) => {
      pool.push(question);
    },
    addMany: (questions: T[]) => {
      pool.push(...questions);
    },
    find: (candidate: MCQLike) => {
      const cacheKey = getCacheKey(candidate);
      const cached = resultCache.get(cacheKey);
      if (cached) return cached;
      const result = findDuplicate(candidate, pool);
      resultCache.set(cacheKey, result);
      return result;
    },
    getPool: () => pool,
  };
};
