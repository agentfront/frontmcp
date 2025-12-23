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
  StaticHTMLOptions,
  StaticHTMLResult,
  StaticHTMLExternalConfig,
  TargetPlatform,
  EsbuildTransformOptions,
  ConcretePlatform,
  MultiPlatformBuildOptions,
  PlatformBuildResult,
  MultiPlatformBuildResult,
  MergedStaticHTMLOptions,
  BuildMode,
  DynamicModeOptions,
  HybridModeOptions,
} from './types';
import {
  DEFAULT_BUNDLE_OPTIONS,
  DEFAULT_BUNDLER_OPTIONS,
  DEFAULT_STATIC_HTML_OPTIONS,
  STATIC_HTML_CDN,
  getCdnTypeForPlatform,
  ALL_PLATFORMS,
  HYBRID_DATA_PLACEHOLDER,
  HYBRID_INPUT_PLACEHOLDER,
} from './types';
import { buildUIMeta, type AIPlatformType } from '@frontmcp/uipack/adapters';
import { DEFAULT_THEME, buildThemeCss, type ThemeConfig } from '@frontmcp/uipack/theme';
import { BundlerCache, createCacheKey, hashContent } from './cache';
import { validateSource, validateSize, mergePolicy, throwOnViolations } from './sandbox/policy';
import { executeDefault, ExecutionError } from './sandbox/executor';
import { escapeHtml } from '@frontmcp/uipack/utils';
import type { ContentType } from '../universal/types';
import { detectContentType as detectUniversalContentType } from '../universal/types';
import {
  getCachedRuntime,
  buildAppScript,
  buildDataInjectionCode,
  buildComponentCode,
} from '../universal/cached-runtime';
import { buildCDNScriptTag, CLOUDFLARE_CDN } from '@frontmcp/uipack/build';

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
 * Validate and sanitize rootId for safe use in HTML/JS contexts.
 * Only allows alphanumeric, underscore, and hyphen characters.
 */
function sanitizeRootId(rootId: string): string {
  const safeId = rootId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (safeId !== rootId) {
    console.warn('[FrontMCP] rootId sanitized:', { original: rootId, sanitized: safeId });
  }
  return safeId || 'frontmcp-root';
}

/**
 * Sanitize CSS to prevent style tag breakout attacks.
 */
