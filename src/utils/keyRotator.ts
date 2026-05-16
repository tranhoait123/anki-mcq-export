export type KeyCooldownKind = 'rateLimit' | 'serverBusy';

export type KeyHealthStatus =
  | 'healthy'
  | 'cooldown'
  | 'authBlocked'
  | 'quotaBlocked'
  | 'suspect'
  | 'providerPressure';

export type KeyResultKind = 'success' | 'rateLimit' | 'quota' | 'auth' | 'suspect' | 'serverBusy';

export interface KeySelectionOptions {
  excludeKeys?: Iterable<string>;
  allowRetriedKeys?: boolean;
}

export interface KeyResult {
  kind: KeyResultKind;
  durationMs?: number;
  error?: any;
  permanent?: boolean;
}

export interface KeyHealthSnapshot {
  keyNumber: number;
  status: KeyHealthStatus;
  remainingMs: number;
  inFlightCount: number;
  failureCount: number;
  successCount: number;
  authStrikeCount: number;
  quotaStrikeCount: number;
  rateLimitStrikeCount: number;
  suspectStrikeCount: number;
  lastUsedAt: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  lastError?: string;
}

interface KeyHealthRecord {
  status: KeyHealthStatus;
  blockedUntil: number;
  inFlightCount: number;
  failureCount: number;
  successCount: number;
  authStrikeCount: number;
  quotaStrikeCount: number;
  rateLimitStrikeCount: number;
  suspectStrikeCount: number;
  lastSelectedAt: number;
  lastUsedAt: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  lastError?: string;
}

const RATE_LIMIT_MIN_MS = 45 * 1000;
const RATE_LIMIT_DEFAULT_MS = 3 * 60 * 1000;
const RATE_LIMIT_MAX_MS = 5 * 60 * 1000;
const AUTH_BLOCK_BASE_MS = 15 * 60 * 1000;
const AUTH_BLOCK_MAX_MS = 60 * 60 * 1000;
const QUOTA_BLOCK_BASE_MS = 30 * 60 * 1000;
const QUOTA_BLOCK_MAX_MS = 6 * 60 * 60 * 1000;
const SUSPECT_BLOCK_MS = 30 * 1000;
const SUSPECT_BLOCK_MAX_MS = 2 * 60 * 1000;
const PRESSURE_WINDOW_MS = 45 * 1000;
const FAILURE_SCORE_WINDOW_MS = 10 * 60 * 1000;
const MAX_KEYS_PER_OPERATION = 8;

const createKeyHealthRecord = (): KeyHealthRecord => ({
  status: 'healthy',
  blockedUntil: 0,
  inFlightCount: 0,
  failureCount: 0,
  successCount: 0,
  authStrikeCount: 0,
  quotaStrikeCount: 0,
  rateLimitStrikeCount: 0,
  suspectStrikeCount: 0,
  lastSelectedAt: 0,
  lastUsedAt: 0,
  lastSuccessAt: 0,
  lastFailureAt: 0,
});

const getErrorText = (error: any): string => {
  const text = error?.message || String(error || '');
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
};

const isPermanentAuthError = (error: any): boolean => {
  const text = getErrorText(error).toLowerCase();
  return (
    text.includes('api_key_invalid') ||
    text.includes('api key invalid') ||
    text.includes('invalid api key') ||
    text.includes('api-key invalid') ||
    text.includes('api key not valid') ||
    text.includes('api-key not valid') ||
    text.includes('key not valid') ||
    text.includes('reported as leaked') ||
    text.includes('known leaked')
  );
};

const clampDuration = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

export class UserKeyRotator {
  private keys: string[] = [];
  private currentIndex = 0;
  private keyHealth: Map<string, KeyHealthRecord> = new Map();
  private desiredConcurrency = 1;
  private recommendedConcurrency = 1;
  private pressureStreak = 0;
  private successStreak = 0;
  private lastPressureAt = 0;
  private globalCooldownUntil = 0;
  private now: () => number;
  private random: () => number;

  constructor(now: () => number = () => Date.now(), random: () => number = () => Math.random()) {
    this.now = now;
    this.random = random;
  }

