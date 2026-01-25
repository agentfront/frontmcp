// file: libs/sdk/src/skill/cache/skill-http-cache.ts

/**
 * Caching for skills HTTP endpoints.
 *
 * Provides a cache abstraction for skill HTTP responses to reduce
 * latency and CPU overhead for repeated requests.
 *
 * Supports:
 * - Memory cache (default, single-instance)
 * - Redis cache (distributed, multi-instance)
 *
 * @module skill/cache/skill-http-cache
 */

import type { SkillMetadata } from '../../common/metadata';

/**
 * Cache interface for skills HTTP endpoints.
 */
export interface SkillHttpCache {
  /** Cache type identifier */
  readonly type: 'memory' | 'redis';

  /**
   * Get cached /llm.txt content.
   * @returns Cached content or null if not cached/expired
   */
  getLlmTxt(): Promise<string | null>;

  /**
   * Set cached /llm.txt content.
   * @param content - Content to cache
   */
  setLlmTxt(content: string): Promise<void>;

  /**
   * Get cached /llm_full.txt content.
   * @returns Cached content or null if not cached/expired
   */
  getLlmFullTxt(): Promise<string | null>;

  /**
   * Set cached /llm_full.txt content.
   * @param content - Content to cache
   */
  setLlmFullTxt(content: string): Promise<void>;

  /**
   * Get cached skills list.
   * @param hash - Hash of filter parameters
   * @returns Cached skills or null if not cached/expired
   */
  getSkillsList(hash: string): Promise<SkillMetadata[] | null>;

  /**
   * Set cached skills list.
   * @param hash - Hash of filter parameters
   * @param skills - Skills to cache
   */
  setSkillsList(hash: string, skills: SkillMetadata[]): Promise<void>;

  /**
   * Get cached individual skill.
   * @param skillId - Skill identifier
   * @returns Cached skill data or null if not cached/expired
   */
  getSkill(skillId: string): Promise<unknown | null>;

  /**
   * Set cached individual skill.
   * @param skillId - Skill identifier
   * @param data - Skill data to cache
   */
  setSkill(skillId: string, data: unknown): Promise<void>;

  /**
   * Invalidate all cached data.
   */
  invalidateAll(): Promise<void>;

  /**
   * Invalidate cached data for a specific skill.
   * @param skillId - Skill identifier
   */
  invalidateSkill(skillId: string): Promise<void>;

  /**
   * Dispose of cache resources.
   */
  dispose(): Promise<void>;
}

/**
 * Cache entry with expiration.
 */
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * In-memory implementation of SkillHttpCache.
 *
 * Suitable for single-instance deployments.
 * Data is lost on process restart.
 */
export class MemorySkillHttpCache implements SkillHttpCache {
  readonly type = 'memory' as const;

  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly ttlMs: number;

  constructor(ttlMs = 60000) {
    this.ttlMs = ttlMs;
  }

  async getLlmTxt(): Promise<string | null> {
    return this.get<string>('llm.txt');
  }

  async setLlmTxt(content: string): Promise<void> {
    this.set('llm.txt', content);
  }

  async getLlmFullTxt(): Promise<string | null> {
    return this.get<string>('llm_full.txt');
  }

  async setLlmFullTxt(content: string): Promise<void> {
    this.set('llm_full.txt', content);
  }

  async getSkillsList(hash: string): Promise<SkillMetadata[] | null> {
    return this.get<SkillMetadata[]>(`list:${hash}`);
  }

  async setSkillsList(hash: string, skills: SkillMetadata[]): Promise<void> {
    this.set(`list:${hash}`, skills);
  }

  async getSkill(skillId: string): Promise<unknown | null> {
    return this.get<unknown>(`skill:${skillId}`);
  }

  async setSkill(skillId: string, data: unknown): Promise<void> {
    this.set(`skill:${skillId}`, data);
  }

  async invalidateAll(): Promise<void> {
    this.cache.clear();
  }

