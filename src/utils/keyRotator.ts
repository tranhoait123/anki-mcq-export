export type KeyCooldownKind = 'rateLimit' | 'serverBusy';

export class UserKeyRotator {
  private keys: string[] = [];
  private currentIndex = 0;
  private hardFailedKeys: Set<string> = new Set();
  private cooldownUntil: Map<string, number> = new Map();
  private batchKeyCounter = 0;
  private desiredConcurrency = 1;
  private recommendedConcurrency = 1;
  private pressureStreak = 0;
  private successStreak = 0;
  private lastPressureAt = 0;
  private globalCooldownUntil = 0;
  private now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  init(apiKeyString: string, desiredConcurrency: number = 1) {
    this.desiredConcurrency = Math.max(1, desiredConcurrency || 1);
    if (!apiKeyString || typeof apiKeyString !== 'string') {
      this.keys = [];
      this.currentIndex = 0;
      this.hardFailedKeys.clear();
      this.cooldownUntil.clear();
      this.batchKeyCounter = 0;
      this.pressureStreak = 0;
      this.successStreak = 0;
      this.lastPressureAt = 0;
      this.globalCooldownUntil = 0;
      this.recommendedConcurrency = this.desiredConcurrency;
      return;
    }
    const parts = apiKeyString.split(/[,;\n\r]+/);
    this.keys = parts.map(k => k.trim()).filter(k => k.length > 5);
    this.currentIndex = 0;
    this.hardFailedKeys.clear();
    this.cooldownUntil.clear();
    this.batchKeyCounter = 0;
    this.pressureStreak = 0;
    this.successStreak = 0;
    this.lastPressureAt = 0;
    this.globalCooldownUntil = 0;
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
    if (this.keys.length === 0) return '';
    const excluded = this.getExcludedKeySet(excludeKeys);
    const currentKey = this.keys[this.currentIndex];
    if (!this.isKeyAvailable(currentKey) || excluded.has(currentKey)) return this.getKeyForBatch(excluded);
    return currentKey;
  }

  rotate(excludeKeys?: Iterable<string>): string {
    if (this.keys.length === 0) return '';
    const excluded = this.getExcludedKeySet(excludeKeys);
    if (this.keys.length <= 1) return this.getCurrentKey(excluded);

    let attempts = 0;
    while (attempts < this.keys.length) {
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      attempts++;
      const key = this.keys[this.currentIndex] || '';
      if (this.isKeyAvailable(key) && !excluded.has(key)) {
        console.log(`🔄 Rotating to API Key #${this.getKeyNumber(key)}/${this.keys.length}`);
        return key;
      }
    }

    const nextSoonest = this.getNextCooldownDelayMs();
    if (nextSoonest > 0) {
      console.warn(`⏳ All keys are failed/cooling down. Waiting for cooldown instead of resetting failed keys.`);
    }
    return '';
  }

