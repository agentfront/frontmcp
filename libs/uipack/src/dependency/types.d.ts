/**
 * Dependency Resolution Types
 *
 * Type definitions for CDN dependency resolution, import mapping,
 * and file-based component bundling.
 *
 * @packageDocumentation
 */
import type { ZodTypeAny } from 'zod';
/**
 * Supported CDN providers for external library hosting.
 *
 * - `cloudflare`: cdnjs.cloudflare.com (REQUIRED for Claude compatibility)
 * - `jsdelivr`: cdn.jsdelivr.net
 * - `unpkg`: unpkg.com
 * - `esm.sh`: esm.sh (ES modules)
 * - `skypack`: cdn.skypack.dev (deprecated, fallback only)
 * - `custom`: User-defined CDN override (for explicit dependency configuration)
 */
export type CDNProvider = 'cloudflare' | 'jsdelivr' | 'unpkg' | 'esm.sh' | 'skypack' | 'custom';
/**
 * Platform types that affect CDN selection.
 *
 * - `claude`: Only allows cdnjs.cloudflare.com (blocked network)
 * - `openai`: Can use any CDN
 * - `cursor`: Can use any CDN
 * - `gemini`: Can use any CDN
 * - `unknown`: Defaults to cloudflare for maximum compatibility
 */
export type CDNPlatformType = 'claude' | 'openai' | 'cursor' | 'gemini' | 'continue' | 'cody' | 'unknown';
/**
 * Configuration for a single CDN dependency.
 *
 * Specifies how to load an external library from a CDN.
 *
 * @example
 * ```typescript
 * const chartJsDependency: CDNDependency = {
 *   url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
 *   integrity: 'sha512-...',
 *   global: 'Chart',
 *   esm: false,
 * };
 * ```
 */
export interface CDNDependency {
  /**
   * CDN URL for the library.
   * MUST be HTTPS.
   *
   * @example 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
   */
  url: string;
  /**
   * Subresource Integrity (SRI) hash for security.
   * Format: `sha256-...`, `sha384-...`, or `sha512-...`
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity
   * @example 'sha384-abc123...'
   */
  integrity?: string;
  /**
   * Global variable name exposed by the library (for UMD builds).
   * Used to map imports to window globals in the browser.
   *
   * @example 'Chart' for Chart.js, 'React' for React
   */
  global?: string;
  /**
   * Named exports to expose from the library.
   * If not specified, defaults to the default export or global.
   *
   * @example ['Chart', 'registerables'] for Chart.js
   */
  exports?: string[];
  /**
   * Whether this is an ES module (ESM) build.
   * ESM builds use `import` statements; UMD uses globals.
   *
   * @default false
   */
  esm?: boolean;
  /**
   * Cross-origin attribute for the script tag.
   *
   * @default 'anonymous'
   */
  crossorigin?: 'anonymous' | 'use-credentials';
  /**
   * Dependencies that must be loaded before this library.
   * Specified as npm package names (e.g., 'react' for react-dom).
   *
   * @example ['react'] for react-dom
   */
  peerDependencies?: string[];
}
/**
 * CDN configuration per provider for a package.
 * Allows different URLs/configurations for different CDN providers.
 */
export type CDNProviderConfig = Partial<Record<CDNProvider, CDNDependency>>;
/**
 * Target JavaScript version for bundling.
 */
export type BundleTarget = 'es2018' | 'es2019' | 'es2020' | 'es2021' | 'es2022' | 'esnext';
/**
 * Configuration options for bundling file-based components.
 *
 * @example
 * ```typescript
 * const devOptions: FileBundleOptions = {
 *   minify: false,
 *   sourceMaps: true,
 *   target: 'esnext',
 * };
 * ```
 */