  async invalidateSkill(skillId: string): Promise<void> {
    // Invalidate specific skill
    this.cache.delete(`skill:${skillId}`);

    // Also invalidate list caches since they may contain this skill
    for (const key of this.cache.keys()) {
      if (key.startsWith('list:')) {
        this.cache.delete(key);
      }
    }

    // Invalidate llm.txt and llm_full.txt since they include all skills
    this.cache.delete('llm.txt');
    this.cache.delete('llm_full.txt');
  }

  async dispose(): Promise<void> {
    this.cache.clear();
  }

  private get<T>(key: string): T | null {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  private set(key: string, data: unknown): void {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.ttlMs,
    });
  }
}

/**
 * Redis implementation of SkillHttpCache.
 *
 * Suitable for distributed/multi-instance deployments.
 * Persists across process restarts (within TTL).
 */
export class RedisSkillHttpCache implements SkillHttpCache {
  readonly type = 'redis' as const;

  private readonly keyPrefix: string;
  private readonly ttlMs: number;
  private readonly getClient: () => Promise<RedisClient>;

  constructor(options: { getClient: () => Promise<RedisClient>; keyPrefix?: string; ttlMs?: number }) {
    this.getClient = options.getClient;
    this.keyPrefix = options.keyPrefix ?? 'frontmcp:skills:cache:';
    this.ttlMs = options.ttlMs ?? 60000;
  }

  async getLlmTxt(): Promise<string | null> {
    return this.get<string>('llm.txt');
  }

  async setLlmTxt(content: string): Promise<void> {
    await this.set('llm.txt', content);
  }

  async getLlmFullTxt(): Promise<string | null> {
    return this.get<string>('llm_full.txt');
  }

  async setLlmFullTxt(content: string): Promise<void> {
    await this.set('llm_full.txt', content);
  }

  async getSkillsList(hash: string): Promise<SkillMetadata[] | null> {
    return this.get<SkillMetadata[]>(`list:${hash}`);
  }

  async setSkillsList(hash: string, skills: SkillMetadata[]): Promise<void> {
    await this.set(`list:${hash}`, skills);
  }

  async getSkill(skillId: string): Promise<unknown | null> {
    return this.get<unknown>(`skill:${skillId}`);
  }

  async setSkill(skillId: string, data: unknown): Promise<void> {
    await this.set(`skill:${skillId}`, data);
  }

  async invalidateAll(): Promise<void> {
    try {
      const client = await this.getClient();
      const keys = await client.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } catch {
      // Ignore errors during invalidation
    }
  }

  async invalidateSkill(skillId: string): Promise<void> {
    try {
      const client = await this.getClient();

      // Get all list keys and the specific skill key
      const keysToDelete = [
        `${this.keyPrefix}skill:${skillId}`,
        `${this.keyPrefix}llm.txt`,
        `${this.keyPrefix}llm_full.txt`,
      ];

      // Also find and delete list caches
      const listKeys = await client.keys(`${this.keyPrefix}list:*`);
      keysToDelete.push(...listKeys);

      if (keysToDelete.length > 0) {
        await client.del(...keysToDelete);
      }
    } catch {
      // Ignore errors during invalidation
    }
  }

  async dispose(): Promise<void> {
    // Redis client lifecycle is managed externally
  }

  private async get<T>(key: string): Promise<T | null> {
    try {
      const client = await this.getClient();
      const value = await client.get(`${this.keyPrefix}${key}`);
      if (!value) return null;

      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private async set(key: string, data: unknown): Promise<void> {
    try {
      const client = await this.getClient();
      const serialized = JSON.stringify(data);
      const ttlSeconds = Math.ceil(this.ttlMs / 1000);

      await client.setex(`${this.keyPrefix}${key}`, ttlSeconds, serialized);
    } catch {
      // Ignore errors during cache set
    }
  }
}

/**
 * Minimal Redis client interface used by the cache.
 * Compatible with ioredis and @vercel/kv.
 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}
