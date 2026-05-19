import { AppSettings, ProcessingController } from '../../types';
import {
  DEFAULT_GOOGLE_RPM_LIMIT,
  normalizeGoogleRpmLimit,
} from '../../utils/rateLimitSettings';

export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export interface RequestRateLimitOptions {
  enabled?: boolean;
  limitPerMinute?: number;
  label?: string;
}

export interface RequestRateLimitResult {
  waitedMs: number;
  limitPerMinute: number;
}

const waitWithController = async (ms: number, controller?: ProcessingController): Promise<void> => {
  let remaining = Math.max(0, ms);
  while (remaining > 0) {
    await controller?.waitIfPaused();
    const step = Math.min(250, remaining);
    await new Promise((resolve) => setTimeout(resolve, step));
    remaining -= step;
  }
};

export class RollingWindowRequestRateLimiter {
  private readonly windowMs: number;
  private readonly timestamps: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(windowMs: number = RATE_LIMIT_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  reset(): void {
    this.timestamps.length = 0;
    this.queue = Promise.resolve();
  }

  async waitForTurn(
    options?: RequestRateLimitOptions,
    controller?: ProcessingController
  ): Promise<RequestRateLimitResult> {
    const enabled = options?.enabled === true;
    const limitPerMinute = normalizeGoogleRpmLimit(options?.limitPerMinute);
    if (!enabled) {
      return { waitedMs: 0, limitPerMinute };
    }

    const startedAt = Date.now();
    const reservation = this.queue.then(() => this.reserveSlot(limitPerMinute, options?.label, controller));
    this.queue = reservation.then(undefined, () => undefined);
    await reservation;

    return {
      waitedMs: Math.max(0, Date.now() - startedAt),
      limitPerMinute,
    };
  }

  private async reserveSlot(
    limitPerMinute: number,
    label: string = 'Google/Gemini',
    controller?: ProcessingController
  ): Promise<void> {
    let loggedWait = false;

    while (true) {
      await controller?.waitIfPaused();
      const now = Date.now();
      this.pruneExpired(now);

      if (this.timestamps.length < limitPerMinute) {
        this.timestamps.push(now);
        return;
      }

      const nextSlotMs = Math.max(1, this.timestamps[0] + this.windowMs - now);
      if (!loggedWait) {
        console.log(`🛡️ Đang chờ RPM guard ${label}: còn khoảng ${Math.ceil(nextSlotMs / 1000)}s để giữ ≤ ${limitPerMinute} request/phút.`);
        loggedWait = true;
      }
      await waitWithController(nextSlotMs, controller);
    }
  }

  private pruneExpired(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }
}

export const googleRequestRateLimiter = new RollingWindowRequestRateLimiter();

export const getGoogleRequestRateLimitOptions = (
  settings: Pick<AppSettings, 'googleRpmLimiterEnabled' | 'googleRpmLimitPerMinute'>
): RequestRateLimitOptions => ({
  enabled: settings.googleRpmLimiterEnabled !== false,
  limitPerMinute: settings.googleRpmLimitPerMinute ?? DEFAULT_GOOGLE_RPM_LIMIT,
  label: 'Google/Gemini',
});

export const isGoogleRpmLimiterEnabled = (
  settings: Pick<AppSettings, 'googleRpmLimiterEnabled'>
): boolean => settings.googleRpmLimiterEnabled !== false;