export interface FileBundleOptions {
  /**
   * Minify the bundled output.
   *
   * @default true in production, false in development
   */
  minify?: boolean;
  /**
   * Generate source maps for debugging.
   *
   * @default false
   */
  sourceMaps?: boolean;
  /**
   * Target JavaScript version.
   *
   * @default 'es2020'
   */
  target?: BundleTarget;
  /**
   * Enable tree shaking to remove unused code.
   *
   * @default true
   */
  treeShake?: boolean;
  /**
   * JSX factory function.
   *
   * @default 'React.createElement'
   */
  jsxFactory?: string;
  /**
   * JSX fragment factory.
   *
   * @default 'React.Fragment'
   */
  jsxFragment?: string;
  /**
   * JSX import source for automatic runtime.
   *
   * @default 'react'
   */
  jsxImportSource?: string;
}
/**
 * Extended UI template configuration with file-based template support.
 *
 * Extends the base UITemplateConfig to support:
 * - File paths as templates (e.g., './chart-widget.tsx')
 * - External library dependencies via CDN
 * - Custom bundle options
 *
 * @example
 * ```typescript
 * const uiConfig: FileTemplateConfig = {
 *   template: './widgets/chart-widget.tsx',
 *   externals: ['chart.js', 'react-chartjs-2'],
 *   dependencies: {
 *     'chart.js': {
 *       url: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
 *       integrity: 'sha512-...',
 *       global: 'Chart',
 *     },
 *   },
 *   bundleOptions: {
 *     minify: true,
 *     target: 'es2020',
 *   },
 * };
 * ```
 */
export interface FileTemplateConfig {
  /**
   * Packages to load from CDN instead of bundling.
   * These packages will be excluded from the bundle and loaded
   * via import maps at runtime.
   *
   * Package names should match npm package names.
   *
   * @example ['chart.js', 'react-chartjs-2', 'd3']
   */
  externals?: string[];
  /**
   * Explicit CDN dependency overrides.
   * Use this to specify custom CDN URLs or override the default
   * CDN registry entries for specific packages.
   *
   * Keys are npm package names.
   */
  dependencies?: Record<string, CDNDependency>;
  /**
   * Bundle options for file-based templates.
   */
  bundleOptions?: FileBundleOptions;
}
/**
 * Browser import map structure.
 * @see https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap
 */
export interface ImportMap {
  /**
   * Module specifier to URL mappings.
   *
   * @example { 'chart.js': 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js' }
   */
  imports: Record<string, string>;
  /**
   * Scoped mappings for specific paths.
   */
  scopes?: Record<string, Record<string, string>>;
  /**
   * Integrity hashes for imported modules.
   * Maps URLs to their SRI hashes.
   */
  integrity?: Record<string, string>;
}
/**
 * Entry for a resolved dependency.
 */
export interface ResolvedDependency {
  /**
   * NPM package name.
   */
  packageName: string;
  /**
   * Resolved version string.
   */
  version: string;
  /**
   * CDN URL for the package.
   */
  cdnUrl: string;
  /**
   * SRI integrity hash (if available).
   */
  integrity?: string;
  /**
   * Global variable name (for UMD).
   */
  global?: string;
  /**
   * Whether this is an ES module.
   */
  esm: boolean;
  /**
   * CDN provider used.
   */
  provider: CDNProvider;
}
/**
 * Build manifest for a compiled file-based component.
 * Stored in cache for incremental builds.
 */
export interface ComponentBuildManifest {
  /**
   * Manifest format version.
   */
  version: '1.0';
  /**
   * Unique build identifier.
   */
  buildId: string;
  /**
   * Tool name this component belongs to.
   */
  toolName: string;
  /**
   * Original entry file path (relative to project root).
   */
  entryPath: string;
  /**
   * SHA-256 hash of entry file + dependencies + options.
   * Used as cache key for incremental builds.
   */
  contentHash: string;
  /**
   * Resolved external dependencies.
   */
  dependencies: ResolvedDependency[];
  /**
   * Build outputs.
   */
  outputs: {
    /**
     * Bundled JavaScript code.
     */
    code: string;
    /**
     * Source map (if generated).
     */
    sourceMap?: string;
    /**
     * Pre-rendered HTML (if SSR was performed).
     */
    ssrHtml?: string;
  };
  /**
   * Generated import map for this component.
   */
  importMap: ImportMap;
  /**
   * Build metadata.
   */
  metadata: {
    /**
     * ISO timestamp of when the build was created.
     */
    createdAt: string;
    /**
     * Build time in milliseconds.
     */
    buildTimeMs: number;
    /**
     * Total size of bundled output in bytes.
     */
    totalSize: number;
    /**
     * esbuild/bundler version used.
     */
    bundlerVersion?: string;
  };
}
/**
 * Abstract interface for build cache storage.
 * Implementations include filesystem (dev) and Redis (prod).
 */
