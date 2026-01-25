// file: libs/sdk/src/skill/cache/skill-http-cache.holder.ts

/**
 * Singleton holder for skill HTTP cache instances.
 *
 * This provides a way to share cache instances across flows
 * without requiring full scope integration.
 *
 * @module skill/cache/skill-http-cache.holder
 */

import type { ScopeEntry } from '../../common/index.js';
import { SkillHttpCache, MemorySkillHttpCache } from './skill-http-cache.js';
import { createSkillHttpCache } from './skill-http-cache.factory.js';

/**
 * Cache holder keyed by scope ID.
 * Allows each scope to have its own cache instance.
 */
const cacheByScope = new Map<string, SkillHttpCache>();

/**
 * Pending cache creation promises to avoid race conditions.
 */
const pendingCreation = new Map<string, Promise<SkillHttpCache>>();

/**
 * Get or create a skill HTTP cache for a scope.
 *
 * @param scope - The scope entry
 * @returns Cache instance (may be shared with other flows in same scope)
 */
export async function getSkillHttpCache(scope: ScopeEntry): Promise<SkillHttpCache | null> {
  const skillsConfig = scope.metadata.skillsConfig;
  const cacheConfig = skillsConfig?.cache;

  // Return null if caching is disabled
  if (!cacheConfig?.enabled) {
    return null;
  }

  const scopeId = scope.metadata.id;

  // Check if cache already exists
  const existing = cacheByScope.get(scopeId);
  if (existing) {
    return existing;
  }

  // Check if creation is in progress
  const pending = pendingCreation.get(scopeId);
  if (pending) {
    return pending;
  }

  // Create cache
  const creationPromise = createCacheForScope(scopeId, cacheConfig);
  pendingCreation.set(scopeId, creationPromise);

  try {
    const cache = await creationPromise;
    cacheByScope.set(scopeId, cache);
    return cache;
  } finally {
    pendingCreation.delete(scopeId);
  }
}

/**
 * Cache configuration type from SkillsConfigOptions.
 */
interface CacheConfig {
  enabled?: boolean;
  redis?: {
    provider: 'redis' | 'ioredis' | 'vercel-kv' | '@vercel/kv';
    host?: string;
    port?: number;
    password?: string;
    db?: number;
  };
  ttlMs?: number;
  keyPrefix?: string;
}

/**
 * Create a cache instance for a scope.
 */
async function createCacheForScope(scopeId: string, cacheConfig: CacheConfig): Promise<SkillHttpCache> {
  try {
    const { cache } = await createSkillHttpCache({
      redis: cacheConfig.redis,
      ttlMs: cacheConfig.ttlMs,
      keyPrefix: cacheConfig.keyPrefix ?? `frontmcp:skills:${scopeId}:cache:`,
    });
    return cache;
  } catch {
    // Fall back to memory cache on error
    return new MemorySkillHttpCache(cacheConfig.ttlMs ?? 60000);
  }
}

/**
 * Invalidate cache for a scope.
 *
 * @param scopeId - Scope identifier
 */
export async function invalidateScopeCache(scopeId: string): Promise<void> {
  const cache = cacheByScope.get(scopeId);
  if (cache) {
    await cache.invalidateAll();
  }
}

/**
 * Invalidate a specific skill in a scope's cache.
 *
 * @param scopeId - Scope identifier
 * @param skillId - Skill identifier
 */
export async function invalidateSkillInCache(scopeId: string, skillId: string): Promise<void> {
  const cache = cacheByScope.get(scopeId);
  if (cache) {
    await cache.invalidateSkill(skillId);
  }
}

/**
 * Dispose all caches (for testing/cleanup).
 */
export async function disposeAllCaches(): Promise<void> {
  for (const cache of cacheByScope.values()) {
    await cache.dispose();
  }
  cacheByScope.clear();
  pendingCreation.clear();
}
