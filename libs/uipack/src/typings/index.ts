/**
 * TypeScript Type Fetching Engine
 *
 * Fetches TypeScript .d.ts files from esm.sh CDN based on import statements.
 * Resolves dependencies recursively and combines them into single outputs.
 *
 * @module @frontmcp/ui/typings
 *
 * @example Basic usage
 * ```typescript
 * import { createTypeFetcher } from '@frontmcp/ui/typings';
 *
 * const fetcher = createTypeFetcher({
 *   maxDepth: 2,
 *   timeout: 10000,
 *   maxConcurrency: 5,
 * });
 *
 * const result = await fetcher.fetchBatch({
 *   imports: [
 *     'import { Card } from "@frontmcp/ui/react"',
 *     'import React from "react"',
 *   ],
 * });
 *
 * // result.results[0].content = combined .d.ts for @frontmcp/ui
 * // result.results[1].content = combined .d.ts for react
 * ```
 *
 * @example With custom cache
 * ```typescript
 * import { createTypeFetcher, MemoryTypeCache } from '@frontmcp/ui/typings';
 *
 * const cache = new MemoryTypeCache({
 *   maxSize: 1000,
 *   defaultTtl: 2 * 60 * 60 * 1000, // 2 hours
 * });
 *
 * const fetcher = createTypeFetcher({}, cache);
 * ```
 */

// ============================================
// Types
// ============================================

export type {
  TypeFile,
  TypeFetchResult,
  TypeFetchError,
  TypeFetchErrorCode,
  TypeFetchBatchRequest,
  TypeFetchBatchResult,
  TypeCacheEntry,
  TypeCacheStats,
  DtsImport,
  DtsParseResult,
  TypeFetcherOptions,
  PackageResolution,
} from './types';

export { DEFAULT_TYPE_FETCHER_OPTIONS, TYPE_CACHE_PREFIX, DEFAULT_TYPE_CACHE_TTL } from './types';

// ============================================
// Schemas
// ============================================

export {
  // Error codes
  typeFetchErrorCodeSchema,
  // Type file schema
  typeFileSchema,
  // Result schemas
  typeFetchResultSchema,
  typeFetchErrorSchema,
  typeFetchBatchRequestSchema,
  typeFetchBatchResultSchema,
  // Cache schemas
  typeCacheEntrySchema,
  typeCacheStatsSchema,
  // DTS schemas
  dtsImportTypeSchema,
  dtsImportSchema,
  dtsParseResultSchema,
  // Options schemas
  typeFetcherOptionsSchema,
  packageResolutionSchema,
  // Validation helpers
  validateBatchRequest,
  safeParseBatchRequest,
  validateTypeFetcherOptions,
  safeParseTypeFetcherOptions,
  // Types from schemas
  type TypeFileInput,
  type TypeFileOutput,
  type TypeFetchErrorCodeInput,
  type TypeFetchErrorCodeOutput,
  type TypeFetchResultInput,
  type TypeFetchResultOutput,
  type TypeFetchErrorInput,
  type TypeFetchErrorOutput,
  type TypeFetchBatchRequestInput,
  type TypeFetchBatchRequestOutput,
  type TypeFetchBatchResultInput,
  type TypeFetchBatchResultOutput,
  type TypeCacheEntryInput,
  type TypeCacheEntryOutput,
  type TypeCacheStatsInput,
  type TypeCacheStatsOutput,
  type DtsImportInput,
  type DtsImportOutput,
  type DtsParseResultInput,
  type DtsParseResultOutput,
  type TypeFetcherOptionsInput,
  type TypeFetcherOptionsOutput,
  type PackageResolutionInput,
  type PackageResolutionOutput,
  type SafeParseResult,
} from './schemas';

// ============================================
// Cache
// ============================================

export {
  type TypeCacheAdapter,
  type TypeCacheOptions,
  DEFAULT_CACHE_OPTIONS,
  MemoryTypeCache,
  globalTypeCache,
} from './cache';

// ============================================
// DTS Parser
// ============================================

export {
  parseDtsImports,
  isRelativeImport,
  getPackageFromSpecifier,
  getSubpathFromSpecifier,
  parseImportStatement,
  combineDtsContents,
} from './dts-parser';

// ============================================
// Type Fetcher
// ============================================

export { TypeFetcher, createTypeFetcher } from './type-fetcher';
