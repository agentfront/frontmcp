/**
 * TypeScript Type Fetching Engine Types
 *
 * Type definitions for fetching and combining TypeScript .d.ts files
 * from esm.sh CDN based on import statements.
 *
 * @packageDocumentation
 */

// ============================================
// Type Fetch Result Types
// ============================================

/**
 * A single .d.ts file with its virtual path and content.
 * Used for browser editors that need individual files instead of combined content.
 *
 * @example
 * ```typescript
 * const file: TypeFile = {
 *   path: 'node_modules/zod/lib/types.d.ts',
 *   url: 'https://esm.sh/v135/zod@3.23.8/lib/types.d.ts',
 *   content: 'export declare const string: ...',
 * };
 * ```
 */
export interface TypeFile {
  /**
   * Virtual file path for the browser editor (e.g., 'node_modules/zod/lib/types.d.ts').
   * Constructed from the package name and URL path.
   */
  path: string;

  /**
   * Original URL where this file was fetched from.
   */
  url: string;

  /**
   * The .d.ts file content.
   */
  content: string;
}

/**
 * Result of fetching types for a single import specifier.
 *
 * @example
 * ```typescript
 * const result: TypeFetchResult = {
 *   specifier: '@frontmcp/ui/react',
 *   resolvedPackage: '@frontmcp/ui',
 *   version: '1.0.0',
 *   content: '// Combined .d.ts content...',
 *   fetchedUrls: ['https://esm.sh/v135/@frontmcp/ui@1.0.0/index.d.ts'],
 *   fetchedAt: '2024-01-01T00:00:00.000Z',
 * };
 * ```
 */
export interface TypeFetchResult {
  /**
   * Original import specifier from the import statement.
   *
   * @example '@frontmcp/ui/react', 'react', 'lodash/debounce'
   */
  specifier: string;

  /**
   * Resolved package name (may differ from specifier due to path fallback).
   *
   * @example '@frontmcp/ui' when specifier was '@frontmcp/ui/react'
   */
  resolvedPackage: string;

  /**
   * Subpath from the original specifier (if any).
   * Used for creating alias entry points for nested imports.
   *
   * @example 'react' when specifier was '@frontmcp/ui/react'
   */
  subpath?: string;

  /**
   * Version of the package used for type fetching.
   *
   * @example '18.2.0', 'latest'
   */
  version: string;

  /**
   * Combined .d.ts content for this import.
   * Includes all resolved dependencies combined into a single string.
   *
   * @deprecated Use `files` array for better browser editor compatibility.
   * Combined content may not work correctly for complex packages like Zod.
   */
  content: string;

  /**
   * Individual .d.ts files with virtual paths for browser editors.
   * Each file contains its own content and path, preserving the original structure.
   *
   * Use this instead of `content` for browser editor integration.
   *
   * @example
   * ```typescript
   * // Access individual files for Monaco/CodeMirror integration
   * for (const file of result.files) {
   *   monaco.languages.typescript.typescriptDefaults.addExtraLib(
   *     file.content,
   *     `file:///${file.path}`
   *   );
   * }
   * ```
   */
  files: TypeFile[];

  /**
   * All URLs that were fetched to build this result.
   * Useful for debugging and cache invalidation.
   */
  fetchedUrls: string[];

  /**
   * ISO timestamp when this result was fetched.
   */
  fetchedAt: string;
}

/**
 * Error information for a failed type fetch.
 */
export interface TypeFetchError {
  /**
   * Original import specifier that failed.
   */
  specifier: string;

  /**
   * Error code for programmatic handling.
   */
  code: TypeFetchErrorCode;

  /**
   * Human-readable error message.
   */
  message: string;

  /**
   * URL that caused the error (if applicable).
   */
  url?: string;
}

/**
 * Error codes for type fetching failures.
 */
export type TypeFetchErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'NO_TYPES_HEADER'
  | 'INVALID_SPECIFIER'
  | 'PACKAGE_NOT_FOUND'
  | 'PACKAGE_NOT_ALLOWED'
  | 'PARSE_ERROR';

// ============================================
// Batch Request/Response Types
// ============================================

/**
 * Request for fetching types for multiple imports.
 *
 * @example
 * ```typescript
 * const request: TypeFetchBatchRequest = {
 *   imports: [
 *     'import { Card } from "@frontmcp/ui/react"',
 *     'import React from "react"',
 *   ],
 *   maxDepth: 2,
 *   timeout: 10000,
 *   maxConcurrency: 5,
 * };
 * ```
 */
export interface TypeFetchBatchRequest {
  /**
   * Array of import statements to process.
   *
   * @example ['import { Card } from "@frontmcp/ui/react"', 'import React from "react"']
   */
  imports: string[];

  /**
   * Maximum depth for recursive dependency resolution.
   * Prevents infinite loops and limits network requests.
   *
   * @default 2
   */
  maxDepth?: number;

  /**
   * Timeout in milliseconds for each network request.
   *
   * @default 10000
   */
  timeout?: number;

  /**
   * Maximum concurrent network requests.
   *
   * @default 5
   */
  maxConcurrency?: number;

  /**
   * Skip the cache and fetch fresh types.
   *
   * @default false
   */
  skipCache?: boolean;

