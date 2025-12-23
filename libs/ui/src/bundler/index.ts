/**
 * In-Memory Bundler Module
 *
 * Provides fast, secure bundling for JSX/TSX/MDX sources.
 * Used for building widget templates at both build-time and runtime.
 *
 * Features:
 * - esbuild-based transformation (fallback to SWC)
 * - Content-addressable caching
 * - Security validation and sandboxing
 * - SSR support for React components
 *
 * @example
 * ```typescript
 * import { createBundler } from '@frontmcp/ui/bundler';
 *
 * const bundler = createBundler();
 *
 * // Bundle JSX source
 * const result = await bundler.bundle({
 *   source: 'const App = () => <div>Hello</div>; export default App;',
 *   sourceType: 'jsx',
 * });
 *
 * // SSR rendering
 * const ssrResult = await bundler.bundleSSR({
 *   source: 'export default ({ data }) => <div>{data.message}</div>',
 *   context: { data: { message: 'Hello' } },
 * });
 * ```
 *
 * @packageDocumentation
 */

// ============================================
// Main Bundler
// ============================================

export { InMemoryBundler, createBundler, SecurityError, ExecutionError } from './bundler';

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
  ConcretePlatform,
  StaticHTMLExternalConfig,
  StaticHTMLOptions,
  StaticHTMLResult,
  // Multi-platform build types
  MultiPlatformBuildOptions,
  PlatformBuildResult,
  MultiPlatformBuildResult,
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
  // Multi-platform build constants
  ALL_PLATFORMS,
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
