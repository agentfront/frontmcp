/**
 * Bundler Types
 *
 * Type definitions for the in-memory bundler system.
 *
 * @packageDocumentation
 */

// ============================================
// Source Types
// ============================================

/**
 * Source type for bundler input.
 */
export type SourceType = 'jsx' | 'tsx' | 'mdx' | 'html' | 'auto';

/**
 * Output format for bundles.
 */
export type OutputFormat = 'iife' | 'esm' | 'cjs';

// ============================================
// Bundle Options
// ============================================

/**
 * Options for bundling source code.
 */
export interface BundleOptions {
  /**
   * Source code to bundle.
   */
  source: string;

  /**
   * Source type (jsx, tsx, mdx, html, or auto).
   * @default 'auto'
   */
  sourceType?: SourceType;

  /**
   * Output format.
   * @default 'iife'
   */
  format?: OutputFormat;

  /**
   * Minify output code.
   * @default false
   */
  minify?: boolean;

  /**
   * Generate source maps.
   * @default false
   */
  sourceMaps?: boolean | 'inline';

  /**
   * External modules (not bundled).
   * @default ['react', 'react-dom']
   */
  externals?: string[];

  /**
   * JSX configuration.
   */
  jsx?: {
    /**
     * JSX runtime mode.
     * @default 'automatic'
     */
    runtime?: 'automatic' | 'classic';

    /**
     * Import source for automatic runtime.
     * @default 'react'
     */
    importSource?: string;
  };

  /**
   * Security policy for bundling.
   */
  security?: SecurityPolicy;

  /**
   * Target environment.
   * @default 'es2020'
   */
  target?: string;

  /**
   * Global variable name for IIFE format.
   * @default 'Widget'
   */
  globalName?: string;

  /**
   * Cache key override. If not provided, computed from source hash.
   */
  cacheKey?: string;

  /**
   * Skip cache lookup.
   * @default false
   */
  skipCache?: boolean;
}

/**
 * Options specifically for SSR bundling.
 */
export interface SSRBundleOptions extends BundleOptions {
  /**
   * Context data to inject during SSR.
   */
  context?: Record<string, unknown>;

  /**
   * Component export name to render.
   * @default 'default'
   */
  componentExport?: string;

  /**
   * Whether to include hydration script.
   * @default false
   */
  includeHydration?: boolean;
}

// ============================================
// Bundle Result
// ============================================

/**
 * Result of a bundle operation.
 */
export interface BundleResult {
  /**
   * Bundled/transformed code.
   */
  code: string;

  /**
   * Content hash of the bundle.
   */
  hash: string;

  /**
   * Whether result was served from cache.
   */
  cached: boolean;

  /**
   * Bundle size in bytes.
   */
  size: number;

  /**
   * Source map (if generated).
   */
  map?: string;

  /**
   * Performance metrics.
   */
  metrics: BundleMetrics;

  /**
   * Detected or specified source type.
   */
  sourceType: SourceType;

  /**
   * Output format used.
   */
  format: OutputFormat;
}

/**
 * Performance metrics for bundling.
 */
export interface BundleMetrics {
  /**
   * Time to transform source (ms).
   */
  transformTime: number;

  /**
   * Time to bundle (ms).
   */
  bundleTime: number;

  /**
   * Total processing time (ms).
   */
  totalTime: number;

  /**
   * Cache lookup time (ms).
   */
  cacheTime?: number;
}

// ============================================
// SSR Result
// ============================================

/**
 * Result of SSR rendering.
 */
export interface SSRResult extends BundleResult {
  /**
   * Rendered HTML output.
   */
  html: string;

  /**
   * Hydration script (if included).
   */
  hydrationScript?: string;

  /**
   * SSR-specific metrics.
   */
  ssrMetrics: {
    /**
     * Time to render component (ms).
     */
    renderTime: number;
  };
}

// ============================================
// Security Policy
// ============================================

/**
 * Security policy for bundler execution.
 */
export interface SecurityPolicy {
  /**
   * Allowed import patterns (regex).
   * @default [/^react/, /^@frontmcp\/ui/]
   */
  allowedImports?: RegExp[];

  /**
   * Blocked import patterns (regex).
   * @default [/^fs/, /^net/, /^child_process/, /^os/, /^path/]
   */
  blockedImports?: RegExp[];

  /**
   * Maximum bundle size in bytes.
   * @default 512000 (500KB)
   */
  maxBundleSize?: number;

  /**
   * Maximum transform time in ms.
   * @default 5000 (5s)
   */
  maxTransformTime?: number;

  /**
   * Block eval() and Function() usage.
   * @default true
   */
  noEval?: boolean;

  /**
   * Block dynamic imports.
   * @default true
   */
  noDynamicImports?: boolean;

  /**
   * Block require() usage.
   * @default true
   */
  noRequire?: boolean;

  /**
   * Allowed global variables.
   * @default ['console', 'Math', 'JSON', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'Reflect', 'Proxy', 'Error', 'TypeError', 'RangeError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'encodeURIComponent', 'decodeURI', 'decodeURIComponent', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']
   */
  allowedGlobals?: string[];
}

