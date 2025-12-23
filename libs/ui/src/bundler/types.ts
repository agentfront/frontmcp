/**
 * Bundler Types
 *
 * Type definitions for the in-memory bundler system.
 *
 * @packageDocumentation
 */

import type { ThemeConfig } from '@frontmcp/uipack/theme';

// ============================================
// Build Mode Types
// ============================================

/**
 * Build mode for static HTML generation.
 * Controls how tool data is injected into the generated HTML.
 *
 * - 'static': Data is baked into HTML at build time (current default behavior)
 * - 'dynamic': HTML subscribes to platform events for data updates (OpenAI onToolResult)
 * - 'hybrid': Pre-built shell with placeholder for runtime data injection
 */
export type BuildMode = 'static' | 'dynamic' | 'hybrid';

/**
 * Placeholder marker for hybrid mode output.
 * Used as a string that callers can replace with actual JSON data.
 */
export const HYBRID_DATA_PLACEHOLDER = '__FRONTMCP_OUTPUT_PLACEHOLDER__';

/**
 * Placeholder marker for hybrid mode input.
 * Used as a string that callers can replace with actual JSON data.
 */
export const HYBRID_INPUT_PLACEHOLDER = '__FRONTMCP_INPUT_PLACEHOLDER__';

/**
 * Dynamic mode configuration options.
 */
export interface DynamicModeOptions {
  /**
   * Whether to include initial data in the HTML.
   * If true, component shows data immediately; if false, shows loading state.
   * @default true
   */
  includeInitialData?: boolean;

  /**
   * Subscribe to platform tool result events.
   * For OpenAI: window.openai.canvas.onToolResult
   * @default true
   */
  subscribeToUpdates?: boolean;
}

/**
 * Hybrid mode configuration options.
 */
export interface HybridModeOptions {
  /**
   * Custom placeholder string for output data injection.
   * @default HYBRID_DATA_PLACEHOLDER
   */
  placeholder?: string;

  /**
   * Custom placeholder string for input data injection.
   * @default HYBRID_INPUT_PLACEHOLDER
   */
  inputPlaceholder?: string;
}

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
// Esbuild Transform Options
// ============================================

/**
 * Options passed to esbuild transform API.
 * @see https://esbuild.github.io/api/#transform
 */
export interface EsbuildTransformOptions {
  /**
   * File type for the input.
   */
  loader?: 'js' | 'jsx' | 'ts' | 'tsx' | 'json' | 'text' | 'css';

  /**
   * Minify the output.
   */
  minify?: boolean;

  /**
   * Generate source maps.
   */
  sourcemap?: boolean | 'inline' | 'external' | 'both';

  /**
   * Target environment (e.g., 'es2020', 'esnext').
   */
  target?: string | string[];

  /**
   * Output format.
   */
  format?: 'iife' | 'cjs' | 'esm';

  /**
   * JSX factory function (classic mode).
   */
  jsxFactory?: string;

  /**
   * JSX fragment factory function (classic mode).
   */
  jsxFragment?: string;

  /**
   * JSX mode: 'transform' (classic) or 'automatic' (React 17+).
   */
  jsx?: 'transform' | 'preserve' | 'automatic';

  /**
   * Import source for automatic JSX runtime.
   */
  jsxImportSource?: string;

  /**
   * Global name for IIFE output.
   */
  globalName?: string;

  /**
   * Keep names (function/class names) for debugging.
   */
  keepNames?: boolean;

  /**
   * Drop console/debugger statements.
   */
  drop?: ('console' | 'debugger')[];

  /**
   * Define global constants.
   */
  define?: Record<string, string>;

  /**
   * Pure function calls that can be removed if unused.
   */
  pure?: string[];

  /**
   * Charset for output files.
   */
  charset?: 'ascii' | 'utf8';

  /**
   * Legal comments handling.
   */
  legalComments?: 'none' | 'inline' | 'eof' | 'linked' | 'external';