  reportSuccess(key: string): void {
    if (!key || !this.keys.includes(key)) return;
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

  markKeyFailed(key: string): void {
    if (!key) return;
    this.hardFailedKeys.add(key);
    this.cooldownUntil.delete(key);
    this.recommendedConcurrency = Math.min(this.recommendedConcurrency, this.getMaxUsefulConcurrency());
    console.warn(`🚫 API Key #${this.getKeyNumber(key)} marked as FAILED (403/Invalid). ${this.availableKeyCount} keys remaining.`);
  }

  markKeyCooldown(key: string, kind: KeyCooldownKind, durationMs?: number): void {
    if (!key || this.hardFailedKeys.has(key)) return;
    if (kind === 'serverBusy') {
      this.markProviderPressure(durationMs);
      return;
    }
    const defaultDurationMs = kind === 'rateLimit' ? 3 * 60 * 1000 : 45 * 1000;
    const boundedDurationMs = Math.max(
      1000,
      Math.min(durationMs ?? defaultDurationMs, kind === 'rateLimit' ? 5 * 60 * 1000 : 90 * 1000)
    );
    const until = this.now() + boundedDurationMs;
    const previous = this.cooldownUntil.get(key) || 0;
    this.cooldownUntil.set(key, Math.max(previous, until));
    this.registerPressure(kind, boundedDurationMs);
    console.warn(`⏸️ API Key #${this.getKeyNumber(key)} cooling down for ${Math.round(boundedDurationMs / 1000)}s (${kind}). ${this.availableKeyCount} keys available now.`);
  }

  markSoftRateLimit(durationMs?: number): void {
    const now = this.now();
    const boundedDurationMs = Math.max(1000, Math.min(durationMs ?? 8000, 60 * 1000));
    this.registerPressure('rateLimit', boundedDurationMs, true);
    this.globalCooldownUntil = Math.max(this.globalCooldownUntil, now + boundedDurationMs);
    console.warn(`🌐 Provider rate-limit cooldown for ${Math.round(boundedDurationMs / 1000)}s. Keys stay available; concurrency is ${this.recommendedConcurrency}/${this.getMaxUsefulConcurrency()}.`);
  }

  markProviderPressure(durationMs?: number): void {
    const now = this.now();
    const nextStreak = now - this.lastPressureAt <= 45 * 1000 ? this.pressureStreak + 1 : 1;
    const escalatedMs = Math.min(30 * 1000, 3000 + Math.max(0, nextStreak - 1) * 5000);
    const boundedDurationMs = Math.max(1000, Math.min(durationMs ?? escalatedMs, 30 * 1000));
    this.registerPressure('serverBusy', boundedDurationMs);
    this.globalCooldownUntil = Math.max(this.globalCooldownUntil, now + boundedDurationMs);
    console.warn(`🌐 Provider pressure cooldown for ${Math.round(boundedDurationMs / 1000)}s. Keys stay available; concurrency is ${this.recommendedConcurrency}/${this.getMaxUsefulConcurrency()}.`);
  }

  getKeyForBatch(excludeKeys?: Iterable<string>): string {
    if (this.keys.length === 0) return '';
    const availableKeys = this.getAvailableKeys(excludeKeys);
    if (availableKeys.length === 0) return '';
    this.batchKeyCounter = this.batchKeyCounter % availableKeys.length;
    const key = availableKeys[this.batchKeyCounter++ % availableKeys.length];
    const keyIndex = this.keys.indexOf(key);
    if (keyIndex >= 0) this.currentIndex = keyIndex;
    return key;
  }

  getRecommendedConcurrency(limit?: number): number {
    if (typeof limit === 'number' && limit > 0) {
      this.setDesiredConcurrency(limit);
    }
    return Math.max(1, Math.min(this.recommendedConcurrency, this.getMaxUsefulConcurrency()));
  }

  isKeyAvailable(key: string): boolean {
    if (!key || this.hardFailedKeys.has(key)) return false;
    const now = this.now();
    const until = this.cooldownUntil.get(key) || 0;
    if (until <= now) {
      if (until > 0) this.cooldownUntil.delete(key);
      return true;
    }
    return false;
  }

  getNextCooldownDelayMs(): number {
    const now = this.now();
    const globalDelay = this.globalCooldownUntil > now ? this.globalCooldownUntil - now : 0;
    const waits = this.keys
      .filter(key => !this.hardFailedKeys.has(key))
      .map(key => (this.cooldownUntil.get(key) || 0) - now)
      .filter(delay => delay > 0);
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
    return this.hardFailedKeys.size;
  }

  getKeyIndex(): number {
    return this.currentIndex;
  }

  getMaxKeysPerOperation(): number {
    const usableKeyCount = this.getHealthyKeyCount();
    if (usableKeyCount <= 0) return 0;
    return Math.max(1, Math.min(8, usableKeyCount));
  }

  hasRecentProviderPressure(windowMs: number = 30 * 1000): boolean {
    const now = this.now();
    return this.globalCooldownUntil > now || (this.lastPressureAt > 0 && now - this.lastPressureAt <= windowMs && this.pressureStreak > 0);
  }

  private getAvailableKeys(excludeKeys?: Iterable<string>): string[] {
    const excluded = this.getExcludedKeySet(excludeKeys);
    return this.keys.filter(key => this.isKeyAvailable(key) && !excluded.has(key));
  }

  private getExcludedKeySet(excludeKeys?: Iterable<string>): Set<string> {
    return excludeKeys instanceof Set ? excludeKeys : new Set(excludeKeys || []);
  }

  private getMaxUsefulConcurrency(): number {
    return Math.max(1, Math.min(this.desiredConcurrency, this.getHealthyKeyCount() || this.desiredConcurrency));
  }

  private registerPressure(kind: KeyCooldownKind, durationMs: number, forceSingleConcurrency: boolean = false): void {
    const now = this.now();
    this.pressureStreak = now - this.lastPressureAt <= 45 * 1000 ? this.pressureStreak + 1 : 1;
    this.lastPressureAt = now;
    this.successStreak = 0;

    const shouldReduceNow = kind === 'rateLimit' || this.pressureStreak >= 2;
    if (shouldReduceNow && this.recommendedConcurrency > 1) {
      this.recommendedConcurrency = forceSingleConcurrency ? 1 : Math.max(1, this.recommendedConcurrency - 1);
      console.warn(`🐢 Adaptive concurrency reduced to ${this.recommendedConcurrency}/${this.getMaxUsefulConcurrency()} after ${kind}.`);
    }

    if (kind === 'rateLimit' && this.pressureStreak >= 2 && this.getAvailableKeys().length === 0) {
      const poolCooldownMs = Math.min(durationMs, kind === 'rateLimit' ? 20 * 1000 : 8 * 1000);
      this.globalCooldownUntil = Math.max(this.globalCooldownUntil, now + poolCooldownMs);
    }
  }

  private getHealthyKeyCount(): number {
    return this.keys.filter(key => !this.hardFailedKeys.has(key)).length;
  }
}
