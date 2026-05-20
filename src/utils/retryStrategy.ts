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
  serverBusyFastFailAttempt: number;
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

const BATCH_ERROR_KINDS = new Set<BatchErrorKind>(['format', 'empty', 'rateLimit', 'serverBusy', 'auth', 'fatal']);
const RETRY_DECISION_CAUSES = new Set<RetryDecisionCause>([
  'auth',
  'hardQuota',
  'softRateLimit',
  'serverBusy',
  'requestTooLarge',
  'format',
  'empty',
  'fatal',
]);

const getExplicitRetryKind = (error: any): BatchErrorKind | undefined => {
  const retryKind = String(error?.retryKind || '').trim();
  return BATCH_ERROR_KINDS.has(retryKind as BatchErrorKind) ? retryKind as BatchErrorKind : undefined;
};

const getExplicitRetryCause = (error: any): RetryDecisionCause | undefined => {
  const retryCause = String(error?.retryCause || '').trim();
  return RETRY_DECISION_CAUSES.has(retryCause as RetryDecisionCause) ? retryCause as RetryDecisionCause : undefined;
};

export const RETRY_PROFILES: Record<RetryProfileName, RetryProfile> = {
  normal: {
    name: 'normal',
    attemptBuffer: 3,
    minAttempts: 4,
    fallbackAfterAttempt: 6,
    formatFastFailAttempt: 2,
    backoffCapMs: 45000,
    singleKeyBackoffCapMs: 60000,
    maxElapsedMs: 150000,
    splitThresholdChars: 4000, // Tăng ngưỡng tối thiểu để giữ nguyên vẹn câu hỏi trắc nghiệm
    maxDepth: 0, // Tắt hoàn toàn chia nhỏ đệ quy ở Lớp 1
    targetSplitParts: 2,
    initialJitterMs: [500, 1500],
    serverBusyFastFailAttempt: 2,
  },
  rescue: {
    name: 'rescue',
    attemptBuffer: 2,
    minAttempts: 3,
    fallbackAfterAttempt: 2,
    formatFastFailAttempt: 1,
    backoffCapMs: 20000,
    singleKeyBackoffCapMs: 30000,
    maxElapsedMs: 120000,
    splitThresholdChars: 3000, // Tăng ngưỡng tối thiểu cứu hộ
    maxDepth: 1, // Kích hoạt chia nhỏ cứu hộ ở Lớp 2
    targetSplitParts: 2,
    initialJitterMs: [750, 2000],
    serverBusyFastFailAttempt: 2,
  },
};

export const getRetryProfile = (name: RetryProfileName = 'normal'): RetryProfile => RETRY_PROFILES[name] || RETRY_PROFILES.normal;

