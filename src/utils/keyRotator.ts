export type KeyCooldownKind = 'rateLimit' | 'serverBusy';

export class UserKeyRotator {
  private keys: string[] = [];
  private currentIndex = 0;
  private failedKeys: Set<string> = new Set();
  private cooldownUntil: Map<string, number> = new Map();
  private batchKeyCounter = 0;
  private now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  init(apiKeyString: string) {
    if (!apiKeyString || typeof apiKeyString !== 'string') {
      this.keys = [];
      this.currentIndex = 0;
      this.failedKeys.clear();
      this.cooldownUntil.clear();
      this.batchKeyCounter = 0;
      return;
    }
    const parts = apiKeyString.split(/[,;\n\r]+/);
    this.keys = parts.map(k => k.trim()).filter(k => k.length > 5);
    this.currentIndex = 0;
    this.failedKeys.clear();
    this.cooldownUntil.clear();
    this.batchKeyCounter = 0;
    console.log(`🔑 Loaded ${this.keys.length} API Keys.`);
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

  markKeyFailed(key: string): void {
    if (!key) return;
    this.failedKeys.add(key);
    this.cooldownUntil.delete(key);
    console.warn(`🚫 API Key #${this.getKeyNumber(key)} marked as FAILED (403/Invalid). ${this.availableKeyCount} keys remaining.`);
  }

  markKeyCooldown(key: string, kind: KeyCooldownKind): void {
    if (!key || this.failedKeys.has(key)) return;
    const durationMs = kind === 'rateLimit' ? 3 * 60 * 1000 : 45 * 1000;
    const until = this.now() + durationMs;
    const previous = this.cooldownUntil.get(key) || 0;
    this.cooldownUntil.set(key, Math.max(previous, until));
    console.warn(`⏸️ API Key #${this.getKeyNumber(key)} cooling down for ${Math.round(durationMs / 1000)}s (${kind}). ${this.availableKeyCount} keys available now.`);
  }

  getKeyForBatch(): string {
    if (this.keys.length === 0) return '';
    const availableKeys = this.getAvailableKeys();
    if (availableKeys.length === 0) return '';
    this.batchKeyCounter = this.batchKeyCounter % availableKeys.length;
    return availableKeys[this.batchKeyCounter++ % availableKeys.length];
  }

  isKeyAvailable(key: string): boolean {
    if (!key || this.failedKeys.has(key)) return false;
    const until = this.cooldownUntil.get(key) || 0;
    if (until <= this.now()) {
      if (until > 0) this.cooldownUntil.delete(key);
      return true;
    }
    return false;
  }

  getNextCooldownDelayMs(): number {
    const now = this.now();
    const waits = this.keys
      .filter(key => !this.failedKeys.has(key))
      .map(key => (this.cooldownUntil.get(key) || 0) - now)
      .filter(delay => delay > 0);
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
}
