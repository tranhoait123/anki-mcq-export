export type KeyCooldownKind = 'rateLimit' | 'serverBusy';

export class UserKeyRotator {
  private keys: string[] = [];
  private currentIndex = 0;
  private failedKeys: Set<string> = new Set();
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
      this.failedKeys.clear();
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
    this.failedKeys.clear();
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

  getCurrentKey(): string {
    if (this.keys.length === 0) return '';
    if (!this.isKeyAvailable(this.keys[this.currentIndex])) return this.getKeyForBatch();
    return this.keys[this.currentIndex];
  }

  rotate(): string {
    if (this.keys.length <= 1) return this.getCurrentKey();

    let attempts = 0;
    do {
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      attempts++;
      if (attempts >= this.keys.length) {
        const nextSoonest = this.getNextCooldownDelayMs();
        if (nextSoonest > 0) {
          console.warn(`⏳ All keys are failed/cooling down. Waiting for cooldown instead of resetting failed keys.`);
          return '';
        }
        break;
      }
    } while (!this.isKeyAvailable(this.keys[this.currentIndex]));

    const key = this.keys[this.currentIndex] || '';
    if (key) console.log(`🔄 Rotating to API Key #${this.getKeyNumber(key)}/${this.keys.length}`);
    return key;
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
    const recoveryThreshold = Math.max(2, this.recommendedConcurrency * 2);
    if (this.successStreak >= recoveryThreshold && this.recommendedConcurrency < maxUsefulConcurrency) {
      this.recommendedConcurrency++;
      this.successStreak = 0;
      console.log(`📈 Adaptive concurrency recovered to ${this.recommendedConcurrency}/${maxUsefulConcurrency}.`);
    }
  }

  markKeyFailed(key: string): void {
    if (!key) return;
    this.failedKeys.add(key);
    this.cooldownUntil.delete(key);
    this.recommendedConcurrency = Math.min(this.recommendedConcurrency, this.getMaxUsefulConcurrency());
    console.warn(`🚫 API Key #${this.getKeyNumber(key)} marked as FAILED (403/Invalid). ${this.availableKeyCount} keys remaining.`);
  }

  markKeyCooldown(key: string, kind: KeyCooldownKind, durationMs?: number): void {
    if (!key || this.failedKeys.has(key)) return;
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

  getKeyForBatch(): string {
    if (this.keys.length === 0) return '';
    const availableKeys = this.getAvailableKeys();
    if (availableKeys.length === 0) return '';
    this.batchKeyCounter = this.batchKeyCounter % availableKeys.length;
    return availableKeys[this.batchKeyCounter++ % availableKeys.length];
  }

  getRecommendedConcurrency(limit?: number): number {
    if (typeof limit === 'number' && limit > 0) {
      this.setDesiredConcurrency(limit);
    }
    return Math.max(1, Math.min(this.recommendedConcurrency, this.getMaxUsefulConcurrency()));
  }

  isKeyAvailable(key: string): boolean {
    if (!key || this.failedKeys.has(key)) return false;
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
      .filter(key => !this.failedKeys.has(key))
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

  getKeyIndex(): number {
    return this.currentIndex;
  }

  private getAvailableKeys(): string[] {
    return this.keys.filter(key => this.isKeyAvailable(key));
  }

  private getMaxUsefulConcurrency(): number {
    return Math.max(1, Math.min(this.desiredConcurrency, this.getHealthyKeyCount() || this.desiredConcurrency));
  }

  private registerPressure(kind: KeyCooldownKind, durationMs: number): void {
    const now = this.now();
    this.pressureStreak = now - this.lastPressureAt <= 45 * 1000 ? this.pressureStreak + 1 : 1;
    this.lastPressureAt = now;
    this.successStreak = 0;

    const shouldReduceNow = kind === 'rateLimit' || this.pressureStreak >= 2;
    if (shouldReduceNow && this.recommendedConcurrency > 1) {
      this.recommendedConcurrency = Math.max(1, this.recommendedConcurrency - 1);
      console.warn(`🐢 Adaptive concurrency reduced to ${this.recommendedConcurrency}/${this.getMaxUsefulConcurrency()} after ${kind}.`);
    }

    if (this.pressureStreak >= 2 && this.getAvailableKeys().length === 0) {
      const poolCooldownMs = Math.min(durationMs, kind === 'rateLimit' ? 20 * 1000 : 8 * 1000);
      this.globalCooldownUntil = Math.max(this.globalCooldownUntil, now + poolCooldownMs);
    }
  }

  private getHealthyKeyCount(): number {
    return this.keys.filter(key => !this.failedKeys.has(key)).length;
  }
}
