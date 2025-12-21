/**
 * Vercel KV Store Adapter
 *
 * Store adapter implementation using Vercel KV (edge-compatible REST-based key-value store).
 * Uses dynamic import to avoid bundling @vercel/kv for non-Vercel deployments.
 *
 * @see https://vercel.com/docs/storage/vercel-kv
 */

import { StoreBaseAdapter } from './store.base.adapter';
import type { SetOptions } from '../store.types';

// Interface for the Vercel KV client (matches @vercel/kv API)
interface VercelKVClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ex?: number; px?: number }): Promise<void>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  mget<T = unknown>(...keys: string[]): Promise<(T | null)[]>;
  mset(data: Record<string, unknown>): Promise<void>;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
}

export interface VercelKvAdapterOptions {
  /**
   * KV REST API URL
   * @default process.env.KV_REST_API_URL
   */
  url?: string;

  /**
   * KV REST API Token
   * @default process.env.KV_REST_API_TOKEN
   */
  token?: string;

  /**
   * Key prefix for all keys
   * @default ''
   */
  keyPrefix?: string;
}

/**
 * Vercel KV Store Adapter
 *
 * Implements the StoreDriver interface using Vercel KV.
 * Note: Pub/Sub is not supported by Vercel KV (REST-based).
 * The base class provides no-op implementations for publish/subscribe.
 *
 * @example
 * ```typescript
 * const store = new ScopedVercelKvStore({
 *   url: process.env.KV_REST_API_URL,
 *   token: process.env.KV_REST_API_TOKEN,
 *   keyPrefix: 'myapp:',
 * });
 * await store.connect();
 * await store.set('key', 'value', { ttlSeconds: 3600 });
 * const value = await store.get('key');
 * ```
 */
export class ScopedVercelKvStore extends StoreBaseAdapter {
  private kv: VercelKVClient | null = null;
  private readonly opts: VercelKvAdapterOptions;

  constructor(opts: VercelKvAdapterOptions = {}) {
    super();
    this.opts = opts;
  }

  /**
   * Connect to Vercel KV
   * Uses dynamic import to avoid bundling @vercel/kv when not used
   */
  async connect(): Promise<void> {
    if (this.kv) return;

    // Dynamic import for tree-shaking
    const vercelKv = await import('@vercel/kv');

    const url = this.opts.url || process.env['KV_REST_API_URL'];
    const token = this.opts.token || process.env['KV_REST_API_TOKEN'];

    if (!url || !token) {
      throw new Error(
        'Vercel KV requires url and token. Set KV_REST_API_URL and KV_REST_API_TOKEN environment variables or provide them in config.',
      );
    }

    // Cast to our interface to avoid type compatibility issues
    this.kv = vercelKv.createClient({ url, token }) as unknown as VercelKVClient;
  }

  /**
   * Disconnect from Vercel KV
   * Vercel KV uses REST API, so there's no persistent connection to close
   */
  async disconnect(): Promise<void> {
    this.kv = null;
  }

  private ensureConnected(): VercelKVClient {
    if (!this.kv) {
      throw new Error('Vercel KV not connected. Call connect() first.');
    }
    return this.kv;
  }

  private prefixKey(key: string): string {
    return this.opts.keyPrefix ? `${this.opts.keyPrefix}${key}` : key;
  }

  async get(key: string): Promise<string | null> {
    const kv = this.ensureConnected();
    const result = await kv.get<string>(this.prefixKey(key));
    return result ?? null;
  }

  async set(key: string, value: string, opts?: SetOptions): Promise<void> {
    const kv = this.ensureConnected();
    const prefixedKey = this.prefixKey(key);

    if (opts?.ttlSeconds && opts.ttlSeconds > 0) {
      await kv.set(prefixedKey, value, { ex: Math.floor(opts.ttlSeconds) });
    } else {
      await kv.set(prefixedKey, value);
    }
  }

  async del(key: string): Promise<void> {
    const kv = this.ensureConnected();
    await kv.del(this.prefixKey(key));
  }

  async exists(key: string): Promise<boolean> {
    const kv = this.ensureConnected();
    const result = await kv.exists(this.prefixKey(key));
    return result === 1;
  }

  /**
   * Get multiple keys
   * Uses Vercel KV's mget for efficiency
   */
  override async mget(keys: string[]): Promise<(string | null)[]> {
    if (!keys.length) return [];
    const kv = this.ensureConnected();
    const prefixedKeys = keys.map((k) => this.prefixKey(k));
    const results = await kv.mget<string>(...prefixedKeys);
    return results.map((r) => r ?? null);
  }

  /**
   * Set multiple keys
   * Uses Vercel KV's mset for efficiency (no TTL support in bulk)
   * Falls back to sequential sets for TTL support
   */
  override async mset(entries: Array<{ key: string; value: string; opts?: SetOptions }>): Promise<void> {
    if (!entries.length) return;

    const kv = this.ensureConnected();
    const hasTtl = entries.some((e) => e.opts?.ttlSeconds && e.opts.ttlSeconds > 0);

    if (hasTtl) {
      // Sequential sets to support TTL
      for (const { key, value, opts } of entries) {
        await this.set(key, value, opts);
      }
    } else {
      // Bulk set without TTL
      const kvPairs: Record<string, string> = {};
      for (const { key, value } of entries) {
        kvPairs[this.prefixKey(key)] = value;
      }
      await kv.mset(kvPairs);
    }
  }

  async incr(key: string): Promise<number> {
    const kv = this.ensureConnected();
    return kv.incr(this.prefixKey(key));
  }

  async decr(key: string): Promise<number> {
    const kv = this.ensureConnected();
    return kv.decr(this.prefixKey(key));
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const kv = this.ensureConnected();
    await kv.expire(this.prefixKey(key), Math.floor(ttlSeconds));
  }

  async ttl(key: string): Promise<number | null> {
    const kv = this.ensureConnected();
    const t = await kv.ttl(this.prefixKey(key));
    return t < 0 ? null : t;
  }

  // Note: Pub/Sub is not supported by Vercel KV (REST-based)
  // Base class provides no-op implementations that return 0 for publish
  // and a no-op unsubscribe function for subscribe
}
