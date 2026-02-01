// file: libs/sdk/src/skill/cache/index.ts

/**
 * Skill HTTP Caching
 *
 * Provides caching for skills HTTP endpoints to reduce latency
 * and resource usage for repeated requests.
 *
 * @module skill/cache
 */

export { SkillHttpCache, MemorySkillHttpCache, RedisSkillHttpCache } from './skill-http-cache.js';
export { createSkillHttpCache } from './skill-http-cache.factory.js';
export type {
  SkillHttpCacheOptions,
  SkillHttpCacheResult,
  SkillHttpCacheRedisOptions,
} from './skill-http-cache.factory.js';
export {
  getSkillHttpCache,
  invalidateScopeCache,
  invalidateSkillInCache,
  disposeAllCaches,
} from './skill-http-cache.holder.js';
