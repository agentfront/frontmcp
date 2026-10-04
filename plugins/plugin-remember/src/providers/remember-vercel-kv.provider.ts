import { Provider, ProviderScope } from '@frontmcp/sdk';
import { getEnv } from '@frontmcp/utils';

import type { VercelKvRememberPluginOptions } from '../remember.types';
import type { RememberStoreInterface } from './remember-store.interface';

/**
 * Minimal interface for Vercel KV client operations.
 */
interface VercelKvClient {
  /** Resolves to `'OK'` on write, or `null` when `nx` was set and the key already existed. */
  set(key: string, value: string, options?: { ex?: number; nx?: boolean }): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  scan(cursor: string | number, options?: { match?: string; count?: number }): Promise<[string | number, string[]]>;
}

interface VercelKvModule {
  createClient(config: { url: string; token: string; automaticDeserialization: boolean }): VercelKvClient;
}

/**
 * Options for the Vercel KV provider.
 */
export interface RememberVercelKvProviderOptions {
  /** Vercel KV URL (defaults to KV_REST_API_URL env var) */
  url?: string;
  /** Vercel KV token (defaults to KV_REST_API_TOKEN env var) */
  token?: string;
  /** Key prefix for all storage keys */
  keyPrefix?: string;
  /** Default TTL in seconds */
  defaultTTL?: number;
}

/**
 * Vercel KV storage provider for RememberPlugin.
 * Provides serverless-compatible, edge-ready storage.
 */
@Provider({
  name: 'provider:remember:vercel-kv',
  description: 'Vercel KV-based storage provider for RememberPlugin',
  scope: ProviderScope.GLOBAL,
})
export default class RememberVercelKvProvider implements RememberStoreInterface {
  private readonly createClient: VercelKvModule['createClient'];
  private readonly connection: { url?: string; token?: string };
  private client?: VercelKvClient;
  private readonly keyPrefix: string;
  private readonly defaultTTL?: number;

  constructor(options: RememberVercelKvProviderOptions = {}) {
    // Lazy import @vercel/kv to avoid bundling when not used
    const vercelKv: VercelKvModule = require('@vercel/kv');

    // Validate partial configuration
    const hasUrl = options.url !== undefined;
    const hasToken = options.token !== undefined;
    if (hasUrl !== hasToken) {
      throw new Error(
        `RememberVercelKvProvider: Both 'url' and 'token' must be provided together, or neither. ` +
          `Received: url=${hasUrl ? 'provided' : 'missing'}, token=${hasToken ? 'provided' : 'missing'}`,
      );
    }

    this.createClient = vercelKv.createClient;
    this.connection = { url: options.url, token: options.token };
    this.keyPrefix = options.keyPrefix ?? 'remember:';
    this.defaultTTL = options.defaultTTL;
  }

  /** Built on first use, like the module's `kv` singleton, which would JSON-parse what it reads. */
  private get kv(): VercelKvClient {
    if (!this.client) {
      const url = this.connection.url ?? getEnv('KV_REST_API_URL');
      const token = this.connection.token ?? getEnv('KV_REST_API_TOKEN');
      if (!url || !token) {
        throw new Error('RememberVercelKvProvider: pass url and token, or set KV_REST_API_URL and KV_REST_API_TOKEN.');
      }
      this.client = this.createClient({ url, token, automaticDeserialization: false });
    }
    return this.client;
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /**
   * Store a value with optional TTL.
   */
  async setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const fullKey = this.prefixKey(key);
    const strValue = JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTTL;

    if (ttl && ttl > 0) {
      await this.kv.set(fullKey, strValue, { ex: ttl });
    } else {
      await this.kv.set(fullKey, strValue);
    }
  }

  /**
   * Store a value only if the key is absent, via the `nx` option.
   *
   * Resolves to `'OK'` when it created the key and `null` when the key already existed, so two
   * callers racing cannot both win.
   */
  async setIfAbsent(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    const fullKey = this.prefixKey(key);
    const strValue = JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTTL;

    const result =
      ttl && ttl > 0
        ? await this.kv.set(fullKey, strValue, { nx: true, ex: ttl })
        : await this.kv.set(fullKey, strValue, { nx: true });

    return result === 'OK';
  }

  /**
   * Retrieve a value by key.
   */
  async getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    const fullKey = this.prefixKey(key);
    const raw = await this.kv.get(fullKey);

    if (raw === null) return defaultValue;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  /**
   * Delete a key.
   */
  async delete(key: string): Promise<void> {
    const fullKey = this.prefixKey(key);
    await this.kv.del(fullKey);
  }

  /**
   * Check if a key exists.
   */
  async exists(key: string): Promise<boolean> {
    const fullKey = this.prefixKey(key);
    return (await this.kv.exists(fullKey)) === 1;
  }

  /**
   * List keys matching a pattern.
   * Uses SCAN for efficient iteration.
   */
  async keys(pattern?: string): Promise<string[]> {
    const searchPattern = this.prefixKey(pattern ?? '*');
    const result: string[] = [];

    try {
      // Try using scan if available (Upstash Redis API)
      let cursor: string | number = 0;
      do {
        const [nextCursor, keys] = await this.kv.scan(cursor, {
          match: searchPattern,
          count: 100,
        });
        cursor = nextCursor;

        // Strip prefix from keys
        for (const key of keys) {
          result.push(key.slice(this.keyPrefix.length));
        }
      } while (String(cursor) !== '0');
    } catch {
      // Fallback to keys command if scan not available
      try {
        const keys = await this.kv.keys(searchPattern);
        for (const key of keys) {
          result.push(key.slice(this.keyPrefix.length));
        }
      } catch {
        // If keys also fails, return empty array
        console.warn('[RememberPlugin:VercelKV] keys() operation not supported');
      }
    }

    return result;
  }

  /**
   * Gracefully close the provider.
   * No-op for Vercel KV as it uses stateless REST API.
   */
  async close(): Promise<void> {
    // No-op: Vercel KV uses stateless REST API
  }
}
