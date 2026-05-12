export type RetryProfileName = 'normal' | 'rescue';
export type BatchErrorKind = 'format' | 'empty' | 'rateLimit' | 'serverBusy' | 'auth' | 'fatal';

export interface RetryProfile {
  name: RetryProfileName;
  attemptBuffer: number;
  minAttempts: number;
  fallbackAfterAttempt: number;
  formatFastFailAttempt: number;
  backoffCapMs: number;
  singleKeyBackoffCapMs: number;
  maxElapsedMs: number;
  splitThresholdChars: number;
  maxDepth: number;
  targetSplitParts: number;
  initialJitterMs: [number, number];
}

export type RetryDecisionCause =
  | 'auth'
  | 'hardQuota'
  | 'softRateLimit'
  | 'serverBusy'
  | 'requestTooLarge'
  | 'format'
  | 'empty'
  | 'fatal';

export type RetryDecisionAction = 'retry' | 'split' | 'fail';

export interface RetryDecision {
  kind: BatchErrorKind;
  cause: RetryDecisionCause;
  action: RetryDecisionAction;
  cooldownKind?: 'rateLimit' | 'serverBusy';
  retryDelayMs?: number;
  shouldTryFallbackModel: boolean;
  message: string;
}

export const RETRY_PROFILES: Record<RetryProfileName, RetryProfile> = {
  normal: {
    name: 'normal',
    attemptBuffer: 3,
    minAttempts: 8,
    fallbackAfterAttempt: 6,
    formatFastFailAttempt: 2,
    backoffCapMs: 45000,
    singleKeyBackoffCapMs: 60000,
    maxElapsedMs: 150000,
    splitThresholdChars: 500,
    maxDepth: 2,
    targetSplitParts: 4,
    initialJitterMs: [500, 1500],
  },
  rescue: {
    name: 'rescue',
    attemptBuffer: 2,
    minAttempts: 6,
    fallbackAfterAttempt: 2,
    formatFastFailAttempt: 1,
    backoffCapMs: 20000,
    singleKeyBackoffCapMs: 30000,
    maxElapsedMs: 120000,
    splitThresholdChars: 350,
    maxDepth: 2,
    targetSplitParts: 4,
    initialJitterMs: [750, 2000],
  },
};

export const getRetryProfile = (name: RetryProfileName = 'normal'): RetryProfile => RETRY_PROFILES[name] || RETRY_PROFILES.normal;

export const classifyBatchError = (error: any): BatchErrorKind => {
  const msg = (error?.message || String(error) || '').toLowerCase();
  const statusCode = error?.status || error?.statusCode || 0;

  if (statusCode === 401 || statusCode === 403 || msg.includes('401') || msg.includes('403') || msg.includes('permission denied') || msg.includes('forbidden')) return 'auth';
  if ((msg.includes('api key') || msg.includes('api_key') || msg.includes('api-key') || msg.includes('token') || msg.includes('invalid_grant')) && (msg.includes('invalid') || msg.includes('not found') || msg.includes('expired') || msg.includes('hết hạn'))) return 'auth';
  if (msg.includes('api_key_invalid') || msg.includes('key not valid')) return 'auth';
  if (msg.includes('context length') || msg.includes('context_length') || msg.includes('context too long') || msg.includes('context too large') || msg.includes('token limit') || msg.includes('max tokens') || msg.includes('maximum tokens') || msg.includes('request too large') || msg.includes('payload too large') || statusCode === 413) return 'format';
  if (statusCode === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('exhausted') || msg.includes('resource_exhausted') || msg.includes('too many requests') || msg.includes('rate limit')) return 'rateLimit';
  if (statusCode === 503 || statusCode === 504 || msg.includes('503') || msg.includes('504') || msg.includes('unavailable') || msg.includes('overloaded') || msg.includes('deadline') || msg.includes('timeout') || msg.includes('econnreset')) return 'serverBusy';
  if (msg.includes('không tìm thấy câu hỏi') || msg.includes('khong tim thay cau hoi') || msg.includes('questions.length') || msg.includes('empty')) return 'empty';
  if (msg.includes('ai_format_error') || msg.includes('json') || msg.includes('định dạng') || msg.includes('dinh dang') || msg.includes('format') || msg.includes('unexpected token') || msg.includes('truncated')) return 'format';
  return 'fatal';
};