export const classifyBatchError = (error: any): BatchErrorKind => {
  const explicitKind = getExplicitRetryKind(error);
  if (explicitKind) return explicitKind;

  const msg = (error?.message || String(error) || '').toLowerCase();
  const statusCode = error?.status || error?.statusCode || 0;

  const hasAuthStatus = statusCode === 401 || statusCode === 403 || /\b(?:401|403)\b/.test(msg) || msg.includes('permission denied') || msg.includes('forbidden');
  const hasExplicitInvalidKey = msg.includes('api_key_invalid') || msg.includes('api key invalid') || msg.includes('invalid api key') || msg.includes('api-key invalid') || msg.includes('api key not valid') || msg.includes('api-key not valid') || msg.includes('key not valid') || msg.includes('reported as leaked') || msg.includes('known leaked');
  const hasExpiredAuthToken = msg.includes('invalid_grant') || (msg.includes('token') && (msg.includes('expired') || msg.includes('hết hạn')));
  const hasRateLimitSignal = statusCode === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('exhausted') || msg.includes('resource_exhausted') || msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('ratelimit') || msg.includes('userratelimitexceeded');
  if (hasExplicitInvalidKey || hasExpiredAuthToken) return 'auth';
  if (msg.includes('context length') || msg.includes('context_length') || msg.includes('context too long') || msg.includes('context too large') || msg.includes('token limit') || msg.includes('max tokens') || msg.includes('maximum tokens') || msg.includes('request too large') || msg.includes('payload too large') || statusCode === 413) return 'format';
  if (msg.includes('shopaikey_deepseek_vision_group_unsupported')) return 'fatal';
  if (msg.includes('no available channel')) return 'fatal';
  if (statusCode === 400 || msg.includes('400 invalid_argument') || msg.includes('invalid_argument')) return 'fatal';
  if (hasRateLimitSignal) return 'rateLimit';
  if (hasAuthStatus) return 'auth';
  if (statusCode === 503 || statusCode === 504 || msg.includes('503') || msg.includes('504') || msg.includes('unavailable') || msg.includes('overloaded') || msg.includes('deadline') || msg.includes('timeout') || msg.includes('econnreset') || msg.includes('failed to fetch') || msg.includes('network error') || msg.includes('network_error') || msg.includes('networkerror') || msg.includes('net::')) return 'serverBusy';
  if (msg.includes('không tìm thấy câu hỏi') || msg.includes('khong tim thay cau hoi') || msg.includes('questions.length') || msg.includes('empty')) return 'empty';
  if (msg.includes('ai_format_error') || msg.includes('json') || msg.includes('định dạng') || msg.includes('dinh dang') || msg.includes('format') || msg.includes('unexpected token') || msg.includes('truncated') || msg.includes('bị cắt') || msg.includes('cắt ngang') || msg.includes('chưa xác minh') || msg.includes('thiếu ')) return 'format';
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
  const hasTransientQuotaWindow = (
    msg.includes('per minute') ||
    msg.includes('requests per minute') ||
    msg.includes('tokens per minute') ||
    msg.includes('rpm') ||
    msg.includes('tpm') ||
    msg.includes('rate limit') ||
    msg.includes('ratelimit') ||
    msg.includes('userratelimitexceeded')
  );
  if (hasTransientQuotaWindow) return false;
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
  const explicitCause = getExplicitRetryCause(error);
  const retryDelayMs = getRetryDelayHintMs(error);

  if (explicitCause === 'requestTooLarge') {
    return {
      kind: 'format',
      cause: 'requestTooLarge',
      action: 'split',
      retryDelayMs,
      shouldTryFallbackModel: false,
      message: 'Request is too large; split instead of retrying the same payload.',
    };
  }

  if (explicitCause === 'serverBusy') {
    const fastFail = profile.serverBusyFastFailAttempt !== undefined && attempts >= profile.serverBusyFastFailAttempt;
    return {
      kind: 'serverBusy',
      cause: 'serverBusy',
      action: fastFail ? 'split' : 'retry',
      retryDelayMs,
      shouldTryFallbackModel: attempts > profile.fallbackAfterAttempt,
      message: fastFail ? 'Server busy persistently; fast-failing to trigger subdivision.' : 'Server/network pressure detected; use capped full-jitter backoff.',
    };
  }

  if (explicitCause === 'softRateLimit') {
    return {
      kind: 'rateLimit',
      cause: 'softRateLimit',
      action: 'retry',
      cooldownKind: 'rateLimit',
      retryDelayMs,
      shouldTryFallbackModel: false,
      message: 'Transient throttle detected; honor provider delay before trying backup keys.',
    };
  }

  if (explicitCause === 'hardQuota') {
    return {
      kind: 'rateLimit',
      cause: 'hardQuota',
      action: 'fail',
      cooldownKind: 'rateLimit',
      retryDelayMs,
      shouldTryFallbackModel: false,
      message: 'Hard quota/billing limit detected; try another key or stop this batch.',
    };
  }

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
    const fastFail = profile.serverBusyFastFailAttempt !== undefined && attempts >= profile.serverBusyFastFailAttempt;
    return {
      kind,
      cause: 'serverBusy',
      action: fastFail ? 'split' : 'retry',
      retryDelayMs,
      shouldTryFallbackModel: attempts > profile.fallbackAfterAttempt,
      message: fastFail ? 'Server busy persistently; fast-failing to trigger subdivision.' : 'Server/network pressure detected; use capped full-jitter backoff.',
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

interface ProtectedRange {
  start: number;
  end: number;
}

export const detectClinicalProtectedRanges = (text: string): ProtectedRange[] => {
  const ranges: ProtectedRange[] = [];
  
  // 1. Nhận diện các cụm Tình huống lâm sàng có chỉ định câu hỏi rõ ràng
  // Ví dụ: "Tình huống lâm sàng (Câu 45 đến câu 48):" hoặc "Ca lâm sàng (Câu 45-48)"
  const clinicalGroupRegex = /(?:tình\s*huống|ca\s*lâm\s*sàng|ca\s*bệnh|clinical\s*case|case|tinh\s*huong|ca\s*benh)\s*\d*\s*(?:\(\s*)?(?:câu|question|q|c)\s*(?:hỏi)?\s*(\d+)\s*(?:đến|–|-|through|to)\s*(?:câu)?\s*(\d+)(?:\s*\))?/gi;
  
  let match;
  clinicalGroupRegex.lastIndex = 0;
  while ((match = clinicalGroupRegex.exec(text)) !== null) {
    const startIdx = match.index;
    const startQ = parseInt(match[1], 10);
    const endQ = parseInt(match[2], 10);
    if (isNaN(startQ) || isNaN(endQ) || startQ >= endQ) continue;
    
    // Tìm điểm kết thúc bằng cách tìm câu hỏi kế tiếp (ví dụ: endQ + 1)
    const nextQNum = endQ + 1;
    const nextQRegex = new RegExp(`(?:^|\\n|\\s)(?:câu|cau|question|q)\\s*${nextQNum}\\s*[:.)-]`, 'i');
    const nextQMatch = text.slice(startIdx).match(nextQRegex);
    
    let endIdx = text.length;
    if (nextQMatch && nextQMatch.index !== undefined) {
      endIdx = startIdx + nextQMatch.index;
    }
    
    ranges.push({ start: startIdx, end: endIdx });
  }
  
  // 2. Nhận diện các tình huống lâm sàng không ghi rõ câu nhưng có từ khóa "Tình huống lâm sàng" hoặc "Ca lâm sàng"
  const clinicalKeywordRegex = /(?:tình\s*huống\s*lâm\s*sàng|tinh\s*huong\s*lam\s*sang|ca\s*lâm\s*sàng|ca\s*lam\s*sang|case\s*lâm\s*sàng|clinical\s*case)/gi;
  clinicalKeywordRegex.lastIndex = 0;
  while ((match = clinicalKeywordRegex.exec(text)) !== null) {
    const startIdx = match.index;
    if (ranges.some(r => startIdx >= r.start && startIdx <= r.end)) continue;
    
    // Tìm 3 câu hỏi tiếp theo để bảo vệ an toàn
    const qPattern = /(?:^|\n|\s)(?:câu|cau|question|q)\s*\d+\s*[:.)-]/gi;
    qPattern.lastIndex = startIdx;
    
    let endIdx = text.length;
    let qMatchesCount = 0;
    let qMatch;
    while ((qMatch = qPattern.exec(text)) !== null) {
      qMatchesCount++;
      if (qMatchesCount === 4) {
        endIdx = qMatch.index;
        break;
      }
    }
    
    ranges.push({ start: startIdx, end: endIdx });
  }
  
  return ranges;
};

const nearestNaturalBoundary = (
  text: string,
  target: number,
  min: number,
  max: number,
  protectedRanges: ProtectedRange[] = []
): number => {
  const preferredPatterns = [
    /\n\s*(?:câu|cau|question|q)\s*\d+\s*[:.)-]/gi, // Ưu tiên hàng đầu: Khớp ranh giới bắt đầu Câu hỏi trắc nghiệm để tránh xé đôi câu
    /\n\s*\d+\s*[:.)-]/g,                           // Khớp với số thứ tự đầu dòng như "12."
    /\n\s*\n/g,                                     // Ngắt đoạn văn lớn
    /\n/g,                                          // Xuống dòng thường
    /[.!?。！？]\s+/g,                               // Kết thúc câu đơn
    /[,;:]\s+/g,
    /\s+/g
  ];
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

  if (best === -1) {
    best = Math.min(max, Math.max(min, target));
  }

  // Áp dụng bảo vệ cho vùng lâm sàng
  for (const range of protectedRanges) {
    if (best >= range.start && best <= range.end) {
      const distToStart = Math.abs(best - range.start);
      const distToEnd = Math.abs(best - range.end);
      if (distToStart < distToEnd) {
        if (range.start >= min && range.start <= max) {
          best = range.start;
        } else if (range.end >= min && range.end <= max) {
          best = range.end;
        } else {
          best = Math.min(max, Math.max(min, range.start));
        }
      } else {
        if (range.end >= min && range.end <= max) {
          best = range.end;
        } else if (range.start >= min && range.start <= max) {
          best = range.start;
        } else {
          best = Math.min(max, Math.max(min, range.end));
        }
      }
      break;
    }
  }

  return best;
};

export const splitTextIntoNaturalParts = (text: string, targetParts = 4, minPartChars = 350): string[] => {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= minPartChars || targetParts <= 1) return [clean];

  const protectedRanges = detectClinicalProtectedRanges(clean);
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
    const boundary = nearestNaturalBoundary(clean, target, min, max, protectedRanges);
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
