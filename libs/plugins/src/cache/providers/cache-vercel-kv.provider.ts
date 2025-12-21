import { Provider, ProviderScope } from '@frontmcp/sdk';
import { CacheStoreInterface } from '../cache.types';

export interface CacheVercelKvProviderOptions {
  url?: string;
  token?: string;
  keyPrefix?: string;
  defaultTTL?: number;
}

/** Minimal interface for Vercel KV client operations used by the cache provider */
interface VercelKvClient {
  set(key: string, value: string, options?: { ex?: number }): Promise<void>;
  get(key: string): Promise<unknown>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<number>;
}

@Provider({
  name: 'provider:cache:vercel-kv',
  description: 'Vercel KV-based cache provider',
  scope: ProviderScope.GLOBAL,
})
export default class CacheVercelKvProvider implements CacheStoreInterface {
  private kv: VercelKvClient;
  private readonly keyPrefix: string;
  private readonly defaultTTL: number;

  constructor(options: CacheVercelKvProviderOptions = {}) {
    // Lazy import @vercel/kv to avoid bundling when not used
    const vercelKv = require('@vercel/kv');

    // Validate partial configuration - both url and token must be provided together, or neither
    const hasUrl = options.url !== undefined;
    const hasToken = options.token !== undefined;
    if (hasUrl !== hasToken) {
      throw new Error(
        `CacheVercelKvProvider: Both 'url' and 'token' must be provided together, or neither. ` +
          `Received: url=${hasUrl ? 'provided' : 'missing'}, token=${hasToken ? 'provided' : 'missing'}`,
      );
    }

    // Use the kv instance with custom config if url/token provided
    if (options.url && options.token) {
      this.kv = vercelKv.createClient({
        url: options.url,
        token: options.token,
      });
    } else {
      // Use default kv instance (reads from KV_REST_API_URL and KV_REST_API_TOKEN env vars)
      this.kv = vercelKv.kv;
    }

    this.keyPrefix = options.keyPrefix ?? 'cache:';
    this.defaultTTL = options.defaultTTL ?? 60 * 60 * 24; // 1 day default
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /** Set a value (auto-stringifies objects) */
  async setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTTL;

    if (ttl > 0) {
      await this.kv.set(this.prefixKey(key), strValue, { ex: ttl });
    } else {
      await this.kv.set(this.prefixKey(key), strValue);
    }
  }

  /** Get a value and automatically parse JSON if possible */
  async getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    const raw = await this.kv.get(this.prefixKey(key));
    if (raw === null || raw === undefined) return defaultValue;

    // Vercel KV auto-parses JSON, but we handle string fallback
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    }

    return raw as T;
  }

  /** Delete a key */
  async delete(key: string): Promise<void> {
    await this.kv.del(this.prefixKey(key));
  }

  /** Check if a key exists */
  async exists(key: string): Promise<boolean> {
    return (await this.kv.exists(this.prefixKey(key))) === 1;
  }

  /** Gracefully close the provider (no-op for Vercel KV - stateless REST API) */
  async close(): Promise<void> {
    // No-op: Vercel KV uses stateless REST API, no connection to close
  }
}