const getRetryText = (error: any): string => (error?.message || String(error) || '').toLowerCase();

export const getRetryDelayHintMs = (error: any): number | undefined => {
  const hintedDelay = Number(error?.retryAfterMs || error?.providerRetryDelayMs || 0);
  return Number.isFinite(hintedDelay) && hintedDelay > 0 ? hintedDelay : undefined;
};

export const isHardQuotaError = (error: any): boolean => {
  const msg = getRetryText(error);
  if (!msg) return false;
  return (
    msg.includes('daily') ||
    msg.includes('per day') ||
    msg.includes('per-day') ||
    msg.includes('billing') ||
    msg.includes('insufficient_quota') ||
    msg.includes('insufficient quota') ||
    msg.includes('quota exceeded for quota metric') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('free tier') ||
    msg.includes('credits')
  );
};

export const isRequestTooLargeError = (error: any): boolean => {
  const msg = getRetryText(error);
  const statusCode = error?.status || error?.statusCode || 0;
  return (
    statusCode === 413 ||
    msg.includes('context length') ||
    msg.includes('context_length') ||
    msg.includes('context too long') ||
    msg.includes('context too large') ||
    msg.includes('token limit') ||
    msg.includes('max tokens') ||
    msg.includes('maximum tokens') ||
    msg.includes('request too large') ||
    msg.includes('payload too large')
  );
};

export const getRetryDecision = (
  error: any,
  profile: RetryProfile = getRetryProfile('normal'),
  attempts = 1
): RetryDecision => {
  const kind = classifyBatchError(error);
  const retryDelayMs = getRetryDelayHintMs(error);

  if (kind === 'auth') {
    return {
      kind,
      cause: 'auth',
      action: 'fail',
      shouldTryFallbackModel: false,
      message: 'Auth/key errors should fail fast without burning retry quota.',
    };
  }

  if (isRequestTooLargeError(error)) {
    return {
      kind: 'format',
      cause: 'requestTooLarge',
      action: 'split',
      shouldTryFallbackModel: false,
      message: 'Request is too large; split instead of retrying the same payload.',
    };
  }

  if (kind === 'rateLimit') {
    const hardQuota = isHardQuotaError(error) && !retryDelayMs;
    return {
      kind,
      cause: hardQuota ? 'hardQuota' : 'softRateLimit',
      action: hardQuota ? 'fail' : 'retry',
      cooldownKind: 'rateLimit',
      retryDelayMs,
      shouldTryFallbackModel: false,
      message: hardQuota
        ? 'Hard quota/billing limit detected; try another key or stop this batch.'
        : 'Transient throttle detected; honor provider delay before trying backup keys.',
    };
  }

  if (kind === 'serverBusy') {
    return {
      kind,
      cause: 'serverBusy',
      action: 'retry',
      retryDelayMs,
      shouldTryFallbackModel: attempts > profile.fallbackAfterAttempt,
      message: 'Server/network pressure detected; use capped full-jitter backoff.',
    };
  }

  if (kind === 'format') {
    return {
      kind,
      cause: 'format',
      action: attempts >= profile.formatFastFailAttempt ? 'split' : 'retry',
      shouldTryFallbackModel: false,
      message: 'Model output is malformed; repair once, then split.',
    };
  }

  if (kind === 'empty') {
    return {
      kind,
      cause: 'empty',
      action: attempts >= 2 ? 'split' : 'retry',
      shouldTryFallbackModel: false,
      message: 'Empty extraction; retry once then split if still empty.',
    };
  }

  return {
    kind: 'fatal',
    cause: 'fatal',
    action: 'fail',
    shouldTryFallbackModel: false,
    message: 'Non-transient failure.',
  };
};

export const shouldSplitForError = (kind: BatchErrorKind): boolean => kind === 'format' || kind === 'empty';

export const getBatchErrorTitle = (kind: BatchErrorKind): string => {
  const titles: Record<BatchErrorKind, string> = {
    format: 'AI trả JSON lỗi hoặc bị cắt ngang',
    empty: 'Không tìm thấy câu hỏi trong phần này',
    rateLimit: 'Hết hạn mức hoặc bị giới hạn tốc độ',
    serverBusy: 'Máy chủ AI quá tải hoặc timeout',
    auth: 'API key/token không hợp lệ hoặc thiếu quyền',
    fatal: 'Lỗi không xác định khi xử lý batch',
  };
  return titles[kind];
};