  init(apiKeyString: string, desiredConcurrency: number = 1) {
    this.desiredConcurrency = Math.max(1, desiredConcurrency || 1);
    this.resetState();

    if (!apiKeyString || typeof apiKeyString !== 'string') {
      this.recommendedConcurrency = this.desiredConcurrency;
      return;
    }

    const seenKeys = new Set<string>();
    const parts = apiKeyString.split(/[,;\n\r]+/);
    this.keys = parts
      .map(k => k.trim())
      .filter(k => {
        if (k.length <= 5 || seenKeys.has(k)) return false;
        seenKeys.add(k);
        return true;
      });
    this.keys.forEach(key => this.keyHealth.set(key, createKeyHealthRecord()));
    this.recommendedConcurrency = this.getMaxUsefulConcurrency();
    console.log(`🔑 Loaded ${this.keys.length} API Keys.`);
  }

  setDesiredConcurrency(limit: number): void {
    this.desiredConcurrency = Math.max(1, limit || 1);
    this.recommendedConcurrency = Math.min(
      Math.max(1, this.recommendedConcurrency || 1),
      this.getMaxUsefulConcurrency()
    );
  }

  getCurrentKey(excludeKeys?: Iterable<string>): string {
    return this.selectBestKey({ excludeKeys });
  }

  rotate(excludeKeys?: Iterable<string>): string {
    const key = this.selectBestKey({ excludeKeys });
    if (key) console.log(`🔄 Rotating to API Key #${this.getKeyNumber(key)}/${this.keys.length}`);
    return key;
  }

  reportSuccess(key: string): void {
    this.markKeyResult(key, { kind: 'success' });
  }

  markKeyFailed(key: string): void {
    this.markKeyResult(key, { kind: 'auth' });
  }

  markKeyCooldown(key: string, kind: KeyCooldownKind, durationMs?: number): void {
    if (kind === 'serverBusy') {
      this.markProviderPressure(durationMs);
      return;
    }
    this.markKeyResult(key, { kind: 'rateLimit', durationMs });
  }

  markSoftRateLimit(durationMs?: number): void {
    const now = this.now();
    const boundedDurationMs = Math.max(1000, Math.min(durationMs ?? 8000, 60 * 1000));
    this.registerPressure('rateLimit', boundedDurationMs, true);
    this.globalCooldownUntil = Math.max(this.globalCooldownUntil, now + boundedDurationMs);
    console.info(`Provider rate-limit cooldown for ${Math.round(boundedDurationMs / 1000)}s. Keys stay available; concurrency is ${this.recommendedConcurrency}/${this.getMaxUsefulConcurrency()}.`);
  }

  markProviderPressure(durationMs?: number): void {
    const now = this.now();
    const nextStreak = now - this.lastPressureAt <= PRESSURE_WINDOW_MS ? this.pressureStreak + 1 : 1;
    const escalatedMs = Math.min(30 * 1000, 3000 + Math.max(0, nextStreak - 1) * 5000);
    const boundedDurationMs = Math.max(1000, Math.min(durationMs ?? escalatedMs, 30 * 1000));
    this.registerPressure('serverBusy', boundedDurationMs);
    this.globalCooldownUntil = Math.max(this.globalCooldownUntil, now + boundedDurationMs);
    console.info(`Provider pressure cooldown for ${Math.round(boundedDurationMs / 1000)}s. Keys stay available; concurrency is ${this.recommendedConcurrency}/${this.getMaxUsefulConcurrency()}.`);
  }

  getKeyForBatch(excludeKeys?: Iterable<string>): string {
    return this.selectBestKey({ excludeKeys });
  }

  selectBestKey(options: KeySelectionOptions = {}): string {
    if (this.keys.length === 0) return '';
    const now = this.now();
    this.normalizeAllKeyStates(now);
    if (this.globalCooldownUntil > now && this.pressureStreak >= 3) return '';

    const excluded = this.getExcludedKeySet(options.excludeKeys);
    const candidates = this.keys
      .map((key, index) => ({ key, index, record: this.getOrCreateRecord(key) }))
      .filter(({ key, record }) => (
        record.status === 'healthy' &&
        (options.allowRetriedKeys || !excluded.has(key))
      ))
      .map(candidate => ({
        ...candidate,
        score: this.getSelectionScore(candidate.record, now),
      }))
      .sort((left, right) => (right.score - left.score) || (left.index - right.index));

    const selected = candidates[0]?.key || '';
    if (!selected) return '';

    const record = this.getOrCreateRecord(selected);
    record.lastSelectedAt = now;
    const keyIndex = this.keys.indexOf(selected);
    if (keyIndex >= 0) this.currentIndex = keyIndex;
    return selected;
  }

  markKeyInFlight(key: string): void {
    if (!key || !this.keys.includes(key)) return;
    const now = this.now();
    const record = this.getOrCreateRecord(key);
    this.normalizeKeyState(key, now);
    record.inFlightCount++;
    record.lastSelectedAt = now;
    record.lastUsedAt = now;
  }

