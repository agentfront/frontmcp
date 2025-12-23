/**
 * TypeScript Type Fetching Engine Schemas
 *
 * Zod validation schemas for type fetching configuration and results.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ============================================
// Error Code Schema
// ============================================

/**
 * Schema for type fetch error codes.
 */
export const typeFetchErrorCodeSchema = z.enum([
  'NETWORK_ERROR',
  'TIMEOUT',
  'NO_TYPES_HEADER',
  'INVALID_SPECIFIER',
  'PACKAGE_NOT_FOUND',
  'PARSE_ERROR',
]);

export type TypeFetchErrorCodeInput = z.input<typeof typeFetchErrorCodeSchema>;
export type TypeFetchErrorCodeOutput = z.output<typeof typeFetchErrorCodeSchema>;

// ============================================
// Type File Schema
// ============================================

/**
 * Schema for a single .d.ts file with its virtual path.
 * Used for browser editors that need individual files.
 */
export const typeFileSchema = z
  .object({
    path: z.string().min(1),
    url: z.string().url(),
    content: z.string(),
  })
  .strict();

export type TypeFileInput = z.input<typeof typeFileSchema>;
export type TypeFileOutput = z.output<typeof typeFileSchema>;

// ============================================
// Type Fetch Result Schema
// ============================================

/**
 * Schema for a single type fetch result.
 */
export const typeFetchResultSchema = z
  .object({
    specifier: z.string().min(1),
    resolvedPackage: z.string().min(1),
    version: z.string().min(1),
    content: z.string(),
    files: z.array(typeFileSchema),
    fetchedUrls: z.array(z.string().url()),
    fetchedAt: z.string().datetime(),
  })
  .strict();

export type TypeFetchResultInput = z.input<typeof typeFetchResultSchema>;
export type TypeFetchResultOutput = z.output<typeof typeFetchResultSchema>;

// ============================================
// Type Fetch Error Schema
// ============================================

/**
 * Schema for a type fetch error.
 */
export const typeFetchErrorSchema = z
  .object({
    specifier: z.string().min(1),
    code: typeFetchErrorCodeSchema,
    message: z.string().min(1),
    url: z.string().url().optional(),
  })
  .strict();

export type TypeFetchErrorInput = z.input<typeof typeFetchErrorSchema>;
export type TypeFetchErrorOutput = z.output<typeof typeFetchErrorSchema>;

// ============================================
// Batch Request Schema
// ============================================

/**
 * Schema for batch type fetch request.
 */
export const typeFetchBatchRequestSchema = z
  .object({
    imports: z.array(z.string().min(1)).min(1),
    maxDepth: z.number().int().min(0).max(10).optional(),
    timeout: z.number().int().min(1000).max(60000).optional(),
    maxConcurrency: z.number().int().min(1).max(20).optional(),
    skipCache: z.boolean().optional(),
    versionOverrides: z.record(z.string().min(1), z.string().min(1)).optional(),
  })
  .strict();

export type TypeFetchBatchRequestInput = z.input<typeof typeFetchBatchRequestSchema>;
export type TypeFetchBatchRequestOutput = z.output<typeof typeFetchBatchRequestSchema>;

// ============================================
// Batch Result Schema
// ============================================

/**
 * Schema for batch type fetch result.
 */
export const typeFetchBatchResultSchema = z
  .object({
    results: z.array(typeFetchResultSchema),
    errors: z.array(typeFetchErrorSchema),
    totalTimeMs: z.number().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    networkRequests: z.number().int().nonnegative(),
  })
  .strict();

export type TypeFetchBatchResultInput = z.input<typeof typeFetchBatchResultSchema>;
export type TypeFetchBatchResultOutput = z.output<typeof typeFetchBatchResultSchema>;

// ============================================
// Cache Entry Schema
// ============================================

/**
 * Schema for a cache entry.
 */
export const typeCacheEntrySchema = z
  .object({
    result: typeFetchResultSchema,
    cachedAt: z.number().int().positive(),
    size: z.number().int().nonnegative(),
    accessCount: z.number().int().nonnegative(),
  })
  .strict();

export type TypeCacheEntryInput = z.input<typeof typeCacheEntrySchema>;
export type TypeCacheEntryOutput = z.output<typeof typeCacheEntrySchema>;