// ============================================
// Security Violation
// ============================================

/**
 * Security violation details.
 */
export interface SecurityViolation {
  /**
   * Type of violation.
   */
  type:
    | 'blocked-import'
    | 'disallowed-import'
    | 'eval-usage'
    | 'dynamic-import'
    | 'require-usage'
    | 'size-exceeded'
    | 'timeout'
    | 'blocked-global';

  /**
   * Human-readable message.
   */
  message: string;

  /**
   * Location in source (if available).
   */
  location?: {
    line: number;
    column: number;
  };

  /**
   * Offending pattern/value.
   */
  value?: string;
}

// ============================================
// Bundler Options
// ============================================

/**
 * Configuration options for creating a bundler instance.
 */
export interface BundlerOptions {
  /**
   * Default security policy.
   */
  defaultSecurity?: SecurityPolicy;

  /**
   * Cache configuration.
   */
  cache?: {
    /**
     * Maximum number of cached entries.
     * @default 100
     */
    maxSize?: number;

    /**
     * TTL for cache entries in ms.
     * @default 300000 (5 minutes)
     */
    ttl?: number;

    /**
     * Disable caching entirely.
     * @default false
     */
    disabled?: boolean;
  };

  /**
   * Enable verbose logging.
   * @default false
   */
  verbose?: boolean;

  /**
   * Custom esbuild options.
   */
  esbuildOptions?: Record<string, unknown>;
}

// ============================================
// Cache Entry
// ============================================

/**
 * Cache entry for bundled results.
 */
export interface CacheEntry {
  /**
   * Bundle result.
   */
  result: BundleResult;

  /**
   * Creation timestamp.
   */
  createdAt: number;

  /**
   * Last access timestamp.
   */
  lastAccessedAt: number;

  /**
   * Access count.
   */
  accessCount: number;
}

// ============================================
// Transform Context
// ============================================

/**
 * Context for transform operations.
 */
export interface TransformContext {
  /**
   * Source type being transformed.
   */
  sourceType: SourceType;

  /**
   * File path (for source maps).
   */
  filename?: string;

  /**
   * Source code.
   */
  source: string;

  /**
   * Active security policy.
   */
  security: SecurityPolicy;
}

// ============================================
// Default Values
// ============================================

/**
 * Default security policy.
 */
export const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
  allowedImports: [/^react$/, /^react-dom$/, /^react\/jsx-runtime$/, /^react\/jsx-dev-runtime$/, /^@frontmcp\/ui/],
  blockedImports: [
    /^fs$/,
    /^fs\//,
    /^net$/,
    /^child_process$/,
    /^os$/,
    /^path$/,
    /^crypto$/,
    /^http$/,
    /^https$/,
    /^dgram$/,
    /^dns$/,
    /^cluster$/,
    /^readline$/,
    /^repl$/,
    /^tls$/,
    /^vm$/,
    /^worker_threads$/,
  ],
  maxBundleSize: 512000, // 500KB
  maxTransformTime: 5000, // 5s
  noEval: true,
  noDynamicImports: true,
  noRequire: true,
  allowedGlobals: [
    'console',
    'Math',
    'JSON',
    'Date',
    'Array',
    'Object',
    'String',
    'Number',
    'Boolean',
    'Promise',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Symbol',
    'Reflect',
    'Proxy',
    'Error',
    'TypeError',
    'RangeError',
    'SyntaxError',
    'ReferenceError',
    'parseInt',
    'parseFloat',
    'isNaN',
    'isFinite',
    'encodeURI',
    'encodeURIComponent',
    'decodeURI',
    'decodeURIComponent',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'atob',
    'btoa',
    'Intl',
    'TextEncoder',
    'TextDecoder',
    'URL',
    'URLSearchParams',
    'Uint8Array',
    'Int8Array',
    'Uint16Array',
    'Int16Array',
    'Uint32Array',
    'Int32Array',
    'Float32Array',
    'Float64Array',
    'BigInt',
    'BigInt64Array',
    'BigUint64Array',
    'ArrayBuffer',
    'SharedArrayBuffer',
    'DataView',
    'queueMicrotask',
  ],
};

/**
 * Default bundle options.
 */
export const DEFAULT_BUNDLE_OPTIONS: Required<
  Pick<
    BundleOptions,
    'sourceType' | 'format' | 'minify' | 'sourceMaps' | 'externals' | 'jsx' | 'target' | 'globalName' | 'skipCache'
  >
> = {
  sourceType: 'auto',
  format: 'iife',
  minify: false,
  sourceMaps: false,
  externals: ['react', 'react-dom'],
  jsx: {
    runtime: 'automatic',
    importSource: 'react',
  },
  target: 'es2020',
  globalName: 'Widget',
  skipCache: false,
};

/**
 * Default bundler options.
 */
export const DEFAULT_BUNDLER_OPTIONS: Required<BundlerOptions> = {
  defaultSecurity: DEFAULT_SECURITY_POLICY,
  cache: {
    maxSize: 100,
    ttl: 300000, // 5 minutes
    disabled: false,
  },
  verbose: false,
  esbuildOptions: {},
};
