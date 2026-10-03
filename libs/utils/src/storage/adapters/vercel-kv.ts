/**
 * Vercel KV Storage Adapter
 *
 * Vercel KV (REST-based) storage implementation for edge deployment.
 * NOTE: Vercel KV does NOT support pub/sub. Use Upstash adapter instead.
 */

import { StorageConfigError, StorageConnectionError } from '../errors';
import type { SetOptions, VercelKvAdapterOptions } from '../types';
import { COMPARE_AND_DELETE_SCRIPT } from '../utils/compare-and-delete';
import { validateTTL } from '../utils/ttl';
import { BaseStorageAdapter } from './base';

// Type for @vercel/kv client
type VercelKvClient = {
  get: <T = string>(key: string) => Promise<T | null>;
  set: (key: string, value: string, options?: { ex?: number; nx?: boolean; xx?: boolean }) => Promise<string | null>;
  del: (...keys: string[]) => Promise<number>;
  exists: (...keys: string[]) => Promise<number>;
  mget: <T = string>(...keys: string[]) => Promise<(T | null)[]>;
  expire: (key: string, seconds: number) => Promise<number>;
  ttl: (key: string) => Promise<number>;
  incr: (key: string) => Promise<number>;
  decr: (key: string) => Promise<number>;
  incrby: (key: string, increment: number) => Promise<number>;
  eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;
  scan: (cursor: number, options?: { match?: string; count?: number }) => Promise<[string, string[]]>;
  keys: (pattern: string) => Promise<string[]>;
};

/** The part of `@vercel/kv` the adapter uses. */
interface VercelKvModule {
  createClient: (config: { url: string; token: string; cache?: undefined }) => VercelKvClient;
}

/**
 * Load `@vercel/kv` when the adapter connects, so a server that never uses it
 * does not need it installed.
 *
 * A dynamic `import()`, not `require()`: in this package's ESM build a lazy
 * `require()` is an opaque runtime call that a bundler consuming the build
 * (wrangler for Cloudflare Workers, edge builds) cannot follow, so a Worker
 * failed to load `@vercel/kv` even with it installed (#680). An `import()` of
 * a string literal is bundled when the package is installed and left alone,
 * inside this try block, when it is not.
 */
async function loadVercelKv(): Promise<VercelKvModule> {
  try {
    const mod = (await import('@vercel/kv')) as unknown as Partial<VercelKvModule> & { default?: VercelKvModule };
    // Node's ESM view of the CommonJS build exposes the exports on `default` too.
    const resolved = typeof mod.createClient === 'function' ? mod : mod.default;
    if (!resolved || typeof resolved.createClient !== 'function') throw new Error('createClient missing');
    return resolved as VercelKvModule;
  } catch {
    throw new Error('@vercel/kv is required for Vercel KV storage adapter. Install it with: npm install @vercel/kv');
  }
}

/**
 * Vercel KV storage adapter.
 *
 * Features:
 * - REST-based storage for edge deployment
 * - Native TTL support
 * - Pattern matching via keys() command
 *
 * Limitations:
 * - NO pub/sub support (use Upstash instead)
 * - keys() may be slow for large datasets
 *
 * @example
 * ```typescript
 * const adapter = new VercelKvStorageAdapter({
 *   url: process.env.KV_REST_API_URL,
 *   token: process.env.KV_REST_API_TOKEN,
 * });
 *
 * await adapter.connect();
 * await adapter.set('key', 'value', { ttlSeconds: 300 });
 * const value = await adapter.get('key');
 * await adapter.disconnect();
 * ```
 */
export class VercelKvStorageAdapter extends BaseStorageAdapter {
  protected readonly backendName = 'vercel-kv';

  private client?: VercelKvClient;
  private readonly options: VercelKvAdapterOptions;
  private readonly keyPrefix: string;