  releaseKeyInFlight(key: string): void {
    if (!key || !this.keys.includes(key)) return;
    const record = this.getOrCreateRecord(key);
    record.inFlightCount = Math.max(0, record.inFlightCount - 1);
  }

  markKeyResult(key: string, result: KeyResult): void {
    if (!key || !this.keys.includes(key)) return;
    if (result.kind === 'serverBusy') {
      this.markProviderPressure(result.durationMs);
      return;
    }

    const now = this.now();
    const record = this.getOrCreateRecord(key);
    this.normalizeKeyState(key, now);

    if (result.kind === 'success') {
      record.status = 'healthy';
      record.blockedUntil = 0;
      record.successCount++;
      record.failureCount = Math.max(0, record.failureCount - 1);
      record.rateLimitStrikeCount = Math.max(0, record.rateLimitStrikeCount - 1);
      record.suspectStrikeCount = Math.max(0, record.suspectStrikeCount - 1);
      record.lastSuccessAt = now;
      record.lastError = undefined;
      this.registerSuccess();
      return;
    }

    record.failureCount++;
    record.lastFailureAt = now;
    record.lastError = getErrorText(result.error);
    this.successStreak = 0;

    if (result.kind === 'rateLimit') {
      record.rateLimitStrikeCount++;
      const durationMs = clampDuration(result.durationMs ?? RATE_LIMIT_DEFAULT_MS, RATE_LIMIT_MIN_MS, RATE_LIMIT_MAX_MS);
      this.blockKey(key, record, 'cooldown', durationMs);
      this.registerPressure('rateLimit', durationMs);
      console.warn(`⏸️ API Key #${this.getKeyNumber(key)} cooling down for ${Math.round(durationMs / 1000)}s (rateLimit). ${this.availableKeyCount} keys available now.`);
      return;
    }

    if (result.kind === 'quota') {
      record.quotaStrikeCount++;
      const escalatedMs = QUOTA_BLOCK_BASE_MS * Math.pow(2, Math.max(0, record.quotaStrikeCount - 1));
      const durationMs = clampDuration(result.durationMs ?? escalatedMs, QUOTA_BLOCK_BASE_MS, QUOTA_BLOCK_MAX_MS);
      this.blockKey(key, record, 'quotaBlocked', durationMs);
      this.registerPressure('rateLimit', Math.min(durationMs, 30 * 1000));
      console.warn(`🧱 API Key #${this.getKeyNumber(key)} quota-blocked for ${Math.round(durationMs / 60000)}m. ${this.availableKeyCount} keys available now.`);
      return;
    }

    if (result.kind === 'auth') {
      record.authStrikeCount++;
      const isPermanent = result.permanent ?? isPermanentAuthError(result.error);
      const durationMs = isPermanent
        ? Number.POSITIVE_INFINITY
        : clampDuration(result.durationMs ?? AUTH_BLOCK_BASE_MS * record.authStrikeCount, AUTH_BLOCK_BASE_MS, AUTH_BLOCK_MAX_MS);
      this.blockKey(key, record, 'authBlocked', durationMs);
      this.recommendedConcurrency = Math.min(this.recommendedConcurrency, this.getMaxUsefulConcurrency());
      if (isPermanent) {
        console.warn(`🚫 API Key #${this.getKeyNumber(key)} auth-blocked until it is replaced. ${this.availableKeyCount} keys available now.`);
      } else {
        console.warn(`🚫 API Key #${this.getKeyNumber(key)} auth-blocked for ${Math.round(durationMs / 60000)}m. ${this.availableKeyCount} keys available now.`);
      }
      return;
    }

    if (result.kind === 'suspect') {
      record.suspectStrikeCount++;
      const durationMs = clampDuration(result.durationMs ?? SUSPECT_BLOCK_MS, SUSPECT_BLOCK_MS, SUSPECT_BLOCK_MAX_MS);
      this.blockKey(key, record, 'suspect', durationMs);
      console.warn(`🟡 API Key #${this.getKeyNumber(key)} marked suspect for ${Math.round(durationMs / 1000)}s. ${this.availableKeyCount} keys available now.`);
    }
  }

  getRecommendedConcurrency(limit?: number): number {
    if (typeof limit === 'number' && limit > 0) {
      this.setDesiredConcurrency(limit);
    }
    this.normalizeAllKeyStates();
    return Math.max(1, Math.min(this.recommendedConcurrency, this.getMaxUsefulConcurrency()));
  }

