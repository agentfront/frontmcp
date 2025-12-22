/**
 * In-Memory Bundler Module
 *
 * Provides caching, security validation, and sandboxing for UI component builds.
 * Used for building widget templates at both build-time and runtime.
 *
 * Features:
 * - Content-addressable caching
 * - Security validation and sandboxing
 * - File-based component caching (filesystem and Redis)
 *
 * Note: The main InMemoryBundler with SSR support is in @frontmcp/ui package
 * as it requires React for server-side rendering.
 *
 * @example
 * ```typescript
 * import { ComponentBuilder, createFilesystemBuilder } from '@frontmcp/uipack/bundler';
 *
 * const builder = createFilesystemBuilder({ cacheDir: '.cache' });
 * const result = await builder.buildComponent(options);
 * ```
 *
 * @packageDocumentation
 */

// ============================================
// Main Bundler (requires React - use @frontmcp/ui)
// ============================================
// Note: InMemoryBundler and createBundler are in @frontmcp/ui
// as they require React for SSR functionality.

export { SecurityError } from './sandbox/policy';
export { ExecutionError } from './sandbox/executor';

// ============================================
// Types
// ============================================

export type {
  // Source types
  SourceType,
  OutputFormat,
  // Bundle options
  BundleOptions,
  SSRBundleOptions,
  BundlerOptions,
  EsbuildTransformOptions,
  // Results
  BundleResult,
  SSRResult,
  BundleMetrics,
  // Security
  SecurityPolicy,
  SecurityViolation,
  // Cache
  CacheEntry,
  // Context
  TransformContext,
  // Static HTML types
  TargetPlatform,
  StaticHTMLExternalConfig,
  StaticHTMLOptions,
  StaticHTMLResult,
} from './types';

export {
  // Default values
  DEFAULT_SECURITY_POLICY,
  DEFAULT_BUNDLE_OPTIONS,
  DEFAULT_BUNDLER_OPTIONS,
  // Static HTML constants
  DEFAULT_STATIC_HTML_OPTIONS,
  STATIC_HTML_CDN,
  getCdnTypeForPlatform,
} from './types';

// ============================================
// Cache Utilities
// ============================================

export { BundlerCache, hashContent, createCacheKey } from './cache';

export type { CacheOptions, CacheStats } from './cache';

// ============================================
// Security Utilities
// ============================================

export { validateSource, validateImports, validateSize, mergePolicy, throwOnViolations } from './sandbox/policy';

// ============================================
// Execution Utilities
// ============================================

export { executeCode, executeDefault, isExecutionError } from './sandbox/executor';

export type { ExecutionContext, ExecutionResult } from './sandbox/executor';

// ============================================
// File-Based Component Caching
// ============================================

export {
  // Storage
  type BuildCacheStorage,
  type StorageOptions,
  type CacheEntry as FileCacheEntry,
  type CacheEntryMetadata,
  DEFAULT_STORAGE_OPTIONS,
  calculateManifestSize,
  // Filesystem
  FilesystemStorage,
  createFilesystemStorage,
  type FilesystemStorageOptions,
  // Redis
  RedisStorage,
  createRedisStorage,
  type RedisStorageOptions,
  type RedisClient,
  // Hash Calculator
  sha256,
  sha256Buffer,
  hashFile,
  hashFiles,
  calculateComponentHash,
  calculateQuickHash,
  generateBuildId,
  buildIdFromHash,
  type ComponentHashOptions,
  type ComponentHashResult,
  // Component Builder
  ComponentBuilder,
  createFilesystemBuilder,
  createRedisBuilder,
  type ComponentBuildOptions,
  type ComponentBuildResult,
} from './file-cache';
