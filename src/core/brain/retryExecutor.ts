import { ProcessingController } from '../../types';
import { UserKeyRotator } from '../../utils/keyRotator';
import {
  getBackoffDelayMs,
  getRetryDecision,
  getRetryProfile,
  RetryProfile,
} from '../../utils/retryStrategy';
import { DEFAULT_GEMINI_MODEL } from '../../utils/models';
import { getRetryDelayMsFromError } from './providerErrors';

export const userKeyRotator = new UserKeyRotator();

const waitWithController = async (ms: number, controller?: ProcessingController): Promise<void> => {
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    await controller?.waitIfPaused();
    const step = Math.min(250, remaining);
    await new Promise((resolve) => setTimeout(resolve, step));
    remaining -= step;
  }
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
          console.warn(`🚀 Standard Mode: Format error detected. Failing early to allow Advanced Retry...`);
          throw new Error("Lỗi định dạng AI (Lượt đầu). Vui lòng dùng tính năng Quét lại để chia nhỏ tài liệu.");
        }

        console.warn(`⚠️ ${isFormatError ? 'Lỗi định dạng' : 'API Busy'} (Lượt đầu - Lần thử ${attempt}/${retries}). Retrying...`);
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
  operation: (apiKey: string, modelName: string) => Promise<T>,
  startingKey?: string,
  fallbackModel: string = DEFAULT_GEMINI_MODEL,
  retryProfile: RetryProfile = getRetryProfile('normal'),
  controller?: ProcessingController
): Promise<T> {
  const ATTEMPTS_LIMIT = Math.max(retryProfile.minAttempts, retryProfile.minAttempts + retryProfile.attemptBuffer);
  let attempts = 0;
  let currentModel = initialModel;
  let currentKey = startingKey || userKeyRotator.getCurrentKey();
  const keysTried = new Set<string>();
  const sameKeySoftRateLimitRetries = new Map<string, number>();
  const startedAt = Date.now();

  const getRemainingBudgetMs = () => retryProfile.maxElapsedMs - (Date.now() - startedAt);

  while (attempts < ATTEMPTS_LIMIT) {
    await controller?.waitIfPaused();

    if (getRemainingBudgetMs() <= 0) {
      throw new Error(`RETRY_BUDGET_EXHAUSTED: Dịch vụ AI vẫn bận sau ${Math.round(retryProfile.maxElapsedMs / 1000)}s. Batch này sẽ được đánh dấu để quét lại sau.`);
    }

    if (!currentKey && userKeyRotator.keyCount > 0) {
      const cooldownDelay = userKeyRotator.getNextCooldownDelayMs();
      if (cooldownDelay > 0) {
        const waitMs = Math.min(cooldownDelay, retryProfile.singleKeyBackoffCapMs, Math.max(250, getRemainingBudgetMs()));
        console.log(`⏳ All API keys are cooling down. Waiting ${Math.round(waitMs / 1000)}s before retrying.`);
        await waitWithController(waitMs, controller);
        currentKey = userKeyRotator.getKeyForBatch() || userKeyRotator.getCurrentKey();
        continue;
      }
    }

    attempts++;
    if (currentKey) keysTried.add(currentKey);

    try {
      const result = await operation(currentKey, currentModel);
      userKeyRotator.reportSuccess(currentKey);
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
          console.warn(`📦 Request quá lớn ở lần ${attempts}; dừng retry cùng payload để chia nhỏ batch.`);
          throw new Error("AI_FORMAT_ERROR_REQUEST_TOO_LARGE");
        }
        console.warn(`🚀 ${decision.message} Failing fast after ${attempts} attempt(s) to trigger subdivision...`);
        throw new Error("AI_FORMAT_ERROR_TRUNCATED");
      }

      if (decision.action === 'fail') {
        if (decision.cause === 'auth') {
          if (msg.includes("openrouter api error") || msg.includes("shopaikey api error")) {
            throw error;
          }
          console.warn(`🚫 Auth/Invalid Key detected! Key #${userKeyRotator.getKeyNumber(currentKey)} is broken. Rotating IMMEDIATELY...`);
          userKeyRotator.markKeyFailed(currentKey);
          if (userKeyRotator.availableKeyCount > 0) {
            currentKey = userKeyRotator.rotate();
            continue;
          }
          throw new Error(`API Key hoặc Token bị từ chối truy cập (403/Invalid). Vui lòng vào Cài đặt kiểm tra lại (Có thể Key hết hạn hoặc sai).`);
        }

        if (decision.cause === 'hardQuota') {
          console.warn(`🧱 Hard quota/billing limit detected on key #${userKeyRotator.getKeyNumber(currentKey)}. Avoiding same-key retry.`);
          userKeyRotator.markKeyCooldown(currentKey, 'rateLimit', retryHintMs || retryProfile.singleKeyBackoffCapMs);
          if (userKeyRotator.availableKeyCount > 0) {
            currentKey = userKeyRotator.rotate();
            continue;
          }
          throw new Error("AI_HARD_QUOTA_EXHAUSTED: Hết quota/billing hoặc free-tier cho key hiện tại. Batch này được giữ lại để quét sau khi đổi/thêm key.");
        }

        throw error;
      }

      if (decision.action === 'retry') {
        if (decision.shouldTryFallbackModel && currentModel !== fallbackModel) {
          console.log(`🚀 Switching to STABLE FALLBACK MODEL after transient failures: ${fallbackModel}`);
          currentModel = fallbackModel;
        }

        const reason = decision.cause === 'softRateLimit'
          ? "Giới hạn tốc độ/quota tạm thời"
          : (decision.cause === 'serverBusy' ? "Server quá tải/timeout" : "Lỗi định dạng AI");
        console.warn(`⚠️ ${reason} (Lần thử ${attempts}/${ATTEMPTS_LIMIT}). ${decision.message}`);

        const boundedHint = getBoundedRetryHint();
        const isServerBusyRetry = decision.cause === 'serverBusy';
        const isSoftRateLimitRetry = decision.cause === 'softRateLimit';
        const isFormatRetry = decision.cause === 'format';
        const shouldHonorProviderDelay = isSoftRateLimitRetry || isServerBusyRetry;
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
          // Tạm khóa key cụ thể vừa dính lỗi 429 để các luồng song song khác bỏ qua nó.
          // Ưu tiên thời gian chờ tối thiểu 45s để đảm bảo key qua chu kỳ giới hạn của Gemini.
          const individualCooldownMs = Math.max(45 * 1000, backoffMs);
          userKeyRotator.markKeyCooldown(currentKey, 'rateLimit', individualCooldownMs);

          const sameKeyRetries = sameKeySoftRateLimitRetries.get(currentKey) || 0;
          sameKeySoftRateLimitRetries.set(currentKey, sameKeyRetries + 1);

          // Nếu còn bất kỳ key dự phòng rảnh rỗi nào, XOAY NGAY LẬP TỨC mà không cần đợi thử lại lần 2.
          const canTryBackupKey = (
            userKeyRotator.availableKeyCount > 0 &&
            keysTried.size < userKeyRotator.getMaxKeysPerOperation()
          );

          if (canTryBackupKey) {
            const nextKey = userKeyRotator.rotate();
            if (nextKey) {
              currentKey = nextKey;
              // Vì đã đổi sang key mới lành lặn, giảm thời gian chờ (backoff) xuống tối thiểu để thực hiện yêu cầu ngay.
              backoffMs = Math.max(250, getBackoffDelayMs(retryProfile, 1, 0, false, false, false, true));
              console.log(`⚡ Xoay sang API Key dự phòng tươi mới: #${userKeyRotator.getKeyNumber(currentKey)}`);
            }
          }
        } else if (isServerBusyRetry) {
          userKeyRotator.markProviderPressure(backoffMs);
        } else {
          const cooldownDelay = userKeyRotator.getNextCooldownDelayMs();
          if (cooldownDelay > 0) {
            backoffMs = Math.min(cooldownDelay, retryProfile.singleKeyBackoffCapMs, Math.max(250, getRemainingBudgetMs()));
            await waitWithController(backoffMs, controller);
            currentKey = userKeyRotator.getKeyForBatch() || userKeyRotator.getCurrentKey();
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
      throw error;
    }
  }
  throw new Error(`Dịch vụ AI đang bận hoặc quá tải sau ${ATTEMPTS_LIMIT} lần thử. Vui lòng chờ 1-2 phút rồi thử lại.`);
}