export interface BuildCacheStorage {
  /**
   * Get a cached build manifest by key.
   *
   * @param key - Cache key (typically the content hash)
   * @returns The cached manifest or undefined if not found
   */
  get(key: string): Promise<ComponentBuildManifest | undefined>;
  /**
   * Store a build manifest in cache.
   *
   * @param key - Cache key
   * @param manifest - Build manifest to store
   * @param ttl - Optional TTL in seconds
   */
  set(key: string, manifest: ComponentBuildManifest, ttl?: number): Promise<void>;
  /**
   * Check if a key exists in cache.
   *
   * @param key - Cache key to check
   * @returns true if the key exists
   */
  has(key: string): Promise<boolean>;
  /**
   * Delete a cached entry.
   *
   * @param key - Cache key to delete
   * @returns true if the entry was deleted
   */
  delete(key: string): Promise<boolean>;
  /**
   * Clear all cached entries.
   */
  clear(): Promise<void>;
  /**
   * Get cache statistics.
   */
  getStats(): Promise<CacheStats>;
}
/**
 * Cache statistics.
 */
export interface CacheStats {
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
/**
 * Entry in the CDN registry for a known package.
 */
export interface CDNRegistryEntry {
  /**
   * NPM package name.
   */
  packageName: string;
  /**
   * Default/recommended version.
   */
  defaultVersion: string;
  /**
   * CDN configurations per provider.
   */
  providers: CDNProviderConfig;
  /**
   * Preferred CDN provider order.
   * First available provider is used.
   *
   * @default ['cloudflare', 'jsdelivr', 'unpkg', 'esm.sh']
   */
  preferredProviders?: CDNProvider[];
  /**
   * Package metadata.
   */
  metadata?: {
    /**
     * Human-readable description.
     */
    description?: string;
    /**
     * Homepage URL.
     */
    homepage?: string;
    /**
     * License identifier.
     */
    license?: string;
  };
}
/**
 * The full CDN registry mapping package names to their CDN configurations.
 */
export type CDNRegistry = Record<string, CDNRegistryEntry>;
/**
 * Options for resolving dependencies.
 */
export interface DependencyResolverOptions {
  /**
   * Target platform for CDN selection.
   * Affects which CDN provider is used.
   *
   * @default 'unknown'
   */
  platform?: CDNPlatformType;
  /**
   * Preferred CDN providers in order of preference.
   * If not specified, uses platform-specific defaults.
   */
  preferredProviders?: CDNProvider[];
  /**
   * Custom CDN registry to merge with defaults.
   */
  customRegistry?: CDNRegistry;
  /**
   * Whether to fail on unresolved dependencies.
   * If false, unresolved deps are bundled instead.
   *
   * @default true
   */
  strictMode?: boolean;
  /**
   * Whether to require SRI integrity hashes.
   *
   * @default false
   */
  requireIntegrity?: boolean;
}
/**
 * A parsed import statement from source code.
 */
export interface ParsedImport {
  /**
   * Full import statement as it appears in source.
   *
   * @example "import { Chart } from 'chart.js'"
   */
  statement: string;
  /**
   * Module specifier (package name or path).
   *
   * @example 'chart.js', './utils', '@org/package'
   */
  specifier: string;
  /**
   * Import type.
   */
  type: 'named' | 'default' | 'namespace' | 'side-effect' | 'dynamic';
  /**
   * Named imports (for named import type).
   *
   * @example ['Chart', 'registerables']
   */
  namedImports?: string[];
  /**
   * Default import name (for default import type).
   *
   * @example 'React'
   */
  defaultImport?: string;
  /**
   * Namespace import name (for namespace import type).
   *
   * @example 'd3' for `import * as d3 from 'd3'`
   */
  namespaceImport?: string;
  /**
   * Line number in source (1-indexed).
   */
  line: number;
  /**
   * Column number in source (0-indexed).
   */
  column: number;
}
/**
 * Result of parsing imports from a source file.
 */
export interface ParsedImportResult {
  /**
   * All parsed imports.
   */
  imports: ParsedImport[];
  /**
   * External package imports (npm packages).
   */
  externalImports: ParsedImport[];
  /**
   * Relative imports (local files).
   */
  relativeImports: ParsedImport[];
  /**
   * Unique external package names.
   */
  externalPackages: string[];
}
/**
 * Detected template mode for a UI configuration.
 */
export type TemplateMode = 'inline-function' | 'inline-string' | 'file-path' | 'url';
/**
 * Detect the template mode from a template value.
 *
 * @param template - The template value from UITemplateConfig
 * @returns The detected template mode
 */
export declare function detectTemplateMode(template: unknown): TemplateMode;
/**
 * Template format detected from file extension or content.
 *
 * - `react`: .tsx/.jsx files (React components, bundled with esbuild)
 * - `mdx`: .mdx files (Markdown + JSX, Handlebars → MDX Renderer)
 * - `markdown`: .md files (Markdown, Handlebars → marked)
 * - `html`: .html files or inline strings (Handlebars only)
 */
export type TemplateFormat = 'react' | 'mdx' | 'markdown' | 'html';
/**
 * Template source discriminated union.
 * Represents where the template content comes from.
 */
export type TemplateSource =
  | {
      type: 'inline';
      content: string;
    }
  | {
      type: 'file';
      path: string;
    }
  | {
      type: 'url';
      url: string;
    };
/**
 * Result of fetching a template from a URL.
 */
export interface UrlFetchResult {
  /**
   * Fetched template content.
   */
  content: string;
  /**
   * ETag header for cache validation.
   */
  etag?: string;
  /**
   * Content-Type header.
   */
  contentType?: string;
  /**
   * ISO timestamp when the content was fetched.
   */
  fetchedAt: string;
}
/**
 * A resolved template ready for processing.
 * Contains the raw content and metadata about the source.
 */
export interface ResolvedTemplate {
  /**
   * Original template source.
   */
  source: TemplateSource;
  /**
   * Detected template format.
   */
  format: TemplateFormat;
  /**
   * Raw template content (fetched/read from source).
   */
  content: string;
  /**
   * SHA-256 hash of the content for caching.
   */
  hash: string;
  /**
   * Additional metadata depending on source type.
   */
  metadata?: {
    /**
     * ISO timestamp when URL content was fetched.
     */
    fetchedAt?: string;
    /**
     * ETag for URL cache validation.
     */
    etag?: string;
    /**
     * Content-Type from URL response.
     */
    contentType?: string;
    /**
     * Original file path (resolved absolute path).
     */
    resolvedPath?: string;
  };
}
/**
 * Options for processing a resolved template.
 */
export interface TemplateProcessingOptions {
  /**
   * Context data for Handlebars/React rendering.
   */
  context: {
    /**
     * Tool input arguments.
     */
    input: unknown;
    /**
     * Tool output/result.
     */
    output: unknown;
    /**
     * Parsed structured content (optional).
     */
    structuredContent?: unknown;
  };
  /**
   * Target platform for CDN selection.
   */
  platform?: CDNPlatformType;
  /**
   * Custom Handlebars helpers.
   */
  handlebarsHelpers?: Record<string, (...args: unknown[]) => unknown>;
  /**
   * Base path for resolving relative file paths.
   */
  basePath?: string;
  /**
   * Zod schema for output validation.
   *
   * When provided in development mode (NODE_ENV !== 'production'),
   * the template will be validated against this schema to catch
   * Handlebars expressions referencing non-existent fields.
   */
  outputSchema?: ZodTypeAny;
  /**
   * Zod schema for input validation.
   *
   * When provided in development mode (NODE_ENV !== 'production'),
   * the template will also validate {{input.*}} expressions.
   */
  inputSchema?: ZodTypeAny;
  /**
   * Tool name for validation error messages.
   */
  toolName?: string;
}
/**
 * Result of processing a template.
 */
export type ProcessedTemplate =
  | {
      /**
       * Rendered HTML output (for html, markdown, mdx formats).
       */
      html: string;
      /**
       * Template format that was processed.
       */
      format: 'html' | 'markdown' | 'mdx';
    }
  | {
      /**
       * Bundled JavaScript code (for react format).
       */
      code: string;
      /**
       * Template format.
       */
      format: 'react';
      /**
       * Indicates React templates need bundling.
       */
      needsBundling: true;
    };
/**
 * Detect template format from a file path or URL.
 *
 * @param pathOrUrl - File path or URL to detect format from
 * @returns The detected template format
 */
export declare function detectFormatFromPath(pathOrUrl: string): TemplateFormat;
//# sourceMappingURL=types.d.ts.map