function sanitizeCss(css: string): string {
  // Escape closing style tags to prevent injection
  return css.replace(/<\/style>/gi, '\\3c/style\\3e');
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
   * Bundle a component to a self-contained static HTML document.
   *
   * Creates a complete HTML page with:
   * - React runtime (CDN or inline based on platform)
   * - FrontMCP UI hooks and components (always inline)
   * - Tool data injection (input/output)
   * - Transpiled component code
   * - Client-side rendering via createRoot
   *
   * @param options - Static HTML options
   * @returns Static HTML result with complete document
   *
   * @example
   * ```typescript
   * const result = await bundler.bundleToStaticHTML({
   *   source: `
   *     import { Card, useToolOutput } from '@frontmcp/ui/react';
   *     export default function Weather() {
   *       const output = useToolOutput();
   *       return <Card title="Weather">{output?.temperature}°F</Card>;
   *     }
   *   `,
   *   toolName: 'get_weather',
   *   output: { temperature: 72 },
   * });
   *
   * // result.html contains the complete HTML document
   * ```
   */
  async bundleToStaticHTML(options: StaticHTMLOptions): Promise<StaticHTMLResult> {
    const startTime = performance.now();

    // Merge options with defaults
    const opts = this.mergeStaticHTMLOptions(options);
    const platform = opts.targetPlatform === 'auto' ? 'generic' : opts.targetPlatform;
    const cdnType = getCdnTypeForPlatform(platform);

    // Handle universal mode vs standard component mode
    if (opts.universal) {
      return this.bundleToStaticHTMLUniversal(options, opts, platform, cdnType, startTime);
    }

    // Standard mode: Transpile the component to CommonJS format
    // We use CJS because esbuild.transform doesn't support globalName (that's only for build)
    // The component script wrapper will capture module.exports and assign to window.__frontmcp_component
    const bundleResult = await this.bundle({
      source: options.source,
      sourceType: opts.sourceType,
      format: 'cjs',
      minify: opts.minify,
      sourceMaps: false,
      externals: ['react', 'react-dom', 'react/jsx-runtime', '@frontmcp/ui', '@frontmcp/ui/react'],
      security: opts.security,
      skipCache: opts.skipCache,
    });

    // Build HTML sections
    const head = this.buildStaticHTMLHead({ externals: opts.externals, customCss: opts.customCss, theme: opts.theme });
    const reactRuntime = this.buildReactRuntimeScripts(opts.externals, platform, cdnType);
    const frontmcpRuntime = this.buildFrontMCPRuntime();
    const dataScript = this.buildDataInjectionScript(
      opts.toolName,
      opts.input,
      opts.output,
      opts.structuredContent,
      opts.buildMode,
      cdnType,
      opts.dynamicOptions,
      opts.hybridOptions,
    );
    const componentScript = this.buildComponentRenderScript(bundleResult.code, opts.rootId, cdnType);

    // Assemble complete HTML document
    const html = this.assembleStaticHTML({
      title: opts.title || `${opts.toolName} - Widget`,
      head,
      reactRuntime,
      frontmcpRuntime,
      dataScript,
      componentScript,
      rootId: opts.rootId,
      cdnType,
    });

    const hash = hashContent(html);

    // Determine data placeholders for hybrid mode
    const dataPlaceholder =
      opts.buildMode === 'hybrid' ? opts.hybridOptions?.placeholder ?? HYBRID_DATA_PLACEHOLDER : undefined;
    const inputPlaceholder =
      opts.buildMode === 'hybrid' ? opts.hybridOptions?.inputPlaceholder ?? HYBRID_INPUT_PLACEHOLDER : undefined;

    return {
      html,
      componentCode: bundleResult.code,
      metrics: {
        ...bundleResult.metrics,
        totalTime: performance.now() - startTime,
      },
      hash,
      size: html.length,
      cached: bundleResult.cached,
      sourceType: bundleResult.sourceType,
      targetPlatform: platform,
      buildMode: opts.buildMode,
      dataPlaceholder,
      inputPlaceholder,
    };
  }

  /**
   * Bundle a component to static HTML for all target platforms at once.
   *
   * This method is optimized for efficiency:
   * - Transpiles the component source code only once
   * - Generates platform-specific HTML variations from the shared transpiled code
   * - Returns complete platform metadata ready for MCP responses
   *
   * @param options - Multi-platform build options
   * @returns Multi-platform build result with all platforms
   *
   * @example
   * ```typescript
   * const result = await bundler.bundleToStaticHTMLAll({
   *   source: `
   *     import { Card, useToolOutput } from '@frontmcp/ui/react';
   *     export default function Weather() {
   *       const output = useToolOutput();
   *       return <Card title="Weather">{output?.temperature}°F</Card>;
   *     }
   *   `,
   *   toolName: 'get_weather',
   *   output: { temperature: 72 },
   * });
   *
   * // Access platform-specific results
   * const openaiHtml = result.platforms.openai.html;
   * const claudeHtml = result.platforms.claude.html;
   *
   * // Get metadata for MCP response
   * const openaiMeta = result.platforms.openai.meta;
   * ```
   */
  async bundleToStaticHTMLAll(options: MultiPlatformBuildOptions): Promise<MultiPlatformBuildResult> {
    const startTime = performance.now();

    // Merge options with defaults
    const opts = this.mergeStaticHTMLOptions(options as StaticHTMLOptions);
    const platforms = options.platforms ?? [...ALL_PLATFORMS];

    // Step 1: Transpile component ONCE (shared across all platforms)
    const transpileStart = performance.now();
    let transpiledCode: string | null = null;
    let bundleResult: BundleResult | null = null;

    // Handle universal mode vs standard component mode
    const isUniversal = opts.universal;
    const rawContentType = options.contentType ?? 'auto';
    const contentType: ContentType = isUniversal
      ? rawContentType === 'auto'
        ? detectUniversalContentType(options.source)
        : rawContentType
      : 'react';

    // Only transpile if it's a React component
    if (contentType === 'react' || !isUniversal) {
      bundleResult = await this.bundle({
        source: options.source,
        sourceType: opts.sourceType,
        format: 'cjs',
        minify: opts.minify,
        sourceMaps: false,
        externals: ['react', 'react-dom', 'react/jsx-runtime', '@frontmcp/ui', '@frontmcp/ui/react'],
        security: opts.security,
        skipCache: opts.skipCache,
      });
      transpiledCode = bundleResult.code;
    }

    const transpileTime = performance.now() - transpileStart;

    // Step 2: Generate platform-specific HTML for each target
    const generationStart = performance.now();
    const platformResults: Partial<Record<ConcretePlatform, PlatformBuildResult>> = {};

    for (const platform of platforms) {
      const platformResult = await this.buildForPlatform({
        options,
        opts,
        platform,
        transpiledCode,
        bundleResult,
        contentType,
        isUniversal,
      });
      platformResults[platform] = platformResult;
    }

    const generationTime = performance.now() - generationStart;

    return {
      platforms: platformResults as Record<ConcretePlatform, PlatformBuildResult>,
      sharedComponentCode: transpiledCode ?? '',
      metrics: {
        transpileTime,
        generationTime,
        totalTime: performance.now() - startTime,
      },
      cached: bundleResult?.cached ?? false,
    };
  }

  /**
   * Build for a specific platform with pre-transpiled code.
   * Internal helper for bundleToStaticHTMLAll.
   */
  private async buildForPlatform(params: {
    options: MultiPlatformBuildOptions;
    opts: MergedStaticHTMLOptions;
    platform: ConcretePlatform;
    transpiledCode: string | null;
    bundleResult: BundleResult | null;
    contentType: ContentType;
    isUniversal: boolean;
  }): Promise<PlatformBuildResult> {
    const { options, opts, platform, transpiledCode, bundleResult, contentType, isUniversal } = params;

    const cdnType = getCdnTypeForPlatform(platform);
    const buildStart = performance.now();

    let html: string;
    let componentCode: string;

    if (isUniversal) {
      // Universal mode: use cached runtime
      const cachedRuntime = getCachedRuntime({
        cdnType,
        includeMarkdown: opts.includeMarkdown || contentType === 'markdown',
        includeMdx: opts.includeMdx || contentType === 'mdx',
        minify: opts.minify,
      });

      const componentCodeStr = transpiledCode ? buildComponentCode(transpiledCode) : '';
      const dataInjectionStr = buildDataInjectionCode(
        opts.toolName,
        opts.input,
        opts.output,
        opts.structuredContent,
        contentType,
        transpiledCode ? null : options.source,
        transpiledCode !== null,
        {
          buildMode: opts.buildMode,
          cdnType,
          dynamicOptions: opts.dynamicOptions,
          hybridOptions: opts.hybridOptions,
        },
      );
      const appScript = buildAppScript(
        cachedRuntime.appTemplate,
        componentCodeStr,
        dataInjectionStr,
        opts.customComponents ?? '',
      );

      const head = this.buildStaticHTMLHead({
        externals: opts.externals,
        customCss: opts.customCss,
        theme: opts.theme,
      });
      const reactRuntime = this.buildReactRuntimeScripts(opts.externals, platform, cdnType);
      const renderScript = this.buildUniversalRenderScript(opts.rootId, cdnType);

      html = this.assembleUniversalStaticHTMLCached({
        title: opts.title || `${opts.toolName} - Widget`,
        head,
        reactRuntime,
        cdnImports: cachedRuntime.cdnImports,
        vendorScript: cachedRuntime.vendorScript,
        appScript,
        renderScript,
        rootId: opts.rootId,
        cdnType,
      });

      componentCode = transpiledCode ?? appScript;
    } else {
      // Standard mode - requires transpiled code
      if (!transpiledCode) {
        throw new Error('Failed to transpile component source');
      }
      const head = this.buildStaticHTMLHead({
        externals: opts.externals,
        customCss: opts.customCss,
        theme: opts.theme,
      });
      const reactRuntime = this.buildReactRuntimeScripts(opts.externals, platform, cdnType);
      const frontmcpRuntime = this.buildFrontMCPRuntime();
      const dataScript = this.buildDataInjectionScript(
        opts.toolName,
        opts.input,
        opts.output,
        opts.structuredContent,
        opts.buildMode,
        cdnType,
        opts.dynamicOptions,
        opts.hybridOptions,
      );
      const componentScript = this.buildComponentRenderScript(transpiledCode, opts.rootId, cdnType);

      html = this.assembleStaticHTML({
        title: opts.title || `${opts.toolName} - Widget`,
        head,
        reactRuntime,
        frontmcpRuntime,
        dataScript,
        componentScript,
        rootId: opts.rootId,
        cdnType,
      });

      componentCode = transpiledCode;
    }

    const hash = hashContent(html);

    // Build platform-specific metadata
    const meta = buildUIMeta({
      uiConfig: {
        template: () => html,
        widgetAccessible: opts.widgetAccessible,
      },
      platformType: this.mapTargetPlatformToAIPlatform(platform),
      html,
    });

    // Determine data placeholders for hybrid mode
    const dataPlaceholder =
      opts.buildMode === 'hybrid' ? opts.hybridOptions?.placeholder ?? HYBRID_DATA_PLACEHOLDER : undefined;
    const inputPlaceholder =
      opts.buildMode === 'hybrid' ? opts.hybridOptions?.inputPlaceholder ?? HYBRID_INPUT_PLACEHOLDER : undefined;

    return {
      html,
      componentCode,
      metrics: bundleResult?.metrics ?? {
        transformTime: 0,
        bundleTime: 0,
        totalTime: performance.now() - buildStart,
      },
      hash,
      size: html.length,
      cached: bundleResult?.cached ?? false,
      sourceType: bundleResult?.sourceType ?? opts.sourceType,
      targetPlatform: platform,
      universal: isUniversal,
      contentType: isUniversal ? contentType : undefined,
      buildMode: opts.buildMode,
      dataPlaceholder,
      inputPlaceholder,
      meta,
    };
  }

  /**
   * Map TargetPlatform to AIPlatformType for metadata generation.
   */
  private mapTargetPlatformToAIPlatform(platform: ConcretePlatform): AIPlatformType {
    switch (platform) {
      case 'openai':
        return 'openai';
      case 'claude':
        return 'claude';
      case 'cursor':
        return 'cursor';
      case 'ext-apps':
        return 'ext-apps';
      case 'generic':
        return 'generic-mcp';
      default:
        return 'generic-mcp';
    }
  }

  /**
   * Bundle to static HTML with universal rendering mode.
   * Uses the universal renderer that can handle multiple content types.
   *
   * Optimization: Uses cached runtime (vendor chunk) to avoid rebuilding
   * static code on every request. Only the user's component is transpiled.
   */
  private async bundleToStaticHTMLUniversal(
    options: StaticHTMLOptions,
    opts: MergedStaticHTMLOptions,
    platform: TargetPlatform,
    cdnType: 'esm' | 'umd',
    startTime: number,
  ): Promise<StaticHTMLResult> {
    // Detect content type - use auto-detection if not explicitly set or set to 'auto'
    let contentType: ContentType;
    const rawContentType = options.contentType ?? 'auto';
    if (rawContentType === 'auto') {
      contentType = detectUniversalContentType(options.source);
    } else {
      contentType = rawContentType;
    }

    // For React content (full modules with import/export), we need to transpile the source code
    // For MDX content (markdown with JSX tags), we DON'T transpile - the MDX renderer handles it
    let transpiledCode: string | null = null;
    let transformTime = 0;
    if (contentType === 'react') {
      const bundleResult = await this.bundle({
        source: options.source,
        sourceType: opts.sourceType,
        format: 'cjs',
        minify: opts.minify,
        sourceMaps: false,
        externals: ['react', 'react-dom', 'react/jsx-runtime', '@frontmcp/ui', '@frontmcp/ui/react'],
        security: opts.security,
        skipCache: opts.skipCache,
      });
      transpiledCode = bundleResult.code;
      transformTime = bundleResult.metrics.transformTime;
    }
    // Note: MDX content is passed as-is to the MDX renderer which handles the markdown + JSX
    // Custom components for MDX can be provided via opts.customComponents

    // Get cached runtime (vendor chunk) - this is pre-built and cached globally
    const cachedRuntime = getCachedRuntime({
      cdnType,
      includeMarkdown: opts.includeMarkdown || contentType === 'markdown',
      includeMdx: opts.includeMdx || contentType === 'mdx',
      minify: opts.minify,
    });

    // Build app chunk (user-specific code)
    const componentCodeStr = transpiledCode ? buildComponentCode(transpiledCode) : '';
    const dataInjectionStr = buildDataInjectionCode(
      opts.toolName,
      opts.input,
      opts.output,
      opts.structuredContent,
      contentType,
      transpiledCode ? null : options.source, // Pass source only if not a component
      transpiledCode !== null,
      {
        buildMode: opts.buildMode,
        cdnType,
        dynamicOptions: opts.dynamicOptions,
        hybridOptions: opts.hybridOptions,
      },
    );
    const appScript = buildAppScript(
      cachedRuntime.appTemplate,
      componentCodeStr,
      dataInjectionStr,
      opts.customComponents ?? '',
    );

    // Build HTML sections
    const head = this.buildStaticHTMLHead({ externals: opts.externals, customCss: opts.customCss, theme: opts.theme });
    const reactRuntime = this.buildReactRuntimeScripts(opts.externals, platform, cdnType);
    const renderScript = this.buildUniversalRenderScript(opts.rootId, cdnType);

    // Assemble complete HTML document with vendor + app chunks
    const html = this.assembleUniversalStaticHTMLCached({
      title: opts.title || `${opts.toolName} - Widget`,
      head,
      reactRuntime,
      cdnImports: cachedRuntime.cdnImports,
      vendorScript: cachedRuntime.vendorScript,
      appScript,
      renderScript,
      rootId: opts.rootId,
      cdnType,
    });

    const hash = hashContent(html);

    return {
      html,
      componentCode: transpiledCode ?? appScript,
      metrics: {
        transformTime,
        bundleTime: 0,
        totalTime: performance.now() - startTime,
        cacheTime: cachedRuntime.cached ? 0 : undefined,
      },
      hash,
      size: html.length,
      cached: cachedRuntime.cached,
      sourceType: opts.sourceType === 'auto' ? this.detectSourceType(options.source) : opts.sourceType,
      targetPlatform: platform,
      universal: true,
      contentType,
    };
  }

  /**
   * Assemble the complete universal static HTML document using cached runtime.
   *
   * For ESM mode (OpenAI), scripts must wait for React to load asynchronously.
   * For UMD mode (Claude), scripts can execute synchronously.
   */
  private assembleUniversalStaticHTMLCached(parts: {
    title: string;
    head: string;
    reactRuntime: string;
    cdnImports: string;
    vendorScript: string;
    appScript: string;
    renderScript: string;
    rootId: string;
    cdnType: 'esm' | 'umd';
  }): string {
    if (parts.cdnType === 'umd') {
      // UMD mode (Claude): Scripts execute synchronously after React loads
      return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>${escapeHtml(parts.title)}</title>
    ${parts.head}
    ${parts.reactRuntime}
    ${parts.cdnImports}
    <!-- Vendor Runtime (Cached) -->
    <script>
${parts.vendorScript}
    </script>
    <!-- App Script (User Component) -->
    <script>
${parts.appScript}
    </script>
</head>
<body>
    <div id="${parts.rootId}" class="frontmcp-loading">
        <div class="frontmcp-spinner"></div>
    </div>
    ${parts.renderScript}
</body>
</html>`;
    } else {
      // ESM mode (OpenAI): React loads async, scripts must wait for it
      return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>${escapeHtml(parts.title)}</title>
    ${parts.head}
    ${parts.reactRuntime}
    ${parts.cdnImports}
</head>
<body>
    <div id="${parts.rootId}" class="frontmcp-loading">
        <div class="frontmcp-spinner"></div>
    </div>
    <!-- Scripts wait for React to load (ESM is async) -->
    <script type="module">
      // Wait for React to be ready
      function initFrontMCP() {
        // Vendor Runtime (Cached)
${parts.vendorScript}

        // App Script (User Component)
${parts.appScript}

        // Render the app
        var container = document.getElementById('${parts.rootId}');
        if (container && window.ReactDOM && window.ReactDOM.createRoot && window.__frontmcp.UniversalApp) {
          var root = window.ReactDOM.createRoot(container);
          root.render(React.createElement(window.__frontmcp.UniversalApp));
        }
      }

      if (window.__reactReady) {
        initFrontMCP();
      } else {
        window.addEventListener('react:ready', initFrontMCP);
      }
    </script>
</body>
</html>`;
    }
  }

  /**
   * Build the component script for transpiled React/MDX content.
   * Wraps CommonJS code with module/exports shim to capture the component.
   */
  private buildUniversalComponentScript(transpiledCode: string, cdnType: 'esm' | 'umd'): string {
    // CommonJS wrapper that captures exports and assigns to window.__frontmcp_component
    const wrappedCode = `
        // CommonJS module shim
        var module = { exports: {} };
        var exports = module.exports;

        // Execute transpiled component code (CommonJS format)
        ${transpiledCode}

        // Capture the component export
        window.__frontmcp_component = module.exports.default || module.exports;
    `;

    if (cdnType === 'umd') {
      return `
    <!-- Universal Component Script (transpiled) -->
    <script>
      (function() {
        ${wrappedCode}
      })();
    </script>`;
    } else {
      return `
    <!-- Universal Component Script (transpiled, ESM) -->
    <script type="module">
      function loadComponent() {
        ${wrappedCode}
      }

      if (window.__reactReady) {
        loadComponent();
      } else {
        window.addEventListener('react:ready', loadComponent);
      }
    </script>`;
    }
  }

  /**
   * Build the universal runtime script section.
   */
  private buildUniversalRuntimeScript(runtimeScript: string): string {
    return `
    <!-- Universal Runtime -->
    <script>
      ${runtimeScript}
    </script>`;
  }

  /**
   * Build data injection script for universal mode.
   */
  private buildUniversalDataScript(
    toolName: string,
    input: Record<string, unknown> | undefined,
    output: unknown,
    structuredContent: unknown,
    contentType: ContentType,
    source: string,
    hasTranspiledComponent = false,
  ): string {
    const safeJson = (value: unknown): string => {
      try {
        return JSON.stringify(value);
      } catch {
        return 'null';
      }
    };

    // For transpiled React/MDX components, reference the component function
    // For HTML/Markdown, use the source string
    if (hasTranspiledComponent) {
      return `
    <!-- Universal Data Injection (React Component) -->
    <script>
      window.__frontmcp.setState({
        toolName: ${safeJson(toolName)},
        input: ${safeJson(input ?? null)},
        output: ${safeJson(output ?? null)},
        structuredContent: ${safeJson(structuredContent ?? null)},
        content: {
          type: 'react',
          source: window.__frontmcp_component
        },
        loading: false,
        error: null
      });
    </script>`;
    }

    // Escape the source for embedding in JS (for HTML/Markdown content)
    const escapedSource = JSON.stringify(source);

    return `
    <!-- Universal Data Injection -->
    <script>
      window.__frontmcp.setState({
        toolName: ${safeJson(toolName)},
        input: ${safeJson(input ?? null)},
        output: ${safeJson(output ?? null)},
        structuredContent: ${safeJson(structuredContent ?? null)},
        content: {
          type: ${safeJson(contentType)},
          source: ${escapedSource}
        },
        loading: false,
        error: null
      });
    </script>`;
  }

  /**
   * Build the universal render script.
   */
  private buildUniversalRenderScript(rootId: string, cdnType: 'esm' | 'umd'): string {
    if (cdnType === 'umd') {
      return `
    <!-- Universal Render Script (UMD - synchronous) -->
    <script>
      (function() {
        var container = document.getElementById('${rootId}');
        if (container && window.ReactDOM && window.ReactDOM.createRoot && window.__frontmcp.UniversalApp) {
          var root = window.ReactDOM.createRoot(container);
          root.render(React.createElement(window.__frontmcp.UniversalApp));
        } else if (container && window.ReactDOM && window.ReactDOM.render && window.__frontmcp.UniversalApp) {
          window.ReactDOM.render(
            React.createElement(window.__frontmcp.UniversalApp),
            container
          );
        }
      })();
    </script>`;
    } else {
      return `
    <!-- Universal Render Script (ESM - waits for React) -->
    <script type="module">
      function renderUniversalApp() {
        var container = document.getElementById('${rootId}');
        if (container && window.ReactDOM && window.ReactDOM.createRoot && window.__frontmcp.UniversalApp) {
          var root = window.ReactDOM.createRoot(container);
          root.render(React.createElement(window.__frontmcp.UniversalApp));
        }
      }

      if (window.__reactReady) {
        renderUniversalApp();
      } else {
        window.addEventListener('react:ready', renderUniversalApp);
      }
    </script>`;
    }
  }

  /**
   * Assemble the complete universal static HTML document.
   */
  private assembleUniversalStaticHTML(parts: {
    title: string;
    head: string;
    reactRuntime: string;
    frontmcpRuntime?: string;
    cdnImports: string;
    universalRuntimeScript: string;
    componentScript?: string;
    dataScript: string;
    renderScript: string;
    rootId: string;
    cdnType: 'esm' | 'umd';
  }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>${escapeHtml(parts.title)}</title>
    ${parts.head}
    ${parts.reactRuntime}
    ${parts.frontmcpRuntime ?? ''}
    ${parts.cdnImports}
    ${parts.universalRuntimeScript}
    ${parts.componentScript ?? ''}
    ${parts.dataScript}
</head>
<body>
    <div id="${parts.rootId}" class="frontmcp-loading">
        <div class="frontmcp-spinner"></div>
    </div>
    ${parts.renderScript}
</body>
</html>`;
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
    const esbuildOptions: EsbuildTransformOptions = {
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
  private getLoader(sourceType: SourceType): EsbuildTransformOptions['loader'] {
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

  // ============================================
  // Static HTML Helper Methods
  // ============================================

  /**
   * Merge static HTML options with defaults.
   */
  private mergeStaticHTMLOptions(options: StaticHTMLOptions): MergedStaticHTMLOptions {
    return {
      sourceType: options.sourceType ?? DEFAULT_STATIC_HTML_OPTIONS.sourceType,
      targetPlatform: options.targetPlatform ?? DEFAULT_STATIC_HTML_OPTIONS.targetPlatform,
      minify: options.minify ?? DEFAULT_STATIC_HTML_OPTIONS.minify,
      skipCache: options.skipCache ?? DEFAULT_STATIC_HTML_OPTIONS.skipCache,
      rootId: sanitizeRootId(options.rootId ?? DEFAULT_STATIC_HTML_OPTIONS.rootId),
      widgetAccessible: options.widgetAccessible ?? DEFAULT_STATIC_HTML_OPTIONS.widgetAccessible,
      externals: {
        ...DEFAULT_STATIC_HTML_OPTIONS.externals,
        ...options.externals,
      },
      // Universal mode options
      universal: options.universal ?? DEFAULT_STATIC_HTML_OPTIONS.universal,
      contentType: options.contentType ?? DEFAULT_STATIC_HTML_OPTIONS.contentType,
      includeMarkdown: options.includeMarkdown ?? DEFAULT_STATIC_HTML_OPTIONS.includeMarkdown,
      includeMdx: options.includeMdx ?? DEFAULT_STATIC_HTML_OPTIONS.includeMdx,
      // Build mode options
      buildMode: options.buildMode ?? DEFAULT_STATIC_HTML_OPTIONS.buildMode,
      dynamicOptions: options.dynamicOptions,
      hybridOptions: options.hybridOptions,
      // Pass-through options
      toolName: options.toolName,
      input: options.input,
      output: options.output,
      structuredContent: options.structuredContent,
      title: options.title,
      security: options.security,
      customCss: options.customCss,
      customComponents: options.customComponents,
      theme: options.theme,
    };
  }

  /**
   * Build the <head> section for static HTML.
   */
  private buildStaticHTMLHead(opts: {
    externals: StaticHTMLExternalConfig;
    customCss?: string;
    theme?: ThemeConfig;
  }): string {
    const parts: string[] = [];

    // Meta tags
    parts.push(`<meta charset="UTF-8">`);
    parts.push(`<meta name="viewport" content="width=device-width, initial-scale=1.0">`);

    // Font preconnect
    for (const url of STATIC_HTML_CDN.fonts.preconnect) {
      parts.push(`<link rel="preconnect" href="${url}" crossorigin>`);
    }

    // Font stylesheet
    parts.push(`<link rel="stylesheet" href="${STATIC_HTML_CDN.fonts.inter}">`);

    parts.push(buildCDNScriptTag(CLOUDFLARE_CDN.tailwindCss));
    // // Tailwind CSS (same for all platforms - CSS file from cdnjs)
    // const tailwindConfig = opts.externals.tailwind ?? 'cdn';
    // if (tailwindConfig === 'cdn') {
    // } else if (tailwindConfig !== 'inline' && tailwindConfig) {
    //   // Custom URL
    //   parts.push(`<link rel="stylesheet" href="${tailwindConfig}">`);
    // }

    // Theme CSS variables (injected as :root variables after Tailwind)
    parts.push(this.buildThemeStyleBlock(opts.theme));

    // Base styles for loading state and common utilities
    parts.push(`<style>
      body { margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      .frontmcp-loading { display: flex; align-items: center; justify-content: center; min-height: 200px; }
      .frontmcp-spinner { width: 24px; height: 24px; border: 2px solid #e5e7eb; border-top-color: #3b82f6; border-radius: 50%; animation: spin 1s linear infinite; }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>`);

    // Custom CSS (injected after Tailwind and theme)
    if (opts.customCss) {
      parts.push(`<style>\n${sanitizeCss(opts.customCss)}\n    </style>`);
    }

    return parts.join('\n    ');
  }

  /**
   * Build theme CSS variables as a :root style block.
   * Uses DEFAULT_THEME if no theme is provided.
   */
  private buildThemeStyleBlock(theme: ThemeConfig = DEFAULT_THEME): string {
    const cssVars = buildThemeCss(theme);
    return `<style>
      :root {
        ${cssVars}
      }
    </style>`;
  }

  /**
   * Build React runtime scripts for static HTML.
   */
  private buildReactRuntimeScripts(
    externals: StaticHTMLExternalConfig,
    platform: TargetPlatform,
    cdnType: 'esm' | 'umd',
  ): string {
    const reactConfig = externals.react ?? 'cdn';
    const reactDomConfig = externals.reactDom ?? 'cdn';

    if (cdnType === 'umd') {
      // Claude: Use UMD builds from cdnjs (synchronous loading)
      const reactUrl = reactConfig === 'cdn' ? STATIC_HTML_CDN.umd.react : reactConfig;
      const reactDomUrl = reactDomConfig === 'cdn' ? STATIC_HTML_CDN.umd.reactDom : reactDomConfig;

      return `
    <!-- React Runtime (UMD from cdnjs - Claude compatible) -->
    <script src="${reactUrl}"></script>
    <script src="${reactDomUrl}"></script>
    <script>
      // Webpack/esbuild polyfills for transpiled code (UMD globals)
      window.external_react_namespaceObject = window.React;
      window.jsx_runtime_namespaceObject = {
        jsx: function(type, props, key) {
          if (key !== undefined) props = Object.assign({}, props, { key: key });
          return React.createElement(type, props);
        },
        jsxs: function(type, props, key) {
          if (key !== undefined) props = Object.assign({}, props, { key: key });
          return React.createElement(type, props);
        },
        Fragment: React.Fragment
      };
      window.__reactReady = true;
    </script>`;
    } else {
      // OpenAI/Cursor/generic: Use ES modules from esm.sh
      const reactUrl = reactConfig === 'cdn' ? STATIC_HTML_CDN.esm.react : reactConfig;
      const reactDomUrl = reactDomConfig === 'cdn' ? STATIC_HTML_CDN.esm.reactDom : reactDomConfig;

      return `
    <!-- React Runtime (ES modules from esm.sh) -->
    <script type="module">
      import React from '${reactUrl}';
      import { createRoot } from '${reactDomUrl}';

      // Make React available globally
      window.React = React;
      window.ReactDOM = { createRoot };

      // Webpack/esbuild polyfills for transpiled code
      window.external_react_namespaceObject = React;
      window.jsx_runtime_namespaceObject = {
        jsx: function(type, props, key) {
          if (key !== undefined) props = Object.assign({}, props, { key: key });
          return React.createElement(type, props);
        },
        jsxs: function(type, props, key) {
          if (key !== undefined) props = Object.assign({}, props, { key: key });
          return React.createElement(type, props);
        },
        Fragment: React.Fragment
      };

      // Signal React is ready
      window.__reactReady = true;
      window.dispatchEvent(new CustomEvent('react:ready'));
    </script>`;
    }
  }

  /**
   * Build FrontMCP runtime (hooks and UI components).
   * Always inlined for reliability across platforms.
   */
  private buildFrontMCPRuntime(): string {
    return `
    <!-- FrontMCP Runtime (always inline) -->
    <script>
      // Custom require() shim for browser - maps module names to globals
      // This allows esbuild-transpiled code to work in browsers
      window.__moduleCache = {};
      window.require = function(moduleName) {
        // Check cache first
        if (window.__moduleCache[moduleName]) {
          return window.__moduleCache[moduleName];
        }

        // Map module names to browser globals
        var moduleMap = {
          'react': function() { return window.React; },
          'react-dom': function() { return window.ReactDOM; },
          'react-dom/client': function() { return window.ReactDOM; },
          'react/jsx-runtime': function() { return window.jsx_runtime_namespaceObject; },
          'react/jsx-dev-runtime': function() { return window.jsx_runtime_namespaceObject; },
          '@frontmcp/ui': function() { return window.react_namespaceObject; },
          '@frontmcp/ui/react': function() { return window.react_namespaceObject; },
        };

        var resolver = moduleMap[moduleName];
        if (resolver) {
          var mod = resolver();
          window.__moduleCache[moduleName] = mod;
          return mod;
        }

        console.warn('[FrontMCP] Unknown module requested:', moduleName);
        return {};
      };

      // Async require for dynamic imports (returns Promise)
      window.requireAsync = function(moduleName) {
        return new Promise(function(resolve, reject) {
          // If module is already loaded, resolve immediately
          var mod = window.require(moduleName);
          if (mod && Object.keys(mod).length > 0) {
            resolve(mod);
            return;
          }

          // For now, we don't support dynamic CDN loading
          // All required modules should be pre-loaded
          console.warn('[FrontMCP] Async module not available:', moduleName);
          resolve({});
        });
      };

      // FrontMCP Hook implementations
      window.__frontmcp = {
        // Context for MCP bridge
        context: {
          toolName: null,
          toolInput: null,
          toolOutput: null,
          structuredContent: null,
          callTool: null,
        },

        // Set context from data injection
        setContext: function(ctx) {
          Object.assign(this.context, ctx);
        },
      };

      // Hook: useToolOutput - returns the tool output data
      window.useToolOutput = function() {
        return window.__frontmcp.context.toolOutput;
      };

      // Hook: useToolInput - returns the tool input arguments
      window.useToolInput = function() {
        return window.__frontmcp.context.toolInput;
      };

      // Hook: useMcpBridgeContext - returns full bridge context
      window.useMcpBridgeContext = function() {
        return window.__frontmcp.context;
      };

      // Hook: useCallTool - returns function to call other tools
      window.useCallTool = function() {
        return function(name, args) {
          if (window.__frontmcp.context.callTool) {
            return window.__frontmcp.context.callTool(name, args);
          }
          console.warn('[FrontMCP] callTool not available - widget may not have tool access');
          return Promise.resolve(null);
        };
      };

      // UI Components (simplified inline versions)
      window.Card = function(props) {
        var children = props.children;
        var title = props.title;
        var className = props.className || '';
        return React.createElement('div', {
          className: 'bg-white rounded-lg shadow border border-gray-200 overflow-hidden ' + className
        }, [
          title && React.createElement('div', {
            key: 'header',
            className: 'px-4 py-3 border-b border-gray-200 bg-gray-50'
          }, React.createElement('h3', { className: 'text-sm font-medium text-gray-900' }, title)),
          React.createElement('div', { key: 'body', className: 'p-4' }, children)
        ]);
      };

      window.Badge = function(props) {
        var children = props.children;
        var variant = props.variant || 'default';
        var variantClasses = {
          default: 'bg-gray-100 text-gray-800',
          success: 'bg-green-100 text-green-800',
          warning: 'bg-yellow-100 text-yellow-800',
          error: 'bg-red-100 text-red-800',
          info: 'bg-blue-100 text-blue-800',
        };
        return React.createElement('span', {
          className: 'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' + (variantClasses[variant] || variantClasses.default)
        }, children);
      };

      window.Button = function(props) {
        var children = props.children;
        var variant = props.variant || 'primary';
        var onClick = props.onClick;
        var disabled = props.disabled;
        var variantClasses = {
          primary: 'bg-blue-600 text-white hover:bg-blue-700',
          secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
          outline: 'border border-gray-300 text-gray-700 hover:bg-gray-50',
          danger: 'bg-red-600 text-white hover:bg-red-700',
        };
        return React.createElement('button', {
          className: 'px-4 py-2 rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ' +
            (disabled ? 'opacity-50 cursor-not-allowed ' : '') +
            (variantClasses[variant] || variantClasses.primary),
          onClick: onClick,
          disabled: disabled,
        }, children);
      };

      // Make hooks available on react_namespaceObject for bundled imports
      window.react_namespaceObject = Object.assign({}, window.React || {}, {
        useToolOutput: window.useToolOutput,
        useToolInput: window.useToolInput,
        useMcpBridgeContext: window.useMcpBridgeContext,
        useCallTool: window.useCallTool,
        Card: window.Card,
        Badge: window.Badge,
        Button: window.Button,
      });
    </script>`;
  }

  /**
   * Build data injection script for tool input/output.
   * Dispatches to mode-specific builders based on buildMode.
   */
  private buildDataInjectionScript(
    toolName: string,
    input?: Record<string, unknown>,
    output?: unknown,
    structuredContent?: unknown,
    buildMode: BuildMode = 'static',
    cdnType: 'esm' | 'umd' = 'esm',
    dynamicOptions?: DynamicModeOptions,
    hybridOptions?: HybridModeOptions,
  ): string {
    switch (buildMode) {
      case 'dynamic':
        return this.buildDynamicDataScript(toolName, input, output, structuredContent, cdnType, dynamicOptions);
      case 'hybrid':
        return this.buildHybridDataScript(toolName, input, structuredContent, hybridOptions);
      case 'static':
      default:
        return this.buildStaticDataScript(toolName, input, output, structuredContent);
    }
  }

  /**
   * Build static data injection - data baked in at build time (current default).
   */
  private buildStaticDataScript(
    toolName: string,
    input?: Record<string, unknown>,
    output?: unknown,
    structuredContent?: unknown,
  ): string {
    const safeJson = (value: unknown): string => {
      try {
        return JSON.stringify(value);
      } catch {
        return 'null';
      }
    };

    return `
    <!-- Tool Data Injection (Static Mode) -->
    <script>
      window.__mcpToolName = ${safeJson(toolName)};
      window.__mcpToolInput = ${safeJson(input ?? null)};
      window.__mcpToolOutput = ${safeJson(output ?? null)};
      window.__mcpStructuredContent = ${safeJson(structuredContent ?? null)};

      // Initialize FrontMCP context
      window.__frontmcp.setContext({
        toolName: window.__mcpToolName,
        toolInput: window.__mcpToolInput,
        toolOutput: window.__mcpToolOutput,
        structuredContent: window.__mcpStructuredContent,
      });
    </script>`;
  }

  /**
   * Build dynamic data injection - platform-aware.
   * For OpenAI (ESM): subscribes to platform events for updates.
   * For non-OpenAI (UMD/Claude): uses placeholders for data injection.
   */
  private buildDynamicDataScript(
    toolName: string,
    input?: Record<string, unknown>,
    output?: unknown,
    structuredContent?: unknown,
    cdnType: 'esm' | 'umd' = 'esm',
    options?: DynamicModeOptions,
  ): string {
    // For non-OpenAI platforms (UMD/Claude), use placeholders because they can't subscribe to OpenAI events
    if (cdnType === 'umd') {
      return this.buildDynamicWithPlaceholdersScript(toolName, structuredContent, options);
    }

    // For OpenAI (ESM), use subscription pattern
    return this.buildDynamicWithSubscriptionScript(toolName, input, output, structuredContent, options);
  }

  /**
   * Build dynamic data injection for non-OpenAI platforms using placeholders.
   * Similar to hybrid mode but with platform-appropriate loading/error states.
   */
  private buildDynamicWithPlaceholdersScript(
    toolName: string,
    structuredContent?: unknown,
    options?: DynamicModeOptions,
  ): string {
    const safeJson = (value: unknown): string => {
      try {
        return JSON.stringify(value);
      } catch {
        return 'null';
      }
    };

    const outputPlaceholder = HYBRID_DATA_PLACEHOLDER;
    const inputPlaceholder = HYBRID_INPUT_PLACEHOLDER;
    const includeInitialData = options?.includeInitialData !== false;

    return `
    <!-- Tool Data Injection (Dynamic Mode - Placeholder-based for non-OpenAI) -->
    <script>
      window.__mcpToolName = ${safeJson(toolName)};
      window.__mcpToolInput = "${inputPlaceholder}";
      window.__mcpToolOutput = "${outputPlaceholder}";
      window.__mcpStructuredContent = ${safeJson(structuredContent ?? null)};
      window.__mcpHybridError = null;

      (function() {
        var outputNotReplaced = false;
        var includeInitialData = ${includeInitialData};

        // Parse output placeholder
        var rawOutput = window.__mcpToolOutput;
        if (typeof rawOutput === 'string' && rawOutput !== "${outputPlaceholder}") {
          try {
            window.__mcpToolOutput = JSON.parse(rawOutput);
          } catch (e) {
            console.warn('[FrontMCP] Failed to parse injected output data:', e);
            window.__mcpToolOutput = null;
            window.__mcpHybridError = 'Failed to parse output data';
          }
        } else if (rawOutput === "${outputPlaceholder}") {
          window.__mcpToolOutput = null;
          outputNotReplaced = true;
        }

        // Parse input placeholder
        var rawInput = window.__mcpToolInput;
        if (typeof rawInput === 'string' && rawInput !== "${inputPlaceholder}") {
          try {
            window.__mcpToolInput = JSON.parse(rawInput);
          } catch (e) {
            console.warn('[FrontMCP] Failed to parse injected input data:', e);
            window.__mcpToolInput = null;
          }
        } else if (rawInput === "${inputPlaceholder}") {
          window.__mcpToolInput = null;
        }

        // Handle placeholder not replaced - show error if expecting initial data
        if (outputNotReplaced && includeInitialData) {
          window.__mcpHybridError = 'No data provided. The output placeholder was not replaced.';
        }
      })();

      // Initialize FrontMCP context with appropriate loading/error state
      if (window.__frontmcp && window.__frontmcp.setContext) {
        window.__frontmcp.setContext({
          toolName: window.__mcpToolName,
          toolInput: window.__mcpToolInput,
          toolOutput: window.__mcpToolOutput,
          structuredContent: window.__mcpStructuredContent,
          loading: ${!includeInitialData} && window.__mcpToolOutput === null && !window.__mcpHybridError,
          error: window.__mcpHybridError,
        });
      }
    </script>`;
  }

  /**
   * Build dynamic data injection for OpenAI using subscription pattern.
   */
  private buildDynamicWithSubscriptionScript(
    toolName: string,
    input?: Record<string, unknown>,
    output?: unknown,
    structuredContent?: unknown,
    options?: DynamicModeOptions,
  ): string {
    const safeJson = (value: unknown): string => {
      try {
        return JSON.stringify(value);
      } catch {
        return 'null';
      }
    };

    const includeInitial = options?.includeInitialData !== false;
    const subscribeToUpdates = options?.subscribeToUpdates !== false;

    const initialDataBlock = includeInitial
      ? `
      window.__mcpToolOutput = ${safeJson(output ?? null)};
      if (window.__frontmcp && window.__frontmcp.setState) {
        window.__frontmcp.setState({
          output: window.__mcpToolOutput,
          loading: false,
        });
      }`
      : `
      window.__mcpToolOutput = null;
      if (window.__frontmcp && window.__frontmcp.setState) {
        window.__frontmcp.setState({
          output: null,
          loading: true,
        });
      }`;

    const subscriptionBlock = subscribeToUpdates
      ? `
      // Subscribe to platform tool result updates
      (function() {
        function subscribeToUpdates() {
          // OpenAI Apps SDK
          if (window.openai && window.openai.canvas && window.openai.canvas.onToolResult) {
            window.openai.canvas.onToolResult(function(result) {
              window.__mcpToolOutput = result;
              if (window.__frontmcp && window.__frontmcp.setState) {
                window.__frontmcp.setState({
                  output: result,
                  loading: false,
                });
              }
              // Dispatch custom event for React hooks
              window.dispatchEvent(new CustomEvent('frontmcp:toolResult', { detail: result }));
            });
            return;
          }

          // Fallback: listen for custom events (for testing/other platforms)
          window.addEventListener('frontmcp:injectData', function(e) {
            if (e.detail && e.detail.output !== undefined) {
              window.__mcpToolOutput = e.detail.output;
              if (window.__frontmcp && window.__frontmcp.setState) {
                window.__frontmcp.setState({
                  output: e.detail.output,
                  loading: false,
                });
              }
            }
          });
        }

        // Subscribe when DOM is ready
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', subscribeToUpdates);
        } else {
          subscribeToUpdates();
        }
      })();`
      : '';

    return `
    <!-- Tool Data Injection (Dynamic Mode - OpenAI Subscription) -->
    <script>
      window.__mcpToolName = ${safeJson(toolName)};
      window.__mcpToolInput = ${safeJson(input ?? null)};
      window.__mcpStructuredContent = ${safeJson(structuredContent ?? null)};
      ${initialDataBlock}

      // Initialize FrontMCP context
      if (window.__frontmcp && window.__frontmcp.setContext) {
        window.__frontmcp.setContext({
          toolName: window.__mcpToolName,
          toolInput: window.__mcpToolInput,
          toolOutput: window.__mcpToolOutput,
          structuredContent: window.__mcpStructuredContent,
        });
      }
      ${subscriptionBlock}
    </script>`;
  }

  /**
   * Build hybrid data injection - shell with placeholders for runtime injection.
   * Use injectHybridData() or injectHybridDataFull() from @frontmcp/uipack to replace the placeholders.
   */
  private buildHybridDataScript(
    toolName: string,
    _input?: Record<string, unknown>,
    structuredContent?: unknown,
    options?: HybridModeOptions,
  ): string {
    const safeJson = (value: unknown): string => {
      try {
        return JSON.stringify(value);
      } catch {
        return 'null';
      }
    };

    const outputPlaceholder = options?.placeholder ?? HYBRID_DATA_PLACEHOLDER;
    const inputPlaceholder = options?.inputPlaceholder ?? HYBRID_INPUT_PLACEHOLDER;

    return `
    <!-- Tool Data Injection (Hybrid Mode - Replace placeholders with JSON) -->
    <script>
      window.__mcpToolName = ${safeJson(toolName)};
      window.__mcpToolInput = "${inputPlaceholder}";
      window.__mcpToolOutput = "${outputPlaceholder}";
      window.__mcpStructuredContent = ${safeJson(structuredContent ?? null)};
      window.__mcpHybridError = null;

      // Parse placeholders if they've been replaced with actual JSON
      (function() {
        var outputNotReplaced = false;

        // Parse output placeholder
        var rawOutput = window.__mcpToolOutput;
        if (typeof rawOutput === 'string' && rawOutput !== "${outputPlaceholder}") {
          try {
            window.__mcpToolOutput = JSON.parse(rawOutput);
          } catch (e) {
            console.warn('[FrontMCP] Failed to parse injected output data:', e);
            window.__mcpToolOutput = null;
            window.__mcpHybridError = 'Failed to parse output data';
          }
        } else if (rawOutput === "${outputPlaceholder}") {
          // Placeholder not replaced - no data was injected
          window.__mcpToolOutput = null;
          outputNotReplaced = true;
        }

        // Parse input placeholder
        var rawInput = window.__mcpToolInput;
        if (typeof rawInput === 'string' && rawInput !== "${inputPlaceholder}") {
          try {
            window.__mcpToolInput = JSON.parse(rawInput);
          } catch (e) {
            console.warn('[FrontMCP] Failed to parse injected input data:', e);
            window.__mcpToolInput = null;
          }
        } else if (rawInput === "${inputPlaceholder}") {
          window.__mcpToolInput = null;
        }

        // Set error if output placeholder was not replaced (no data provided)
        if (outputNotReplaced) {
          window.__mcpHybridError = 'No data provided. The output placeholder was not replaced.';
        }
      })();

      // Initialize FrontMCP context with appropriate loading/error state
      if (window.__frontmcp && window.__frontmcp.setContext) {
        window.__frontmcp.setContext({
          toolName: window.__mcpToolName,
          toolInput: window.__mcpToolInput,
          toolOutput: window.__mcpToolOutput,
          structuredContent: window.__mcpStructuredContent,
          loading: false,
          error: window.__mcpHybridError,
        });
      }
    </script>`;
  }

  /**
   * Build component render script.
   * Wraps CommonJS code with module/exports shim to capture the component.
   */
  private buildComponentRenderScript(componentCode: string, rootId: string, cdnType: 'esm' | 'umd'): string {
    // CommonJS wrapper that captures exports and assigns to window.__frontmcp_component
    const wrappedCode = `
        // CommonJS module shim
        var module = { exports: {} };
        var exports = module.exports;

        // Execute transpiled component code (CommonJS format)
        ${componentCode}

        // Capture the component export
        window.__frontmcp_component = module.exports;
    `;

    if (cdnType === 'umd') {
      // UMD: Synchronous execution
      return `
    <!-- Component Render Script (UMD - synchronous) -->
    <script>
      (function() {
        ${wrappedCode}

        // Get the component
        var Component = window.__frontmcp_component.default || window.__frontmcp_component;

        // Render the component
        var container = document.getElementById('${rootId}');
        if (container && window.ReactDOM && window.ReactDOM.createRoot) {
          var root = window.ReactDOM.createRoot(container);
          root.render(React.createElement(Component, {
            output: window.__mcpToolOutput,
            input: window.__mcpToolInput,
          }));
        } else if (container && window.ReactDOM && window.ReactDOM.render) {
          // Fallback for React 17
          window.ReactDOM.render(
            React.createElement(Component, {
              output: window.__mcpToolOutput,
              input: window.__mcpToolInput,
            }),
            container
          );
        }
      })();
    </script>`;
    } else {
      // ESM: Wait for React to load
      return `
    <!-- Component Render Script (ESM - waits for React) -->
    <script type="module">
      function renderComponent() {
        ${wrappedCode}

        // Get the component
        var Component = window.__frontmcp_component.default || window.__frontmcp_component;

        // Render the component
        var container = document.getElementById('${rootId}');
        if (container && window.ReactDOM && window.ReactDOM.createRoot) {
          var root = window.ReactDOM.createRoot(container);
          root.render(React.createElement(Component, {
            output: window.__mcpToolOutput,
            input: window.__mcpToolInput,
          }));
        }
      }

      // Wait for React to be ready
      if (window.__reactReady) {
        renderComponent();
      } else {
        window.addEventListener('react:ready', renderComponent);
      }
    </script>`;
    }
  }

  /**
   * Assemble the complete static HTML document.
   */
  private assembleStaticHTML(parts: {
    title: string;
    head: string;
    reactRuntime: string;
    frontmcpRuntime: string;
    dataScript: string;
    componentScript: string;
    rootId: string;
    cdnType: 'esm' | 'umd';
  }): string {
    // Full-width layout - user provides styling via customCss
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <title>${escapeHtml(parts.title)}</title>
    ${parts.head}
    ${parts.reactRuntime}
    ${parts.frontmcpRuntime}
    ${parts.dataScript}
</head>
<body>
    <div id="${parts.rootId}" class="frontmcp-loading">
        <div class="frontmcp-spinner"></div>
    </div>
    ${parts.componentScript}
</body>
</html>`;
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