export const getBatchErrorAdvice = (kind: BatchErrorKind, profileName: RetryProfileName = 'normal'): string => {
  const rescuePrefix = profileName === 'rescue' ? 'Đã thử cơ chế cứu nhanh. ' : '';
  const advice: Record<BatchErrorKind, string> = {
    format: `${rescuePrefix}Nên quét lại phần lỗi; hệ thống sẽ chia nhỏ hơn và ép JSON nghiêm ngặt hơn.`,
    empty: `${rescuePrefix}Kiểm tra phần tài liệu này có thật sự chứa MCQ không, hoặc thử OCR lại nếu là ảnh/PDF mờ.`,
    rateLimit: `${rescuePrefix}Chờ 1-2 phút hoặc thêm/xoay API key; nếu lỗi quota ngày/billing thì cần key/project khác.`,
    serverBusy: `${rescuePrefix}Chờ ngắn rồi quét lại phần lỗi; có thể đổi sang model ổn định hơn như Gemini Flash.`,
    auth: 'Vào Cài đặt kiểm tra API key/token và quyền truy cập model của provider đang dùng.',
    fatal: `${rescuePrefix}Thử chia nhỏ file hoặc đổi model; nếu lặp lại, xem console để lấy lỗi kỹ thuật.`,
  };
  return advice[kind];
};

export const describeBatchError = (error: any, profileName: RetryProfileName = 'normal') => {
  const kind = classifyBatchError(error);
  return {
    kind,
    message: getBatchErrorTitle(kind),
    advice: getBatchErrorAdvice(kind, profileName),
  };
};

const nearestNaturalBoundary = (text: string, target: number, min: number, max: number): number => {
  const preferredPatterns = [/\n\s*\n/g, /\n/g, /[.!?。！？]\s+/g, /[,;:]\s+/g, /\s+/g];
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const pattern of preferredPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const pos = match.index + match[0].length;
      if (pos <= min || pos >= max) continue;
      const distance = Math.abs(pos - target);
      if (distance < bestDistance) {
        best = pos;
        bestDistance = distance;
      }
    }
    if (best !== -1 && bestDistance < Math.max(300, (max - min) * 0.18)) break;
  }

  return best === -1 ? Math.min(max, Math.max(min, target)) : best;
};

export const splitTextIntoNaturalParts = (text: string, targetParts = 4, minPartChars = 350): string[] => {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= minPartChars || targetParts <= 1) return [clean];

  const parts: string[] = [];
  let cursor = 0;
  const desiredParts = Math.min(targetParts, Math.ceil(clean.length / minPartChars));

  for (let partIndex = 1; partIndex < desiredParts; partIndex++) {
    const remainingParts = desiredParts - partIndex + 1;
    const remainingLength = clean.length - cursor;
    if (remainingLength <= minPartChars * remainingParts) break;

    const target = cursor + Math.floor(remainingLength / remainingParts);
    const min = cursor + minPartChars;
    const max = Math.min(clean.length - minPartChars * (remainingParts - 1), cursor + Math.floor((remainingLength / remainingParts) * 1.45));
    const boundary = nearestNaturalBoundary(clean, target, min, max);
    const chunk = clean.slice(cursor, boundary).trim();
    if (chunk) parts.push(chunk);
    cursor = boundary;
  }

  const tail = clean.slice(cursor).trim();
  if (tail) parts.push(tail);
  return parts.filter(part => part.length > 0);
};

export const getBackoffDelayMs = (
  profile: RetryProfile,
  attempts: number,
  cycles: number,
  isServerBusy: boolean,
  isRateLimit: boolean,
  isFormatError: boolean,
  hasFreshKey: boolean,
  random: () => number = Math.random
): number => {
  if (hasFreshKey) {
    const [min, max] = profile.initialJitterMs;
    return min + random() * Math.max(0, max - min);
  }

  const baseDelay = isServerBusy ? 3500 : (isRateLimit ? 2500 : 2000);
  const multiplier = (isServerBusy || isFormatError) ? 2 : 1.7;
  const maxDelay = Math.min(
    profile.backoffCapMs,
    baseDelay * Math.pow(multiplier, Math.max(0, cycles || attempts - 1))
  );
  return Math.max(250, random() * maxDelay);
};