  isKeyAvailable(key: string): boolean {
    if (!key) return false;
    this.normalizeKeyState(key);
    return this.getOrCreateRecord(key).status === 'healthy';
  }

  getNextCooldownDelayMs(): number {
    const now = this.now();
    this.normalizeAllKeyStates(now);
    const globalDelay = this.globalCooldownUntil > now ? this.globalCooldownUntil - now : 0;
    const waits = this.keys
      .map(key => this.getOrCreateRecord(key).blockedUntil - now)
      .filter(delay => Number.isFinite(delay) && delay > 0);
    if (globalDelay > 0) waits.push(globalDelay);
    return waits.length > 0 ? Math.min(...waits) : 0;
  }

  getKeyNumber(key: string): number {
    const index = this.keys.indexOf(key);
    return index >= 0 ? index + 1 : 0;
  }

  get keyCount(): number {
    return this.keys.length;
  }

  get availableKeyCount(): number {
    return this.getAvailableKeys().length;
  }

  get hardFailedKeyCount(): number {
    this.normalizeAllKeyStates();
    return this.keys.filter(key => this.getOrCreateRecord(key).status === 'authBlocked').length;
  }

  getKeyIndex(): number {
    return this.currentIndex;
  }

  getMaxKeysPerOperation(): number {
    if (this.keys.length <= 0) return 0;
    return Math.max(1, Math.min(MAX_KEYS_PER_OPERATION, this.keys.length));
  }

  getRecommendedRotationLimit(): number {
    const total = this.keys.length;
    if (total <= 1) return 1;
    if (total <= 3) return 2;
    if (total <= 8) return 3;
    // Với số lượng lớn key (ví dụ 31), cho phép xoay khoảng 25-30% tổng số key (tối đa 8).
    return Math.max(3, Math.min(MAX_KEYS_PER_OPERATION, Math.ceil(total * 0.25)));
  }

  getKeyHealthSnapshot(): KeyHealthSnapshot[] {
    const now = this.now();
    this.normalizeAllKeyStates(now);
    return this.keys.map(key => {
      const record = this.getOrCreateRecord(key);
      return {
        keyNumber: this.getKeyNumber(key),
        status: record.status,
        remainingMs: Math.max(0, record.blockedUntil - now),
        inFlightCount: record.inFlightCount,
        failureCount: record.failureCount,
        successCount: record.successCount,
        authStrikeCount: record.authStrikeCount,
        quotaStrikeCount: record.quotaStrikeCount,
        rateLimitStrikeCount: record.rateLimitStrikeCount,
        suspectStrikeCount: record.suspectStrikeCount,
        lastUsedAt: record.lastUsedAt,
        lastSuccessAt: record.lastSuccessAt,
        lastFailureAt: record.lastFailureAt,
        lastError: record.lastError,
      };
    });
  }

  hasRecentProviderPressure(windowMs: number = 30 * 1000): boolean {
    const now = this.now();
    return this.globalCooldownUntil > now || (this.lastPressureAt > 0 && now - this.lastPressureAt <= windowMs && this.pressureStreak > 0);
  }

  private resetState(): void {
    this.keys = [];
    this.currentIndex = 0;
    this.keyHealth.clear();
    this.pressureStreak = 0;
    this.successStreak = 0;
    this.lastPressureAt = 0;
    this.globalCooldownUntil = 0;
  }

  private getAvailableKeys(excludeKeys?: Iterable<string>): string[] {
    const excluded = this.getExcludedKeySet(excludeKeys);
    return this.keys.filter(key => this.isKeyAvailable(key) && !excluded.has(key));
  }

  private getExcludedKeySet(excludeKeys?: Iterable<string>): Set<string> {
    return excludeKeys instanceof Set ? excludeKeys : new Set(excludeKeys || []);
  }

  private getOrCreateRecord(key: string): KeyHealthRecord {
    let record = this.keyHealth.get(key);
    if (!record) {
      record = createKeyHealthRecord();
      this.keyHealth.set(key, record);
    }
    return record;
  }

  private normalizeAllKeyStates(now: number = this.now()): void {
    this.keys.forEach(key => this.normalizeKeyState(key, now));
    if (this.globalCooldownUntil > 0 && this.globalCooldownUntil <= now) {
      this.globalCooldownUntil = 0;
    }
  }