  /**
   * Supported features override.
   */
  supported?: Record<string, boolean>;
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
   * Custom esbuild transform options.
   * @see EsbuildTransformOptions
   */
  esbuildOptions?: EsbuildTransformOptions;
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

// ============================================
// Static HTML Types
// ============================================

/**
 * Target platform for CDN selection.
 * Affects which CDN URLs are used for externals.
 *
 * - 'auto': Auto-detect from environment (default)
 * - 'openai': OpenAI ChatGPT/Plugins - uses esm.sh
 * - 'claude': Claude Artifacts - uses cdnjs.cloudflare.com (only trusted CDN)
 * - 'cursor': Cursor IDE - uses esm.sh
 * - 'ext-apps': MCP Apps (SEP-1865) - uses esm.sh
 * - 'generic': Generic platform - uses esm.sh with frontmcp/* namespace
 */
export type TargetPlatform = 'auto' | 'openai' | 'claude' | 'cursor' | 'ext-apps' | 'generic';

/**
 * Concrete platform type (excludes 'auto').
 * Used for multi-platform builds where a specific platform must be targeted.
 */
export type ConcretePlatform = Exclude<TargetPlatform, 'auto'>;

/**
 * All platforms that can be targeted for multi-platform builds.
 * Order: OpenAI, Claude, Cursor, ext-apps, Generic
 */
export const ALL_PLATFORMS: readonly ConcretePlatform[] = [
  'openai',
  'claude',
  'cursor',
  'ext-apps',
  'generic',
] as const;

/**
 * Configuration for external dependencies in static HTML bundling.
 * Each dependency can be:
 * - 'cdn': Load from platform-appropriate CDN (default)
 * - 'inline': Embed script content directly in HTML
 * - string: Custom CDN URL
 */
export interface StaticHTMLExternalConfig {
  /**
   * React runtime configuration.
   * @default 'cdn' - Uses esm.sh for most platforms, cdnjs for Claude
   */
  react?: 'cdn' | 'inline' | string;

  /**
   * react-dom/client runtime configuration.
   * @default 'cdn' - Uses esm.sh for most platforms, cdnjs for Claude
   */
  reactDom?: 'cdn' | 'inline' | string;

  /**
   * Tailwind CSS configuration.
   * @default 'cdn' - Uses jsdelivr for most platforms, cdnjs for Claude
   */
  tailwind?: 'cdn' | 'inline' | string;

  /**
   * FrontMCP UI components (Card, Badge, Button, etc.) and hooks.
   * @default 'inline' - Always inlined for reliability
   */
  frontmcpUi?: 'cdn' | 'inline' | string;
}

/**
 * Options for bundling a component to static HTML.
 */
export interface StaticHTMLOptions {
  /**
   * Source code of the component (JSX/TSX).
   */
  source: string;

  /**
   * Source type for the component.
   * @default 'auto' - Auto-detect from content
   */
  sourceType?: SourceType;

  /**
   * Tool name (used for page title and data injection).
   */
  toolName: string;

  /**
   * Tool input arguments to embed in HTML.
   */
  input?: Record<string, unknown>;

  /**
   * Tool output to embed in HTML.
   */
  output?: unknown;

  /**
   * Structured content to embed in HTML.
   */
  structuredContent?: unknown;

  /**
   * External dependency configuration.
   * Controls whether dependencies are loaded from CDN or inlined.
   */
  externals?: StaticHTMLExternalConfig;

  /**
   * Target platform for CDN selection.
   * @default 'auto'
   */
  targetPlatform?: TargetPlatform;

  /**
   * Page title.
   * @default `${toolName} - Widget`
   */
  title?: string;

  /**
   * Whether the widget can call tools via the bridge.
   * @default false
   */
  widgetAccessible?: boolean;

  /**
   * Minify the transpiled component code.
   * @default true
   */
  minify?: boolean;

  /**
   * Security policy for transpilation.
   */
  security?: SecurityPolicy;

  /**
   * Skip bundle cache lookup.
   * @default false
   */
  skipCache?: boolean;

  /**
   * Root element ID for React rendering.
   * @default 'frontmcp-widget-root'
   */
  rootId?: string;

  /**
   * Custom CSS to inject after Tailwind CSS.
   * Can be used to add component-specific styles or override Tailwind defaults.
   *
   * @example
   * ```typescript
   * customCss: `
   *   .custom-card { border-radius: 12px; }
   *   h2 { font-size: 1.5rem; font-weight: 600; }
   * `
   * ```
   */
  customCss?: string;

  /**
   * Theme configuration for CSS variables.
   * When provided, theme CSS variables (--color-primary, --color-border, etc.)
   * will be injected into the HTML as :root CSS variables.
   *
   * If not provided, uses DEFAULT_THEME from @frontmcp/uipack.
   *
   * @example
   * ```typescript
   * import { createTheme, DEFAULT_THEME } from '@frontmcp/uipack/theme';
   *
   * // Use default theme
   * theme: DEFAULT_THEME
   *
   * // Or create custom theme
   * theme: createTheme({
   *   colors: { semantic: { primary: '#0969da' } }
   * })
   * ```
   */
  theme?: ThemeConfig;

