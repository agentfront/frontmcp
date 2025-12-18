/**
 * Type Cache Module
 *
 * Exports cache adapters and utilities for TypeScript type caching.
 *
 * @packageDocumentation
 */

// Cache adapter interface
export { type TypeCacheAdapter, type TypeCacheOptions, DEFAULT_CACHE_OPTIONS } from './cache-adapter';

// Memory cache implementation
export { MemoryTypeCache, globalTypeCache } from './memory-cache';