  private normalizeKeyState(key: string, now: number = this.now()): void {
    if (!key || !this.keys.includes(key)) return;
    const record = this.getOrCreateRecord(key);
    if (record.status !== 'healthy' && record.blockedUntil > 0 && record.blockedUntil <= now) {
      record.status = 'healthy';
      record.blockedUntil = 0;
    }
  }

  private blockKey(key: string, record: KeyHealthRecord, status: KeyHealthStatus, durationMs: number): void {
    const now = this.now();
    record.status = status;
    record.blockedUntil = Math.max(record.blockedUntil, now + durationMs);
  }

  private registerSuccess(): void {
    const now = this.now();
    if (this.globalCooldownUntil > 0 && this.globalCooldownUntil <= now) {
      this.globalCooldownUntil = 0;
    }
    if (now - this.lastPressureAt > 60 * 1000) {
      this.pressureStreak = 0;
    }

    this.successStreak++;
    const maxUsefulConcurrency = this.getMaxUsefulConcurrency();
    const recoveryThreshold = Math.max(4, this.recommendedConcurrency * 3);
    if (this.successStreak >= recoveryThreshold && this.recommendedConcurrency < maxUsefulConcurrency) {
      this.recommendedConcurrency++;
      this.successStreak = 0;
      console.log(`📈 Adaptive concurrency recovered to ${this.recommendedConcurrency}/${maxUsefulConcurrency}.`);
    }
  }

  private getSelectionScore(record: KeyHealthRecord, now: number): number {
    const lastActivityAt = Math.max(record.lastSelectedAt, record.lastUsedAt);
    const idleBonus = lastActivityAt > 0 ? Math.min(300, (now - lastActivityAt) / 1000) : 300;
    const recentFailurePenalty = record.lastFailureAt > 0 && now - record.lastFailureAt <= FAILURE_SCORE_WINDOW_MS
      ? Math.min(500, record.failureCount * 45 + record.rateLimitStrikeCount * 30 + record.quotaStrikeCount * 60 + record.authStrikeCount * 80)
      : 0;
    const successBonus = record.lastSuccessAt > 0 && now - record.lastSuccessAt <= FAILURE_SCORE_WINDOW_MS
      ? Math.min(120, record.successCount * 8)
      : 0;

    // Thêm jitter ngẫu nhiên (0-60) để dàn đều tải giữa các key có sức khỏe tương đương,
    // tránh việc luôn ưu tiên Key #1 khi nhiều key cùng rảnh.
    const jitter = this.random() * 60;

    return 1000 + idleBonus + successBonus + jitter - recentFailurePenalty - record.inFlightCount * 250;
  }

  private getMaxUsefulConcurrency(): number {
    const activeKeyCount = this.getAvailableKeys().length;
    return Math.max(1, Math.min(this.desiredConcurrency, activeKeyCount || this.desiredConcurrency));
  }

  private registerPressure(kind: KeyCooldownKind, durationMs: number, forceSingleConcurrency: boolean = false): void {
    const now = this.now();
    this.pressureStreak = now - this.lastPressureAt <= PRESSURE_WINDOW_MS ? this.pressureStreak + 1 : 1;
    this.lastPressureAt = now;
    this.successStreak = 0;

    const circuitBreakerActive = this.pressureStreak >= 3;
    const shouldReduceNow = kind === 'rateLimit' || this.pressureStreak >= 2;

    if ((forceSingleConcurrency || circuitBreakerActive) && this.recommendedConcurrency > 1) {
      this.recommendedConcurrency = 1;
      console.info(`Adaptive concurrency reduced to ${this.recommendedConcurrency}/${this.getMaxUsefulConcurrency()} after repeated ${kind}.`);
    } else if (shouldReduceNow && this.recommendedConcurrency > 1) {
      this.recommendedConcurrency = Math.max(1, this.recommendedConcurrency - 1);
      console.info(`Adaptive concurrency reduced to ${this.recommendedConcurrency}/${this.getMaxUsefulConcurrency()} after ${kind}.`);
    }

    if (circuitBreakerActive) {
      const circuitCooldownMs = Math.min(30 * 1000, 5000 + Math.max(0, this.pressureStreak - 3) * 5000);
      this.globalCooldownUntil = Math.max(this.globalCooldownUntil, now + circuitCooldownMs);
      return;
    }

    if (kind === 'rateLimit' && this.pressureStreak >= 2 && this.getAvailableKeys().length === 0) {
      const poolCooldownMs = Math.min(durationMs, 20 * 1000);
      this.globalCooldownUntil = Math.max(this.globalCooldownUntil, now + poolCooldownMs);
    }
  }
}