  /**
   * Version overrides for specific packages.
   * Keys are package names, values are version strings.
   *
   * @example { 'react': '18.2.0', '@frontmcp/ui': '1.0.0' }
   */
  versionOverrides?: Record<string, string>;
}

/**
 * Result of a batch type fetch operation.
 */
export interface TypeFetchBatchResult {
  /**
   * Successfully fetched type results.
   */
  results: TypeFetchResult[];

  /**
   * Errors encountered during fetching.
   */
  errors: TypeFetchError[];

  /**
   * Total time taken in milliseconds.
   */
  totalTimeMs: number;

  /**
   * Number of cache hits.
   */
  cacheHits: number;

  /**
   * Number of network requests made.
   */
  networkRequests: number;
}

// ============================================
// Cache Types
// ============================================

/**
 * Cache entry for a fetched type result.
 */
export interface TypeCacheEntry {
  /**
   * The cached type fetch result.
   */
  result: TypeFetchResult;

  /**
   * Timestamp when this entry was cached.
   */
  cachedAt: number;

  /**
   * Size of the content in bytes.
   */
  size: number;

  /**
   * Number of times this entry was accessed.
   */
  accessCount: number;
}

/**
 * Cache statistics.
 */
export interface TypeCacheStats {
  /**
   * Number of entries in cache.
   */
  entries: number;

  /**
   * Total size of cached data in bytes.
   */
  totalSize: number;

  /**
   * Number of cache hits.
   */
  hits: number;

  /**
   * Number of cache misses.
   */
  misses: number;

  /**
   * Cache hit rate (0-1).
   */
  hitRate: number;
}

// ============================================
// DTS Parser Types
// ============================================

/**
 * Import/export found in a .d.ts file.
 */
export interface DtsImport {
  /**
   * Type of import/export/reference.
   */
  type: 'import' | 'export' | 'reference' | 'declare-module';

  /**
   * Module specifier (package name or relative path).
   *
   * @example 'react', './types', '@types/node'
   */
  specifier: string;

  /**
   * Full statement as it appears in the .d.ts file.
   */
  statement: string;

  /**
   * Line number in source (1-indexed).
   */
  line: number;
}

/**
 * Result of parsing a .d.ts file.
 */
export interface DtsParseResult {
  /**
   * All imports/exports/references found.
   */
  imports: DtsImport[];

  /**
   * External package dependencies (npm packages).
   */
  externalPackages: string[];

  /**
   * Relative imports (local .d.ts files).
   */
  relativeImports: string[];
}

// ============================================
// Type Fetcher Options
// ============================================

/**
 * Options for creating a TypeFetcher instance.
 */
export interface TypeFetcherOptions {
  /**
   * Maximum depth for recursive dependency resolution.
   *
   * @default 2
   */
  maxDepth?: number;

  /**
   * Timeout in milliseconds for each network request.
   *
   * @default 10000
   */
  timeout?: number;

  /**
   * Maximum concurrent network requests.
   *
   * @default 5
   */
  maxConcurrency?: number;

  /**
   * Base URL for esm.sh CDN.
   *
   * @default 'https://esm.sh'
   */
  cdnBaseUrl?: string;

  /**
   * Custom fetch function (for testing or proxying).
   */
  fetch?: typeof globalThis.fetch;

  /**
   * Additional packages to allow beyond the default allowlist.
   * Supports glob patterns (e.g., '@myorg/*').
   * Set to `false` to disable the allowlist and allow all packages.
   *
   * Default allowlist: react, react-dom, react/jsx-runtime, zod, @frontmcp/*
   *
   * @default [] (uses default allowlist only)
   */
  allowedPackages?: string[] | false;
}

// ============================================
// Package Resolution Types
// ============================================

/**
 * Result of resolving a package specifier.
 */
export interface PackageResolution {
  /**
   * Resolved package name.
   *
   * @example '@frontmcp/ui' when specifier was '@frontmcp/ui/react'
   */
  packageName: string;

  /**
   * Subpath within the package (if any).
   *
   * @example 'react' when specifier was '@frontmcp/ui/react'
   */
  subpath?: string;

  /**
   * Resolved version.
   */
  version: string;

  /**
   * URL for the TypeScript types.
   */
  typesUrl: string;
}

// ============================================
// Constants
// ============================================

/**
 * Default allowed packages for type fetching.
 * These packages are always allowed unless the allowlist is disabled.
 */
export const DEFAULT_ALLOWED_PACKAGES = ['react', 'react-dom', 'react/jsx-runtime', 'zod', '@frontmcp/*'] as const;

/**
 * Default options for TypeFetcher.
 */
export const DEFAULT_TYPE_FETCHER_OPTIONS: Required<Omit<TypeFetcherOptions, 'fetch'>> = {
  allowedPackages: [...DEFAULT_ALLOWED_PACKAGES],
  maxDepth: 4,
  timeout: 10000,
  maxConcurrency: 5,
  cdnBaseUrl: 'https://esm.sh',
};

/**
 * Cache key prefix for type cache entries.
 */
export const TYPE_CACHE_PREFIX = 'types:';

/**
 * Default cache TTL in milliseconds (1 hour).
 */
export const DEFAULT_TYPE_CACHE_TTL = 60 * 60 * 1000;
