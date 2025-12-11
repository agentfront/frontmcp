/**
 * In-Memory Bundler
 *
 * Fast, secure bundler for JSX/TSX/MDX sources using esbuild.
 * Provides caching, security validation, and SSR support.
 *
 * @packageDocumentation
 */

import type {
  BundleOptions,
  BundleResult,
  SSRBundleOptions,
  SSRResult,
  BundlerOptions,
  SecurityPolicy,
  SourceType,
  OutputFormat,
} from './types';
import { DEFAULT_BUNDLE_OPTIONS, DEFAULT_BUNDLER_OPTIONS, DEFAULT_SECURITY_POLICY } from './types';
import { BundlerCache, createCacheKey, hashContent } from './cache';
import { validateSource, validateSize, mergePolicy, throwOnViolations, SecurityError } from './sandbox/policy';
import { executeCode, executeDefault, ExecutionError } from './sandbox/executor';

/**
 * Lazy-loaded esbuild transform function.
 */
let esbuildTransform: ((source: string, options: object) => Promise<{ code: string; map?: string }>) | null = null;

/**
 * Load esbuild transform function.
 */
async function loadEsbuild(): Promise<typeof esbuildTransform> {
  if (esbuildTransform !== null) {
    return esbuildTransform;
  }

  try {
    const esbuild = await import('esbuild');
    esbuildTransform = esbuild.transform;
    return esbuildTransform;
  } catch {
    // Fallback: try @swc/core
    try {
      const swc = await import('@swc/core');
      esbuildTransform = async (source: string, options: object) => {
        const opts = options as { loader?: string; minify?: boolean; sourcemap?: boolean | 'inline' };
        const result = await swc.transform(source, {
          jsc: {
            parser: {
              syntax: 'typescript',
              tsx: opts.loader === 'tsx' || opts.loader === 'jsx',
            },
            transform: {
              react: {
                runtime: 'automatic',
                development: false,
              },
            },
            target: 'es2020',
            minify: opts.minify ? { compress: true, mangle: true } : undefined,
          },
          module: {
            type: 'commonjs',
          },
          sourceMaps: opts.sourcemap ? true : false,
        });
        return { code: result.code, map: result.map };
      };
      return esbuildTransform;
    } catch {
      console.warn(
        '[@frontmcp/ui/bundler] Neither esbuild nor @swc/core available. ' +
          'Install esbuild for best performance: npm install esbuild',
      );
      return null;
    }
  }
}

/**
 * In-memory bundler for JSX/TSX/MDX sources.
 *
 * Features:
 * - Fast transformation using esbuild (fallback to SWC)
 * - Content-addressable caching
 * - Security validation (blocked imports, eval, etc.)
 * - SSR support for React components
 *
 * @example
 * ```typescript
 * const bundler = new InMemoryBundler();
 *
 * // Bundle JSX source
 * const result = await bundler.bundle({
 *   source: 'const App = () => <div>Hello</div>; export default App;',
 *   sourceType: 'jsx',
 * });
 *
 * console.log(result.code); // Bundled JavaScript
 * console.log(result.cached); // Whether from cache
 *
 * // SSR rendering
 * const ssrResult = await bundler.bundleSSR({
 *   source: 'export default ({ data }) => <div>{data.message}</div>',
 *   sourceType: 'jsx',
 *   context: { data: { message: 'Hello' } },
 * });
 *
 * console.log(ssrResult.html); // Rendered HTML
 * ```
 */
export class InMemoryBundler {
  private readonly cache: BundlerCache;
  private readonly options: Required<BundlerOptions>;
  private readonly defaultSecurity: SecurityPolicy;

  constructor(options: BundlerOptions = {}) {
    this.options = {
      ...DEFAULT_BUNDLER_OPTIONS,
      ...options,
      cache: {
        ...DEFAULT_BUNDLER_OPTIONS.cache,
        ...options.cache,
      },
    };

    this.cache = new BundlerCache({
      maxSize: this.options.cache.maxSize,
      ttl: this.options.cache.ttl,
    });

    this.defaultSecurity = mergePolicy(options.defaultSecurity);
  }

  /**
   * Bundle source code.
   *
   * @param options - Bundle options
   * @returns Bundle result
   */
  async bundle(options: BundleOptions): Promise<BundleResult> {
    const startTime = performance.now();

    // Merge options with defaults
    const opts = this.mergeOptions(options);

    // Check cache first
    if (!opts.skipCache && !this.options.cache.disabled) {
      const cacheKey = options.cacheKey ?? createCacheKey(options.source, opts);
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return {
          ...cached,
          cached: true,
          metrics: {
            ...cached.metrics,
            cacheTime: performance.now() - startTime,
          },
        };
      }
    }