  constructor(options: VercelKvAdapterOptions = {}) {
    super();

    // Get URL and token from options or environment
    const url = options.url ?? process.env['KV_REST_API_URL'];
    const token = options.token ?? process.env['KV_REST_API_TOKEN'];

    if (!url || !token) {
      throw new StorageConfigError(
        'vercel-kv',
        'KV_REST_API_URL and KV_REST_API_TOKEN must be provided via options or environment variables.',
      );
    }

    this.options = { ...options, url, token };
    this.keyPrefix = options.keyPrefix ?? '';
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async connect(): Promise<void> {
    if (this.connected) return;

    try {
      const { createClient } = await loadVercelKv();
      const url = this.options.url;
      const token = this.options.token;
      if (!url || !token) {
        throw new StorageConfigError('vercel-kv', 'URL and token are required');
      }
      // `@vercel/kv` sets `cache: 'default'` on every request, which Cloudflare
      // Workers reject ("The 'cache' field on 'RequestInitializerDict' is not
      // implemented" / "Unsupported cache mode: default"). Leave the fetch cache
      // mode unset instead — the value `@vercel/kv` itself calls equivalent.
      // The module's `kv` singleton cannot take this option, so even an
      // env-configured adapter builds its own client from the same URL and token.
      this.client = createClient({ url, token, cache: undefined });

      // Test connection with a simple operation
      await this.client.exists('__healthcheck__');
      this.connected = true;
    } catch (e) {
      throw new StorageConnectionError(
        'Failed to connect to Vercel KV',
        e instanceof Error ? e : undefined,
        'vercel-kv',
      );
    }
  }

  async disconnect(): Promise<void> {
    // Vercel KV is REST-based, no persistent connection to close
    this.client = undefined;
    this.connected = false;
  }

  async ping(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.exists('__healthcheck__');
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // Connection Helpers
  // ============================================

  /**
   * Get the connected Vercel KV client, throwing if not connected.
   */
  private getConnectedClient(): VercelKvClient {
    this.ensureConnected();
    if (!this.client) {
      throw new StorageConnectionError('Vercel KV client not connected', undefined, 'vercel-kv');
    }
    return this.client;
  }

  // ============================================
  // Core Operations
  // ============================================

  async get(key: string): Promise<string | null> {
    const result = await this.getConnectedClient().get<string>(this.prefixKey(key));
    return result;
  }

  protected async doSet(key: string, value: string, options?: SetOptions): Promise<void> {
    const client = this.getConnectedClient();
    const prefixedKey = this.prefixKey(key);
    const setOptions: { ex?: number; nx?: boolean; xx?: boolean } = {};

    if (options?.ttlSeconds) {
      setOptions.ex = options.ttlSeconds;
    }
    if (options?.ifNotExists) {
      setOptions.nx = true;
    } else if (options?.ifExists) {
      setOptions.xx = true;
    }

    await client.set(prefixedKey, value, Object.keys(setOptions).length > 0 ? setOptions : undefined);
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.getConnectedClient().del(this.prefixKey(key));
    return result > 0;
  }

  override async deleteIfEquals(key: string, expectedValue: string): Promise<boolean> {
    const deleted = await this.getConnectedClient().eval(
      COMPARE_AND_DELETE_SCRIPT,
      [this.prefixKey(key)],
      [expectedValue],
    );
    return deleted === 1;
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.getConnectedClient().exists(this.prefixKey(key));
    return result > 0;
  }

  // ============================================
  // Batch Operations
  // ============================================

  override async mget(keys: string[]): Promise<(string | null)[]> {
    if (keys.length === 0) return [];
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    return this.getConnectedClient().mget<string>(...prefixedKeys);
  }

  override async mdelete(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    return this.getConnectedClient().del(...prefixedKeys);
  }

  // ============================================
  // TTL Operations
  // ============================================

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    validateTTL(ttlSeconds);
    const result = await this.getConnectedClient().expire(this.prefixKey(key), ttlSeconds);
    return result === 1;
  }

  async ttl(key: string): Promise<number | null> {
    const result = await this.getConnectedClient().ttl(this.prefixKey(key));
    // Redis returns -2 if key doesn't exist, -1 if no TTL
    if (result === -2) return null;
    return result;
  }

  // ============================================
  // Key Enumeration
  // ============================================

  async keys(pattern = '*'): Promise<string[]> {
    const client = this.getConnectedClient();
    const prefixedPattern = this.prefixKey(pattern);

    try {
      // Try SCAN first (more efficient for large datasets)
      const result: string[] = [];
      let cursor = 0;

      do {
        const [nextCursor, keys] = await client.scan(cursor, {
          match: prefixedPattern,
          count: 100,
        });
        const parsedCursor = typeof nextCursor === 'string' ? parseInt(nextCursor, 10) : nextCursor;
        cursor = Number.isNaN(parsedCursor) ? 0 : parsedCursor;

        for (const key of keys) {
          result.push(this.unprefixKey(key));
        }
      } while (cursor !== 0);

      return result;
    } catch {
      // Fallback to keys command (may be slow)
      const allKeys = await client.keys(prefixedPattern);
      return allKeys.map((k) => this.unprefixKey(k));
    }
  }

  // ============================================
  // Atomic Operations
  // ============================================

  async incr(key: string): Promise<number> {
    return this.getConnectedClient().incr(this.prefixKey(key));
  }

  async decr(key: string): Promise<number> {
    return this.getConnectedClient().decr(this.prefixKey(key));
  }

  async incrBy(key: string, amount: number): Promise<number> {
    return this.getConnectedClient().incrby(this.prefixKey(key), amount);
  }

  // ============================================
  // Pub/Sub (NOT SUPPORTED)
  // ============================================

  override supportsPubSub(): boolean {
    return false;
  }

  protected override getPubSubSuggestion(): string {
    return 'Vercel KV is REST-based and does not support pub/sub. Use Upstash adapter for pub/sub support.';
  }

  // ============================================
  // Internal Helpers
  // ============================================

  /**
   * Add prefix to a key.
   */
  private prefixKey(key: string): string {
    return this.keyPrefix + key;
  }

  /**
   * Remove prefix from a key.
   */
  private unprefixKey(key: string): string {
    if (this.keyPrefix && key.startsWith(this.keyPrefix)) {
      return key.slice(this.keyPrefix.length);
    }
    return key;
  }
}