// ============================================
// Cache Stats Schema
// ============================================

/**
 * Schema for cache statistics.
 */
export const typeCacheStatsSchema = z
  .object({
    entries: z.number().int().nonnegative(),
    totalSize: z.number().nonnegative(),
    hits: z.number().int().nonnegative(),
    misses: z.number().int().nonnegative(),
    hitRate: z.number().min(0).max(1),
  })
  .strict();

export type TypeCacheStatsInput = z.input<typeof typeCacheStatsSchema>;
export type TypeCacheStatsOutput = z.output<typeof typeCacheStatsSchema>;

// ============================================
// DTS Import Schema
// ============================================

/**
 * Schema for import type.
 */
export const dtsImportTypeSchema = z.enum(['import', 'export', 'reference', 'declare-module']);

/**
 * Schema for a parsed .d.ts import.
 */
export const dtsImportSchema = z
  .object({
    type: dtsImportTypeSchema,
    specifier: z.string().min(1),
    statement: z.string(),
    line: z.number().int().positive(),
  })
  .strict();

export type DtsImportInput = z.input<typeof dtsImportSchema>;
export type DtsImportOutput = z.output<typeof dtsImportSchema>;

// ============================================
// DTS Parse Result Schema
// ============================================

/**
 * Schema for .d.ts parse result.
 */
export const dtsParseResultSchema = z
  .object({
    imports: z.array(dtsImportSchema),
    externalPackages: z.array(z.string().min(1)),
    relativeImports: z.array(z.string()),
  })
  .strict();

export type DtsParseResultInput = z.input<typeof dtsParseResultSchema>;
export type DtsParseResultOutput = z.output<typeof dtsParseResultSchema>;

// ============================================
// Type Fetcher Options Schema
// ============================================

/**
 * Schema for type fetcher options.
 */
export const typeFetcherOptionsSchema = z
  .object({
    maxDepth: z.number().int().min(0).max(10).optional(),
    timeout: z.number().int().min(1000).max(60000).optional(),
    maxConcurrency: z.number().int().min(1).max(20).optional(),
    cdnBaseUrl: z.string().url().optional(),
  })
  .strict();

export type TypeFetcherOptionsInput = z.input<typeof typeFetcherOptionsSchema>;
export type TypeFetcherOptionsOutput = z.output<typeof typeFetcherOptionsSchema>;

// ============================================
// Package Resolution Schema
// ============================================

/**
 * Schema for package resolution result.
 */
export const packageResolutionSchema = z
  .object({
    packageName: z.string().min(1),
    subpath: z.string().optional(),
    version: z.string().min(1),
    typesUrl: z.string().url(),
  })
  .strict();

export type PackageResolutionInput = z.input<typeof packageResolutionSchema>;
export type PackageResolutionOutput = z.output<typeof packageResolutionSchema>;

// ============================================
// Validation Helpers
// ============================================

/**
 * Safe parse result type.
 */
export type SafeParseResult<T> = { success: true; data: T } | { success: false; error: z.ZodError };

/**
 * Validate a batch request.
 *
 * @param data - Data to validate
 * @returns Validated batch request or throws ZodError
 */
export function validateBatchRequest(data: unknown): TypeFetchBatchRequestOutput {
  return typeFetchBatchRequestSchema.parse(data);
}

/**
 * Safely validate a batch request.
 *
 * @param data - Data to validate
 * @returns Safe parse result with success flag
 */
export function safeParseBatchRequest(data: unknown): SafeParseResult<TypeFetchBatchRequestOutput> {
  return typeFetchBatchRequestSchema.safeParse(data) as SafeParseResult<TypeFetchBatchRequestOutput>;
}

/**
 * Validate type fetcher options.
 *
 * @param data - Data to validate
 * @returns Validated options or throws ZodError
 */
export function validateTypeFetcherOptions(data: unknown): TypeFetcherOptionsOutput {
  return typeFetcherOptionsSchema.parse(data);
}

/**
 * Safely validate type fetcher options.
 *
 * @param data - Data to validate
 * @returns Safe parse result with success flag
 */
export function safeParseTypeFetcherOptions(data: unknown): SafeParseResult<TypeFetcherOptionsOutput> {
  return typeFetcherOptionsSchema.safeParse(data) as SafeParseResult<TypeFetcherOptionsOutput>;
}
