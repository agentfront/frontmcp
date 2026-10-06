import { Provider, ProviderScope } from '@frontmcp/sdk';
import { createVercelKvClient, type VercelKvConnection } from '@frontmcp/utils';

import {
  callerKeyOf,
  doubledPrefixKey,
  prefixedStoreKey,
  SET_IF_NEITHER_KEY_EXISTS_SCRIPT,
} from './remember-key-prefix';
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
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
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
  private readonly connection: VercelKvConnection;
  private client?: Promise<VercelKvClient>;
  private readonly keyPrefix: string;
  private readonly defaultTTL?: number;

  constructor(options: RememberVercelKvProviderOptions = {}) {
    // Validate partial configuration
    const hasUrl = options.url !== undefined;
    const hasToken = options.token !== undefined;
    if (hasUrl !== hasToken) {
      throw new Error(
        `RememberVercelKvProvider: Both 'url' and 'token' must be provided together, or neither. ` +
          `Received: url=${hasUrl ? 'provided' : 'missing'}, token=${hasToken ? 'provided' : 'missing'}`,
      );
    }

    this.connection = { url: options.url, token: options.token };
    this.keyPrefix = options.keyPrefix ?? 'remember:';
    this.defaultTTL = options.defaultTTL;
  }

  /**
   * The client, built on first use from the url and token (or KV_REST_API_URL / KV_REST_API_TOKEN)
   * by the shared loader, which a Cloudflare Worker can bundle (#711). Values are read back as
   * stored. A failed attempt is retried.
   */
  private kv(): Promise<VercelKvClient> {
    this.client ??= createVercelKvClient<VercelKvClient>(this.connection).catch((error: unknown) => {
      this.client = undefined;
      throw error;
    });
    return this.client;
  }

  private prefixKey(key: string): string {
    return prefixedStoreKey(this.keyPrefix, key);
  }

  /**
   * Store a value with optional TTL.
   */
  async setValue(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const fullKey = this.prefixKey(key);
    const strValue = JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTTL;
    const kv = await this.kv();

    if (ttl && ttl > 0) {
      await kv.set(fullKey, strValue, { ex: ttl });
    } else {
      await kv.set(fullKey, strValue);
    }
    await this.deleteDoubledPrefixKey(key);
  }

  /**
   * Store a value only if the key is absent, via the `nx` option.
   *
   * Resolves to `'OK'` when it created the key and `null` when the key already existed, so two
   * callers racing cannot both win. A key that releases up to 1.9.1 may hold under the doubled
   * prefix counts as present too: one script checks both keys and writes, so an entry still there
   * is never shadowed.
   */
  async setIfAbsent(key: string, value: unknown, ttlSeconds?: number): Promise<boolean> {
    const fullKey = this.prefixKey(key);
    const strValue = JSON.stringify(value);
    const ttl = ttlSeconds ?? this.defaultTTL;
    const doubledKey = doubledPrefixKey(this.keyPrefix, key);
    const kv = await this.kv();

    if (doubledKey) {
      const ttlArgument = ttl && ttl > 0 ? String(ttl) : '';
      const created = await kv.eval(SET_IF_NEITHER_KEY_EXISTS_SCRIPT, [fullKey, doubledKey], [strValue, ttlArgument]);
      return Number(created) === 1;
    }

    const result =
      ttl && ttl > 0
        ? await kv.set(fullKey, strValue, { nx: true, ex: ttl })
        : await kv.set(fullKey, strValue, { nx: true });

    return result === 'OK';
  }

  /**
   * Retrieve a value by key.
   */
  async getValue<T = unknown>(key: string, defaultValue?: T): Promise<T | undefined> {
    const kv = await this.kv();
    const raw = (await kv.get(this.prefixKey(key))) ?? (await this.readDoubledPrefixValue(key));

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
    const kv = await this.kv();
    await kv.del(this.prefixKey(key));
    await this.deleteDoubledPrefixKey(key);
  }

  /**
   * Check if a key exists.
   */
  async exists(key: string): Promise<boolean> {
    const kv = await this.kv();
    if ((await kv.exists(this.prefixKey(key))) === 1) return true;
    const doubledKey = doubledPrefixKey(this.keyPrefix, key);
    return doubledKey !== undefined && (await kv.exists(doubledKey)) === 1;
  }

  /**
   * List keys matching a pattern.
   * Uses SCAN for efficient iteration.
   */
  async keys(pattern = '*'): Promise<string[]> {
    const result = new Set<string>();
    for (const key of await this.scan(this.prefixKey(pattern))) {
      result.add(callerKeyOf(this.keyPrefix, pattern, key));
    }
    const doubledPattern = doubledPrefixKey(this.keyPrefix, pattern);
    if (doubledPattern) {
      for (const key of await this.scan(doubledPattern)) result.add(key.slice(this.keyPrefix.length));
    }
    return [...result];
  }

  private async scan(match: string): Promise<string[]> {
    const found: string[] = [];
    const kv = await this.kv();
    try {
      // Try using scan if available (Upstash Redis API)
      let cursor: string | number = 0;
      do {
        const [nextCursor, keys] = await kv.scan(cursor, { match, count: 100 });
        cursor = nextCursor;
        found.push(...keys);
      } while (String(cursor) !== '0');
    } catch {
      // Fallback to keys command if scan not available
      try {
        found.push(...(await kv.keys(match)));
      } catch {
        // If keys also fails, return empty array
        console.warn('[RememberPlugin:VercelKV] keys() operation not supported');
      }
    }
    return found;
  }

  /**
   * The stored text of an entry a release up to 1.9.1 wrote under the doubled key, or null. It is read
   * in place, not copied: the entry keeps its TTL, a rolled-back release still finds it, and a
   * concurrent `delete()` cannot be undone by a copy. The next write or delete of the key removes it.
   */
  private async readDoubledPrefixValue(key: string): Promise<string | null> {
    const doubledKey = doubledPrefixKey(this.keyPrefix, key);
    if (!doubledKey) return null;
    const kv = await this.kv();
    return kv.get(doubledKey);
  }

  /** Drops what releases up to 1.9.1 left under the doubled key, so it cannot come back once this key is gone. */
  private async deleteDoubledPrefixKey(key: string): Promise<void> {
    const doubledKey = doubledPrefixKey(this.keyPrefix, key);
    if (!doubledKey) return;
    const kv = await this.kv();
    await kv.del(doubledKey);
  }

  /**
   * Gracefully close the provider.
   * No-op for Vercel KV as it uses stateless REST API.
   */
  async close(): Promise<void> {
    // No-op: Vercel KV uses stateless REST API
  }
}