  // ============================================
  // Universal Mode Options
  // ============================================

  /**
   * Enable universal rendering mode.
   * When true, the bundler generates a universal React app that can
   * render multiple content types (HTML, Markdown, React, MDX) with
   * auto-detection.
   *
   * @default false
   */
  universal?: boolean;

  /**
   * Content type for universal mode.
   * Only used when `universal: true`.
   *
   * - 'html': Raw HTML (rendered with dangerouslySetInnerHTML)
   * - 'markdown': Markdown content (rendered with react-markdown)
   * - 'react': React component (rendered directly)
   * - 'mdx': MDX content (Markdown + JSX)
   *
   * @default 'auto' - Auto-detect from content
   */
  contentType?: 'html' | 'markdown' | 'react' | 'mdx' | 'auto';

  /**
   * Include markdown renderer in universal mode.
   * Adds react-markdown from esm.sh (~15KB gzipped).
   * For Claude (UMD mode), uses inline minimal parser instead.
   *
   * @default false
   */
  includeMarkdown?: boolean;

  /**
   * Include MDX renderer in universal mode.
   * Adds @mdx-js/react from esm.sh (~40KB gzipped).
   * Note: MDX is not available on Claude (no cdnjs package).
   *
   * @default false
   */
  includeMdx?: boolean;

  /**
   * Custom components available for Markdown/MDX rendering.
   * Provided as inline JavaScript code that defines the components.
   *
   * @example
   * ```typescript
   * customComponents: `
   *   const WeatherCard = ({ temp }) => (
   *     React.createElement('div', { className: 'text-4xl' }, temp + '°F')
   *   );
   *   window.__frontmcp.components = { WeatherCard };
   * `
   * ```
   */
  customComponents?: string;

  // ============================================
  // Build Mode Options
  // ============================================

  /**
   * Build mode for data injection.
   * - 'static': Data baked in at build time (default)
   * - 'dynamic': Subscribes to platform events for updates (OpenAI)
   * - 'hybrid': Shell with placeholder for runtime data injection
   * @default 'static'
   */
  buildMode?: BuildMode;

  /**
   * Options for dynamic build mode.
   * Only used when buildMode is 'dynamic'.
   */
  dynamicOptions?: DynamicModeOptions;

  /**
   * Options for hybrid build mode.
   * Only used when buildMode is 'hybrid'.
   */
  hybridOptions?: HybridModeOptions;
}

/**
 * Result of bundling a component to static HTML.
 */
export interface StaticHTMLResult {
  /**
   * Complete HTML document ready for rendering.
   */
  html: string;

  /**
   * Transpiled component code (for debugging/inspection).
   */
  componentCode: string;

  /**
   * Bundle metrics from transpilation.
   */
  metrics: BundleMetrics;

  /**
   * Content hash of the HTML document.
   */
  hash: string;

  /**
   * HTML document size in bytes.
   */
  size: number;

  /**
   * Whether the component was served from cache.
   */
  cached: boolean;

  /**
   * Detected source type.
   */
  sourceType: SourceType;

  /**
   * Target platform used for CDN selection.
   */
  targetPlatform: TargetPlatform;

  /**
   * Whether universal rendering mode was used.
   */
  universal?: boolean;

  /**
   * Content type detected/used (when universal mode is enabled).
   */
  contentType?: 'html' | 'markdown' | 'react' | 'mdx';

  /**
   * Build mode used for data injection.
   */
  buildMode?: BuildMode;

  /**
   * For hybrid mode: the output placeholder string that can be replaced with data.
   * Use injectHybridData() from @frontmcp/uipack to replace this placeholder.
   */
  dataPlaceholder?: string;

