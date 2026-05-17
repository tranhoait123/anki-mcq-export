import { ProcessingController } from '../../types';
import { KeyHealthSnapshot, UserKeyRotator } from '../../utils/keyRotator';
import {
  getBackoffDelayMs,
  getRetryDecision,
  getRetryProfile,
  RetryProfile,
} from '../../utils/retryStrategy';
import { DEFAULT_GEMINI_MODEL } from '../../utils/models';
import { getRetryDelayMsFromError } from './providerErrors';
import { db } from '../db';

export const userKeyRotator = new UserKeyRotator();

export interface RetryAttemptContext {
  attempt: number;
  timeoutMs: number;
  signal: AbortSignal;
  keyNumber: number;
}

export interface RetryExecutionDiagnostics {
  attempts: number;
  distinctKeysTried: number;
  maxKeysPerOperation: number;
  lastKeyNumber: number;
  modelName: string;
  providerStatus?: number;
  retryAfterMs?: number;
  keyHealth: KeyHealthSnapshot[];
}

export const shouldRotateKey = ({
  cause,
  hadProviderPressure,
  distinctKeysTried,
  availableKeyCount,
  rotationLimit,
}: {
  cause: 'softRateLimit' | 'serverBusy' | 'format';
  hadProviderPressure: boolean;
  distinctKeysTried: number;
  availableKeyCount: number;
  rotationLimit: number;
}): boolean => {
  if (availableKeyCount <= 0) return false;
  if (distinctKeysTried >= rotationLimit) return false;

  if (cause === 'softRateLimit') {
    // 429: Lỗi quota theo key, cho phép xoay mạnh mẽ để tìm key rảnh.
    // Nếu dàn key lớn (ví dụ 31-50 key), cho phép xoay tối đa theo rotationLimit (thường là 8).
    if (hadProviderPressure && distinctKeysTried >= Math.max(2, Math.min(4, rotationLimit))) return false;
    return true;
  }

  if (cause === 'serverBusy') {
    // 503/Timeout: Lỗi hệ thống provider. 
    // Cho phép thử 15-20% dàn key (tối thiểu 2, tối đa 5) để tìm project/region không bị nghẽn.
    const busyRotationLimit = Math.max(2, Math.min(5, rotationLimit));
    return distinctKeysTried < busyRotationLimit;
  }

  return false;
};

const waitWithController = async (ms: number, controller?: ProcessingController): Promise<void> => {
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    await controller?.waitIfPaused();
    const step = Math.min(250, remaining);
    await new Promise((resolve) => setTimeout(resolve, step));
    remaining -= step;
  }
};

const createAttemptTimeoutError = (timeoutMs: number): Error & { status?: number; statusCode?: number; isRetryTimeout?: boolean } => {
  const error: Error & { status?: number; statusCode?: number; isRetryTimeout?: boolean } = new Error(
    `AI_REQUEST_TIMEOUT: Provider request exceeded ${Math.round(timeoutMs / 1000)}s and was aborted for retry.`
  );
  error.status = 504;
  error.statusCode = 504;
  error.isRetryTimeout = true;
  return error;
};

export async function executeWithRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const isFormatError = msg.includes("format") || msg.includes("json");
      const isServerBusy = msg.includes("503") || msg.includes("overloaded") || msg.includes("429");

      if (isFormatError || isServerBusy) {
        const attempt = i + 1;
        if (isFormatError && attempt >= 2) {
          console.info(`🚀 Standard Mode: Format error detected. Failing early to allow Advanced Retry...`);
          throw new Error("Lỗi định dạng AI (Lượt đầu). Vui lòng dùng tính năng Quét lại để chia nhỏ tài liệu.");
        }

        console.info(`${isFormatError ? 'Lỗi định dạng' : 'API Busy'} (Lượt đầu - Lần thử ${attempt}/${retries}). Retrying...`);
        await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, i)));
        continue;
      }
      throw error;
    }
  }
  throw new Error("🔄 Dịch vụ AI đang bận hoặc phản hồi sai định dạng sau nhiều lần thử. Vui lòng chờ 1-2 phút rồi thử lại, hoặc dùng nút 'Quét lại' để chia nhỏ tài liệu.");
}

