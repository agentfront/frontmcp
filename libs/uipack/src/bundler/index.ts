/**
 * In-Memory Bundler Module
 *
 * Provides caching, security validation for UI component builds.
 * Used for building widget templates at both build-time and runtime.
 *
 * Note: The main InMemoryBundler with SSR support is in @frontmcp/ui package
 * as it requires React for server-side rendering.
 *
 * @packageDocumentation
 */

// ============================================
// Main Bundler (requires React - use @frontmcp/ui)
// ============================================
// Note: InMemoryBundler and createBundler are in @frontmcp/ui
// as they require React for SSR functionality.

export { SecurityError } from './sandbox/policy';

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