    // Validate security
    const security = mergePolicy(options.security ?? this.defaultSecurity);
    const violations = validateSource(options.source, security);
    throwOnViolations(violations);

    // Detect source type
    const sourceType = opts.sourceType === 'auto' ? this.detectSourceType(options.source) : opts.sourceType;

    // Transform
    const transformStart = performance.now();
    const transformed = await this.transform(options.source, sourceType, opts);
    const transformTime = performance.now() - transformStart;

    // Validate size
    const sizeViolation = validateSize(transformed.code.length, security);
    if (sizeViolation) {
      throwOnViolations([sizeViolation]);
    }

    // Build result
    const hash = hashContent(transformed.code);
    const result: BundleResult = {
      code: transformed.code,
      hash,
      cached: false,
      size: transformed.code.length,
      map: transformed.map,
      metrics: {
        transformTime,
        bundleTime: 0, // No separate bundle step for transform-only
        totalTime: performance.now() - startTime,
      },
      sourceType,
      format: opts.format,
    };

    // Cache result
    if (!this.options.cache.disabled) {
      const cacheKey = options.cacheKey ?? createCacheKey(options.source, opts);
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  /**
   * Bundle and execute for SSR.
   *
   * @param options - SSR bundle options
   * @returns SSR result with rendered HTML
   */
  async bundleSSR(options: SSRBundleOptions): Promise<SSRResult> {
    const startTime = performance.now();

    // First, bundle the source
    const bundleResult = await this.bundle({
      ...options,
      format: 'cjs', // CommonJS for execution
    });

    // Load React for SSR
    let React;
    let ReactDOMServer;

    try {
      React = await import('react');
      ReactDOMServer = await import('react-dom/server');
    } catch {
      throw new Error('React and react-dom/server are required for SSR. Install them: npm install react react-dom');
    }

    // Execute the bundled code
    const renderStart = performance.now();
    const Component = await executeDefault<React.ComponentType<unknown>>(bundleResult.code, {
      React,
      security: mergePolicy(options.security ?? this.defaultSecurity),
    });

    // Render to HTML
    let html: string;
    try {
      const element = React.createElement(Component, options.context ?? {});
      html = ReactDOMServer.renderToString(element);
    } catch (error) {
      throw new ExecutionError(
        `SSR rendering failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    const renderTime = performance.now() - renderStart;

    // Build hydration script if requested
    let hydrationScript: string | undefined;
    if (options.includeHydration) {
      hydrationScript = this.buildHydrationScript(bundleResult.code, options.context);
    }

    return {
      ...bundleResult,
      html,
      hydrationScript,
      metrics: {
        ...bundleResult.metrics,
        totalTime: performance.now() - startTime,
      },
      ssrMetrics: {
        renderTime,
      },
    };
  }

  /**
   * Bundle and execute code, returning the exports.
   *
   * @param options - Bundle options
   * @param context - Execution context
   * @returns Exported value
   */
  async bundleAndExecute<T = unknown>(options: BundleOptions, context?: Record<string, unknown>): Promise<T> {
    // Bundle first
    const result = await this.bundle({
      ...options,
      format: 'cjs', // CommonJS for execution
    });

    // Load React if available
    let React;
    try {
      React = await import('react');
    } catch {
      // React not available, that's okay
    }

    // Execute
    return executeDefault<T>(result.code, {
      React,
      globals: context,
      security: mergePolicy(options.security ?? this.defaultSecurity),
    });
  }

  /**
   * Get cache statistics.
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clean up expired cache entries.
   */
  cleanupCache(): number {
    return this.cache.cleanup();
  }

  /**
   * Transform source code using esbuild/SWC.
   */
  private async transform(
    source: string,
    sourceType: SourceType,
    options: Required<Pick<BundleOptions, 'format' | 'minify' | 'sourceMaps' | 'target' | 'jsx'>>,
  ): Promise<{ code: string; map?: string }> {
    const transform = await loadEsbuild();

    if (!transform) {
      throw new Error('No bundler available. Install esbuild or @swc/core: npm install esbuild');
    }

    // Map source type to loader
    const loader = this.getLoader(sourceType);

    // Build esbuild options
    const esbuildOptions: Record<string, unknown> = {
      loader,
      minify: options.minify,
      sourcemap: options.sourceMaps,
      target: options.target,
      format: options.format === 'cjs' ? 'cjs' : options.format === 'esm' ? 'esm' : 'iife',
      jsx: 'automatic',
      jsxImportSource: options.jsx.importSource,
    };

    try {
      const result = await transform(source, esbuildOptions);
      return {
        code: result.code,
        map: result.map,
      };
    } catch (error) {
      throw new Error(`Transform failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get esbuild loader for source type.
   */
  private getLoader(sourceType: SourceType): string {
    switch (sourceType) {
      case 'jsx':
        return 'jsx';
      case 'tsx':
        return 'tsx';
      case 'mdx':
        return 'tsx'; // MDX compiles to JSX/TSX
      case 'html':
        return 'text';
      default:
        return 'tsx';
    }
  }

  /**
   * Detect source type from content.
   */
  private detectSourceType(source: string): SourceType {
    // Check for TypeScript types
    const hasTypeScript =
      /:\s*(string|number|boolean|any|unknown|void|never|object)\b/.test(source) ||
      /interface\s+\w+/.test(source) ||
      /type\s+\w+\s*=/.test(source) ||
      /<\w+>/.test(source); // Generic syntax

    // Check for JSX
    const hasJSX =
      /<[A-Z][a-zA-Z]*/.test(source) || // Component tags
      /<[a-z]+\s/.test(source) || // HTML tags with attributes
      /<[a-z]+>/.test(source) || // Self-closing HTML tags
      /<\/[a-z]+>/.test(source); // Closing tags

    // Check for MDX
    const hasMDX =
      /^#\s+/.test(source) || // Markdown heading
      /^-\s+/.test(source) || // Markdown list
      /\*\*\w+\*\*/.test(source) || // Bold
      /```\w*\n/.test(source); // Code block

    if (hasMDX && hasJSX) {
      return 'mdx';
    }
    if (hasTypeScript && hasJSX) {
      return 'tsx';
    }
    if (hasJSX) {
      return 'jsx';
    }
    if (hasTypeScript) {
      return 'tsx';
    }

    return 'jsx';
  }

  /**
   * Merge bundle options with defaults.
   */
  private mergeOptions(
    options: BundleOptions,
  ): Required<
    Pick<
      BundleOptions,
      'sourceType' | 'format' | 'minify' | 'sourceMaps' | 'externals' | 'jsx' | 'target' | 'globalName' | 'skipCache'
    >
  > {
    return {
      sourceType: options.sourceType ?? DEFAULT_BUNDLE_OPTIONS.sourceType,
      format: options.format ?? DEFAULT_BUNDLE_OPTIONS.format,
      minify: options.minify ?? DEFAULT_BUNDLE_OPTIONS.minify,
      sourceMaps: options.sourceMaps ?? DEFAULT_BUNDLE_OPTIONS.sourceMaps,
      externals: options.externals ?? DEFAULT_BUNDLE_OPTIONS.externals,
      jsx: {
        ...DEFAULT_BUNDLE_OPTIONS.jsx,
        ...options.jsx,
      },
      target: options.target ?? DEFAULT_BUNDLE_OPTIONS.target,
      globalName: options.globalName ?? DEFAULT_BUNDLE_OPTIONS.globalName,
      skipCache: options.skipCache ?? DEFAULT_BUNDLE_OPTIONS.skipCache,
    };
  }

  /**
   * Build hydration script for client-side React.
   */
  private buildHydrationScript(bundledCode: string, context?: Record<string, unknown>): string {
    const contextJson = context ? JSON.stringify(context) : '{}';

    return `
(function() {
  var context = ${contextJson};
  var exports = {};
  var module = { exports: exports };

  // Execute bundled code
  (function(exports, module) {
    ${bundledCode}
  })(exports, module);

  // Get component
  var Component = module.exports.default || module.exports;

  // Hydrate
  if (typeof ReactDOM !== 'undefined' && ReactDOM.hydrateRoot) {
    var container = document.getElementById('root') || document.body.firstElementChild;
    if (container) {
      ReactDOM.hydrateRoot(container, React.createElement(Component, context));
    }
  }
})();
    `.trim();
  }
}

/**
 * Create a bundler instance with default options.
 *
 * @param options - Bundler configuration
 * @returns New bundler instance
 */
export function createBundler(options?: BundlerOptions): InMemoryBundler {
  return new InMemoryBundler(options);
}

// Re-export errors for convenience
export { SecurityError } from './sandbox/policy';
export { ExecutionError } from './sandbox/executor';
