/**
 * @frontmcp/plugin-cache - Browser Entry Point
 *
 * Provides the browser-compatible subset of the cache plugin.
 * Only memory-based caching is available in the browser — Redis and Vercel KV are excluded.
 *
 * @packageDocumentation
 */

export { default, default as CachePlugin } from './cache.plugin';
export * from './cache.types';