export async function executeWithUserRotation<T>(
  initialModel: string,
  operation: (apiKey: string, modelName: string, context: RetryAttemptContext) => Promise<T>,
  startingKey?: string,
  fallbackModel: string = DEFAULT_GEMINI_MODEL,
  retryProfile: RetryProfile = getRetryProfile('normal'),
  controller?: ProcessingController
): Promise<T> {
  const ATTEMPTS_LIMIT = Math.max(retryProfile.minAttempts, retryProfile.minAttempts + retryProfile.attemptBuffer);
  let attempts = 0;
  let currentModel = initialModel;
  let currentKey = startingKey || userKeyRotator.selectBestKey();
  const keysTried = new Set<string>();
  const startedAt = Date.now();

  const getRemainingBudgetMs = () => retryProfile.maxElapsedMs - (Date.now() - startedAt);
  const getUntriedAvailableKey = () => userKeyRotator.selectBestKey({ excludeKeys: keysTried });
  const getRetriedAvailableKey = () => userKeyRotator.selectBestKey({ allowRetriedKeys: true });
  const getRotationLimit = () => userKeyRotator.getRecommendedRotationLimit();
  const getAttemptTimeoutMs = () => Math.max(1, Math.ceil(getRemainingBudgetMs()));
  const getDiagnostics = (attemptedKey: string, error?: any, retryAfterMs?: number): RetryExecutionDiagnostics => ({
    attempts,
    distinctKeysTried: keysTried.size,
    maxKeysPerOperation: userKeyRotator.getMaxKeysPerOperation(),
    lastKeyNumber: userKeyRotator.getKeyNumber(attemptedKey || currentKey),
    modelName: currentModel,
    providerStatus: error?.status || error?.statusCode,
    retryAfterMs,
    keyHealth: userKeyRotator.getKeyHealthSnapshot(),
  });
  const withDiagnostics = <E>(error: E, attemptedKey: string, retryAfterMs?: number): E => {
    if (error && typeof error === 'object') {
      try {
        (error as any).retryDiagnostics = getDiagnostics(attemptedKey, error, retryAfterMs);
      } catch {
        // Ignore non-extensible errors; the original error is still more useful.
      }
    }
    return error;
  };

  while (attempts < ATTEMPTS_LIMIT) {
    await controller?.waitIfPaused();

    if (getRemainingBudgetMs() <= 0) {
      throw withDiagnostics(new Error(`RETRY_BUDGET_EXHAUSTED: Dịch vụ AI vẫn bận sau ${Math.round(retryProfile.maxElapsedMs / 1000)}s. Batch này sẽ được đánh dấu để quét lại sau.`), currentKey);
    }

    if (currentKey && !userKeyRotator.isKeyAvailable(currentKey)) {
      // Chỉ tự động chọn key mới nếu chưa vượt quá giới hạn xoay key cho batch này
      if (keysTried.size < userKeyRotator.getRecommendedRotationLimit()) {
        currentKey = getUntriedAvailableKey();
      } else {
        currentKey = ''; // Buộc phải xuống logic đợi cooldown
      }
    }

    if (!currentKey && userKeyRotator.keyCount > 0) {
      const cooldownDelay = userKeyRotator.getNextCooldownDelayMs();
      if (cooldownDelay > 0) {
        const waitMs = Math.min(cooldownDelay, retryProfile.singleKeyBackoffCapMs, Math.max(250, getRemainingBudgetMs()));
        console.log(`⏳ All API keys are cooling down. Waiting ${Math.round(waitMs / 1000)}s before retrying.`);
        await waitWithController(waitMs, controller);
        const allowNewKey = keysTried.size < userKeyRotator.getRecommendedRotationLimit();
        currentKey = allowNewKey ? (getUntriedAvailableKey() || getRetriedAvailableKey()) : getRetriedAvailableKey();
        continue;
      }
      const allowNewKey = keysTried.size < userKeyRotator.getRecommendedRotationLimit();
      currentKey = allowNewKey ? (getUntriedAvailableKey() || getRetriedAvailableKey()) : getRetriedAvailableKey();
      if (!currentKey) {
        throw withDiagnostics(new Error(`RETRY_BUDGET_EXHAUSTED: Không còn API key khả dụng trong lượt thử hiện tại. Batch này sẽ được đánh dấu để quét lại sau.`), currentKey);
      }
    }

    attempts++;
    const attemptedKey = currentKey;
    const attemptTimeoutMs = getAttemptTimeoutMs();
    const attemptAbortController = new AbortController();
    const attemptContext: RetryAttemptContext = {
      attempt: attempts,
      timeoutMs: attemptTimeoutMs,
      signal: attemptAbortController.signal,
      keyNumber: userKeyRotator.getKeyNumber(attemptedKey),
    };
    if (attemptedKey) {
      keysTried.add(attemptedKey);
      userKeyRotator.markKeyInFlight(attemptedKey);
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const requestStart = Date.now();
    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          attemptAbortController.abort();
          reject(createAttemptTimeoutError(attemptTimeoutMs));
        }, attemptTimeoutMs);
      });
      const operationPromise = operation(attemptedKey, currentModel, attemptContext);
      const result = await Promise.race([operationPromise, timeoutPromise]);
      const elapsedTimeMs = Date.now() - requestStart;
      userKeyRotator.markKeyResult(attemptedKey, { kind: 'success', elapsedTimeMs });
      return result;
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      const retryHintMs = getRetryDelayMsFromError(error);
      if (retryHintMs && !error.retryAfterMs) error.retryAfterMs = retryHintMs;
      const decision = getRetryDecision(error, retryProfile, attempts);
      const getBoundedRetryHint = () => (
        retryHintMs
          ? Math.min(retryHintMs, retryProfile.singleKeyBackoffCapMs, Math.max(1000, getRemainingBudgetMs()))
          : undefined
      );

      if (decision.action === 'split') {
        if (decision.cause === 'requestTooLarge') {
          console.info(`📦 Request quá lớn ở lần ${attempts}; dừng retry cùng payload để chia nhỏ batch.`);
          throw withDiagnostics(new Error("AI_FORMAT_ERROR_REQUEST_TOO_LARGE"), attemptedKey, retryHintMs);
        }
        console.info(`🚀 ${decision.message} Failing fast after ${attempts} attempt(s) to trigger subdivision...`);
        throw withDiagnostics(new Error("AI_FORMAT_ERROR_TRUNCATED"), attemptedKey, retryHintMs);
      }

      if (decision.action === 'fail') {
        if (decision.cause === 'auth') {
          if (msg.includes("openrouter api error") || msg.includes("shopaikey api error")) {
            throw withDiagnostics(error, attemptedKey, retryHintMs);
          }
          console.warn(`🚫 Auth/Invalid Key detected! Key #${userKeyRotator.getKeyNumber(attemptedKey)} is blocked temporarily. Rotating IMMEDIATELY...`);
          userKeyRotator.markKeyResult(attemptedKey, { kind: 'auth', error });
          if (userKeyRotator.availableKeyCount > 0) {
            currentKey = getUntriedAvailableKey() || getRetriedAvailableKey();
            continue;
          }
          throw withDiagnostics(new Error(`API Key hoặc Token bị từ chối truy cập (403/Invalid). Vui lòng vào Cài đặt kiểm tra lại (Có thể Key hết hạn hoặc sai).`), attemptedKey, retryHintMs);
        }

        if (decision.cause === 'hardQuota') {
          console.warn(`🧱 Hard quota/billing limit detected on key #${userKeyRotator.getKeyNumber(attemptedKey)}. Avoiding same-key retry.`);
          userKeyRotator.markKeyResult(attemptedKey, { kind: 'quota', durationMs: retryHintMs, error });
          if (userKeyRotator.availableKeyCount > 0) {
            currentKey = getUntriedAvailableKey() || getRetriedAvailableKey();
            continue;
          }
          throw withDiagnostics(new Error("AI_HARD_QUOTA_EXHAUSTED: Hết quota/billing hoặc free-tier cho key hiện tại. Batch này được giữ lại để quét sau khi đổi/thêm key."), attemptedKey, retryHintMs);
        }

        if (decision.cause === 'fatal' && (msg.includes('400') || msg.includes('invalid_argument'))) {
          userKeyRotator.markKeyResult(attemptedKey, { kind: 'suspect', durationMs: 30 * 1000, error });
        }
        throw withDiagnostics(error, attemptedKey, retryHintMs);
      }

      if (decision.action === 'retry') {
        if (decision.shouldTryFallbackModel && currentModel !== fallbackModel) {
          console.log(`🚀 Switching to STABLE FALLBACK MODEL after transient failures: ${fallbackModel}`);
          currentModel = fallbackModel;
        }

        const reason = decision.cause === 'softRateLimit'
          ? "Giới hạn tốc độ/quota tạm thời"
          : (decision.cause === 'serverBusy' ? "Server quá tải/timeout" : "Lỗi định dạng AI");
        console.info(`${reason} (Lần thử ${attempts}/${ATTEMPTS_LIMIT}). ${decision.message}`);

        const boundedHint = getBoundedRetryHint();
        const isServerBusyRetry = decision.cause === 'serverBusy';
        const isSoftRateLimitRetry = decision.cause === 'softRateLimit';
        const isFormatRetry = decision.cause === 'format';
        const shouldHonorProviderDelay = isSoftRateLimitRetry || isServerBusyRetry;
        const hadProviderPressureBeforeRateLimit = isSoftRateLimitRetry
          ? userKeyRotator.hasRecentProviderPressure()
          : false;
        let backoffMs = boundedHint && shouldHonorProviderDelay
          ? boundedHint
          : getBackoffDelayMs(
              retryProfile,
              attempts,
              Math.max(0, attempts - 1),
              isServerBusyRetry,
              isSoftRateLimitRetry,
              isFormatRetry,
              false
            );

        if (isSoftRateLimitRetry) {
          const individualCooldownMs = Math.max(45 * 1000, backoffMs);
          if (hadProviderPressureBeforeRateLimit) {
            // Khi đã có dấu hiệu nghẽn toàn provider, coi 429 tiếp theo là áp lực hệ thống
            // thay vì lần lượt đưa mọi key khỏe vào cooldown.
            userKeyRotator.markSoftRateLimit(individualCooldownMs);
          } else {
            // 429 đầu tiên vẫn có thể là quota theo key, nên khóa key đó.
            userKeyRotator.markKeyResult(attemptedKey, { kind: 'rateLimit', durationMs: individualCooldownMs, error });
          }

          if (shouldRotateKey({
            cause: 'softRateLimit',
            hadProviderPressure: userKeyRotator.hasRecentProviderPressure(),
            distinctKeysTried: keysTried.size,
            availableKeyCount: userKeyRotator.availableKeyCount,
            rotationLimit: getRotationLimit(),
          })) {
            const nextKey = getUntriedAvailableKey();
            if (nextKey) {
              currentKey = nextKey;
              backoffMs = Math.max(250, getBackoffDelayMs(retryProfile, 1, 0, false, false, false, true));
              console.log(`⚡ Rate Limit: Xoay sang API Key dự phòng: #${userKeyRotator.getKeyNumber(currentKey)}`);
            } else {
              currentKey = '';
            }
          } else {
            // Nếu không xoay key, hãy giữ nguyên key hiện tại để retry sau backoff. 
            // Việc gán '' sẽ khiến loop chọn key mới (không mong muốn khi đang gồng áp lực).
            currentKey = attemptedKey;
            backoffMs = Math.max(backoffMs, Math.min(
              individualCooldownMs,
              retryProfile.singleKeyBackoffCapMs,
              Math.max(250, getRemainingBudgetMs())
            ));
          }
        } else if (isServerBusyRetry) {
          userKeyRotator.markProviderPressure(backoffMs);

          if (shouldRotateKey({
            cause: 'serverBusy',
            hadProviderPressure: true,
            distinctKeysTried: keysTried.size,
            availableKeyCount: userKeyRotator.availableKeyCount,
            rotationLimit: getRotationLimit(),
          })) {
            const nextKey = getUntriedAvailableKey();
            if (nextKey) {
              currentKey = nextKey;
              // Khi có key mới, dùng backoff ngắn (jitter) để thử nhanh
              backoffMs = Math.max(250, getBackoffDelayMs(retryProfile, 1, 0, false, false, false, true));
              console.log(`🔄 Server Busy: Thử xoay sang API Key dự phòng: #${userKeyRotator.getKeyNumber(currentKey)}`);
            } else {
              // Hết key sạch thì đứng yên tại key cũ và chờ backoff dài
              currentKey = attemptedKey;
            }
          } else {
            // Đã thử đủ số key giới hạn, giữ nguyên key hiện tại để chờ server hồi phục
            currentKey = attemptedKey;
          }
        } else {
          const cooldownDelay = userKeyRotator.getNextCooldownDelayMs();
          if (cooldownDelay > 0) {
            backoffMs = Math.min(cooldownDelay, retryProfile.singleKeyBackoffCapMs, Math.max(250, getRemainingBudgetMs()));
            await waitWithController(backoffMs, controller);
            currentKey = getUntriedAvailableKey() || getRetriedAvailableKey();
            continue;
          } else {
            backoffMs = Math.min(
              retryProfile.singleKeyBackoffCapMs,
              getBackoffDelayMs(retryProfile, attempts, attempts - 1, isServerBusyRetry, isSoftRateLimitRetry, isFormatRetry, false)
            );
          }
        }

        backoffMs = Math.min(backoffMs, Math.max(250, getRemainingBudgetMs()));
        console.log(`⏳ Backoff: ${Math.round(backoffMs / 1000)}s (Key #${userKeyRotator.getKeyNumber(currentKey)}/${userKeyRotator.keyCount}, Distinct tried: ${keysTried.size}/${userKeyRotator.getMaxKeysPerOperation() || 1})`);
        await waitWithController(backoffMs, controller);
        continue;
      }
      throw withDiagnostics(error, attemptedKey, retryHintMs);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      attemptAbortController.abort();
      if (attemptedKey) {
        userKeyRotator.releaseKeyInFlight(attemptedKey);
        // Lưu trạng thái sức khỏe key sau mỗi lần thử để đảm bảo tính kiên định giữa các lần reload
        db.saveKeyHealth(userKeyRotator.exportHealthState()).catch(err =>
          console.error('Failed to persist key health:', err)
        );
      }
    }
  }
  throw withDiagnostics(new Error(`Dịch vụ AI đang bận hoặc quá tải sau ${ATTEMPTS_LIMIT} lần thử. Vui lòng chờ 1-2 phút rồi thử lại.`), currentKey);
}
