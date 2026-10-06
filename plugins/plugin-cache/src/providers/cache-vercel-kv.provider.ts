import { Provider, ProviderScope } from '@frontmcp/sdk';
import { createVercelKvClient, type VercelKvConnection } from '@frontmcp/utils';

import { type CacheStoreInterface } from '../cache.types';

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
  private readonly connection: VercelKvConnection;
  private client?: Promise<VercelKvClient>;
  private readonly keyPrefix: string;
  private readonly defaultTTL: number;

  constructor(options: CacheVercelKvProviderOptions = {}) {
    // Validate partial configuration - both url and token must be provided together, or neither
    const hasUrl = options.url !== undefined;
    const hasToken = options.token !== undefined;
    if (hasUrl !== hasToken) {
      throw new Error(
        `CacheVercelKvProvider: Both 'url' and 'token' must be provided together, or neither. ` +
          `Received: url=${hasUrl ? 'provided' : 'missing'}, token=${hasToken ? 'provided' : 'missing'}`,
      );
    }

    this.connection = { url: options.url, token: options.token };
    this.keyPrefix = options.keyPrefix ?? 'cache:';
    this.defaultTTL = options.defaultTTL ?? 60 * 60 * 24; // 1 day default
  }

  /**
   * The client, built on first use from the url and token (or KV_REST_API_URL / KV_REST_API_TOKEN)
   * by the shared loader, which a Cloudflare Worker can bundle (#711). A failed attempt is retried.
   */
  private kv(): Promise<VercelKvClient> {
    this.client ??= createVercelKvClient<VercelKvClient>(this.connection).catch((error: unknown) => {
      this.client = undefined;
      throw error;
    });
    return this.client;
  }

  private prefixKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  /** Set a value (auto-stringifies objects) */
  async setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const strValue = typeof value === 'string' ? value : JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTTL;
    const kv = await this.kv();

    if (ttl > 0) {
      await kv.set(this.prefixKey(key), strValue, { ex: ttl });
    } else {
      await kv.set(this.prefixKey(key), strValue);
    }
  }

  /** Get a value and automatically parse JSON if possible */
  async getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    const kv = await this.kv();
    const raw = await kv.get(this.prefixKey(key));
    if (raw === null || raw === undefined) return defaultValue;

    // Values come back exactly as stored; parse JSON when the value is JSON
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
    const kv = await this.kv();
    await kv.del(this.prefixKey(key));
  }

  /** Check if a key exists */
  async exists(key: string): Promise<boolean> {
    const kv = await this.kv();
    return (await kv.exists(this.prefixKey(key))) === 1;
  }

  /** Gracefully close the provider (no-op for Vercel KV - stateless REST API) */
  async close(): Promise<void> {
    // No-op: Vercel KV uses stateless REST API, no connection to close
  }
}
