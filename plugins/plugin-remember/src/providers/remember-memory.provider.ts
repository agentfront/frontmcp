import { Provider, ProviderScope } from '@frontmcp/sdk';
import type { RememberStoreInterface } from './remember-store.interface';

/**
 * Internal entry structure for memory storage.
 */
interface Entry {
  /** Stored value (JSON stringified) */
  value: string;
  /** Epoch millis when this entry expires (undefined = no TTL) */
  expiresAt?: number;
  /** Per-key timeout when TTL is short enough to schedule */
  timeout?: NodeJS.Timeout;
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1; // ~24.8 days (Node setTimeout limit)

/**
 * In-memory storage provider for RememberPlugin.
 * Provides fast, local storage with automatic TTL expiration.
 */
@Provider({
  name: 'provider:remember:memory',
  description: 'In-memory storage provider for RememberPlugin',
  scope: ProviderScope.GLOBAL,
})
export default class RememberMemoryProvider implements RememberStoreInterface {
  private readonly memory = new Map<string, Entry>();
  private sweeper?: NodeJS.Timeout;

  constructor(sweepIntervalSeconds = 60) {
    this.sweeper = setInterval(() => this.sweep(), sweepIntervalSeconds * 1000);
    // Don't keep the process alive just for the sweeper
    (this.sweeper as { unref?: () => void }).unref?.();
  }

  /**
   * Store a value with optional TTL.
   * Always JSON-serializes the value for consistent storage/retrieval.
   */
  async setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    // Always JSON.stringify to ensure consistent round-trip behavior
    // This means strings are stored as '"string"' and retrieved correctly
    const strValue = JSON.stringify(value);

    // Clear any previous timeout on this key
    const existing = this.memory.get(key);
    if (existing?.timeout) clearTimeout(existing.timeout);

    const entry: Entry = { value: strValue };

    if (ttlSeconds && ttlSeconds > 0) {
      const ttlMs = ttlSeconds * 1000;
      entry.expiresAt = Date.now() + ttlMs;

      // Only schedule a timer if within Node's setTimeout limit
      if (ttlMs <= MAX_TIMEOUT_MS) {
        entry.timeout = setTimeout(() => {
          const e = this.memory.get(key);
          if (e && e.expiresAt && e.expiresAt <= Date.now()) {
            this.memory.delete(key);
          }
        }, ttlMs);
        (entry.timeout as { unref?: () => void }).unref?.();
      }
    }

    this.memory.set(key, entry);
  }

  /**
   * Retrieve a value by key.
   * JSON-parses the stored value to match the setValue serialization.
   */
  async getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    const entry = this.memory.get(key);
    if (!entry) return defaultValue;

    if (this.isExpired(entry)) {
      await this.delete(key);
      return defaultValue;
    }

    // Parse the stored JSON value (setValue always stringifies)
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      // Fallback for legacy or malformed data
      return entry.value as unknown as T;
    }
  }

  /**
   * Delete a key.
   */
  async delete(key: string): Promise<void> {
    const entry = this.memory.get(key);
    if (entry?.timeout) clearTimeout(entry.timeout);
    this.memory.delete(key);
  }

  /**
   * Check if a key exists (and is not expired).
   */
  async exists(key: string): Promise<boolean> {
    const entry = this.memory.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      await this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * List keys matching a glob-style pattern.
   * Supports * and ? wildcards.
   */
  async keys(pattern?: string): Promise<string[]> {
    const result: string[] = [];
    const regex = pattern ? this.patternToRegex(pattern) : null;

    for (const [key, entry] of this.memory) {
      // Skip expired entries
      if (this.isExpired(entry)) {
        this.memory.delete(key);
        continue;
      }

      // Apply pattern filter
      if (regex && !regex.test(key)) {
        continue;
      }

      result.push(key);
    }

    return result;
  }

  /**
   * Gracefully close the provider.
   */
  async close(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const [, entry] of this.memory) {
      if (entry.timeout) clearTimeout(entry.timeout);
    }
    this.memory.clear();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────────────────────

  private isExpired(entry: Entry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= Date.now();
  }

  /**
   * Periodically remove expired keys to keep memory tidy.
   */
  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        if (entry.timeout) clearTimeout(entry.timeout);
        this.memory.delete(key);
      }
    }
  }

  /**
   * Convert a glob-style pattern to a RegExp.
   * * matches any sequence of characters
   * ? matches any single character
   */
  private patternToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
      .replace(/\*/g, '.*') // * -> .*
      .replace(/\?/g, '.'); // ? -> .
    return new RegExp(`^${escaped}$`);
  }
}