  /**
   * For hybrid mode: the input placeholder string that can be replaced with data.
   * Use injectHybridDataFull() from @frontmcp/uipack to replace both placeholders.
   */
  inputPlaceholder?: string;
}

/**
 * CDN URLs for different platforms.
 * - esm: ES modules (OpenAI, Cursor, generic)
 * - umd: UMD globals (Claude - only trusts cdnjs.cloudflare.com)
 */
export const STATIC_HTML_CDN = {
  /**
   * ES modules from esm.sh (React 19, modern platforms)
   */
  esm: {
    react: 'https://esm.sh/react@19',
    reactDom: 'https://esm.sh/react-dom@19/client',
  },
  /**
   * UMD builds from cdnjs (React 18.2, Claude only trusts cloudflare)
   */
  umd: {
    react: 'https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js',
    reactDom: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js',
  },
  /**
   * Font CDN URLs
   */
  fonts: {
    preconnect: ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
    inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
} as const;

/**
 * Get the CDN type for a target platform.
 * @param platform - Target platform
 * @returns 'esm' for ES modules, 'umd' for UMD globals
 */
export function getCdnTypeForPlatform(platform: TargetPlatform): 'esm' | 'umd' {
  if (platform === 'claude') return 'umd';
  return 'esm'; // OpenAI, Cursor, generic all use esm.sh
}

/**
 * Default static HTML options.
 */
export const DEFAULT_STATIC_HTML_OPTIONS = {
  sourceType: 'auto' as SourceType,
  targetPlatform: 'auto' as TargetPlatform,
  minify: true,
  skipCache: false,
  rootId: 'frontmcp-widget-root',
  widgetAccessible: false,
  externals: {
    react: 'cdn' as const,
    reactDom: 'cdn' as const,
    tailwind: 'cdn' as const,
    frontmcpUi: 'inline' as const,
  },
  // Universal mode defaults
  universal: false,
  contentType: 'auto' as const,
  includeMarkdown: false,
  includeMdx: false,
  // Build mode defaults
  buildMode: 'static' as BuildMode,
} as const;

// ============================================
// Merged Options Type
// ============================================

/**
 * Internal type for merged static HTML options.
 * Used by bundler methods after merging user options with defaults.
 */
export type MergedStaticHTMLOptions = Required<
  Pick<
    StaticHTMLOptions,
    | 'sourceType'
    | 'targetPlatform'
    | 'minify'
    | 'skipCache'
    | 'rootId'
    | 'widgetAccessible'
    | 'externals'
    | 'universal'
    | 'contentType'
    | 'includeMarkdown'
    | 'includeMdx'
    | 'buildMode'
  >
> &
  Pick<
    StaticHTMLOptions,
    | 'toolName'
    | 'input'
    | 'output'
    | 'structuredContent'
    | 'title'
    | 'security'
    | 'customCss'
    | 'customComponents'
    | 'theme'
    | 'dynamicOptions'
    | 'hybridOptions'
  >;

// ============================================
// Multi-Platform Build Types
// ============================================

/**
 * Options for building for multiple platforms at once.
 * Extends StaticHTMLOptions but replaces targetPlatform with platforms array.
 */
export interface MultiPlatformBuildOptions extends Omit<StaticHTMLOptions, 'targetPlatform'> {
  /**
   * Platforms to build for.
   * @default ALL_PLATFORMS (all 5 platforms)
   */
  platforms?: ConcretePlatform[];
}

/**
 * Result for a single platform in multi-platform build.
 * Extends StaticHTMLResult with platform-specific metadata.
 */
export interface PlatformBuildResult extends StaticHTMLResult {
  /**
   * Platform-specific metadata for tool response _meta field.
   * Ready to merge into MCP response.
   *
   * Contains namespace-prefixed fields like:
   * - OpenAI: openai/html, openai/mimeType, etc.
   * - Claude: frontmcp/html, claude/widgetDescription, etc.
   * - Generic: frontmcp/html, frontmcp/widgetAccessible, etc.
   * - ext-apps: ui/html, ui/mimeType, ui/csp, etc.
   */
  meta: Record<string, unknown>;
}

/**
 * Result of building for multiple platforms.
 * Contains all platform-specific builds with shared metrics.
 */
export interface MultiPlatformBuildResult {
  /**
   * Results keyed by platform name.
   * Each platform has its own HTML and metadata.
   */
  platforms: Record<ConcretePlatform, PlatformBuildResult>;

  /**
   * Shared component code (transpiled once, reused).
   * All platforms share this code to avoid redundant transpilation.
   */
  sharedComponentCode: string;

  /**
   * Multi-platform build metrics.
   */
  metrics: {
    /** Time to transpile component (once) in ms */
    transpileTime: number;
    /** Time to generate all platform variants in ms */
    generationTime: number;
    /** Total time in ms */
    totalTime: number;
  };

  /**
   * Whether component was served from cache.
   */
  cached: boolean;
}
