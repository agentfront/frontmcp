import { Provider, ProviderScope } from '@frontmcp/sdk';
import { CacheStoreInterface } from '../cache.types';

type Entry = {
  value: string;
  /** epoch millis when this entry expires (undefined = no TTL) */
  expiresAt?: number;
  /** per-key timeout when TTL is short enough to schedule */
  timeout?: NodeJS.Timeout;
};

const MAX_TIMEOUT_MS = 2 ** 31 - 1; // ~24.8 days (Node setTimeout limit)

@Provider({
  name: 'provider:cache:memory',
  description: 'Memory-based cache provider',
  scope: ProviderScope.GLOBAL,
})
export default class CacheMemoryProvider  implements CacheStoreInterface{
  private readonly memory = new Map<string, Entry>();
  private sweeper?: NodeJS.Timeout;

  constructor(sweepIntervalTTL = 60) {
    this.sweeper = setInterval(() => this.sweep(), sweepIntervalTTL * 1000);
    // don’t keep the process alive just for the sweeper (Node >=14)
    (this.sweeper as any).unref?.();
  }

  /** Set any value (auto-stringifies objects) */
  async setValue(key: string, value: any, ttlSeconds?: number): Promise<void> {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);

    // clear any previous timeout on this key
    const existing = this.memory.get(key);
    if (existing?.timeout) clearTimeout(existing.timeout);

    const entry: Entry = { value: strValue };

    if (ttlSeconds && ttlSeconds > 0) {
      const ttlMs = ttlSeconds * 1000;
      entry.expiresAt = Date.now() + ttlMs;

      // Only schedule a timer if within Node's setTimeout limit; otherwise rely on sweeper/lazy purge
      if (ttlMs <= MAX_TIMEOUT_MS) {
        entry.timeout = setTimeout(() => {
          // final check guards against clock drift or updates
          const e = this.memory.get(key);
          if (e && e.expiresAt && e.expiresAt <= Date.now()) {
            this.memory.delete(key);
          }
        }, ttlMs);
        (entry.timeout as any).unref?.();
      }
    }

    this.memory.set(key, entry);
  }

  /** Get a value and automatically parse JSON if possible */
  async getValue<T = any>(key: string, defaultValue?: T): Promise<T | undefined> {
    const entry = this.memory.get(key);
    if (!entry) return defaultValue;

    if (this.isExpired(entry)) {
      await this.delete(key);
      return defaultValue;
    }

    const raw = entry.value;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // fallback for plain string values
      return raw as unknown as T;
    }
  }

  /** Delete a key */
  async delete(key: string): Promise<void> {
    const entry = this.memory.get(key);
    if (entry?.timeout) clearTimeout(entry.timeout);
    this.memory.delete(key);
  }

  /** Check if a key exists (and not expired) */
  async exists(key: string): Promise<boolean> {
    const entry = this.memory.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      await this.delete(key);
      return false;
    }
    return true;
  }

  /** Gracefully close the provider */
  async close(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const [, entry] of this.memory) {
      if (entry.timeout) clearTimeout(entry.timeout);
    }
    this.memory.clear();
  }

  // ---- internals ----

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
  }

  /** Periodically remove expired keys to keep memory tidy */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        if (entry.timeout) clearTimeout(entry.timeout);
        this.memory.delete(key);
      }
    }
  }
}
