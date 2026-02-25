/**
 * Build-Time API for Tool UI
 *
 * Provides pre-compilation capabilities for tool UI templates.
 * Produces a **universal HTML document** that works across all platforms:
 * - OpenAI ChatGPT (Apps SDK)
 * - Anthropic Claude
 * - MCP Apps (ext-apps / SEP-1865)
 * - Google Gemini
 * - Any MCP-compatible host
 *
 * The build embeds the FrontMCP Bridge which auto-detects the host
 * at runtime and adapts its communication protocol accordingly.
 *
 * @packageDocumentation
 */

import type { UITemplateConfig, TemplateContext } from '../types';
import type { ThemeConfig, DeepPartial } from '../theme';
import { wrapToolUIUniversal, createTemplateHelpers } from '../runtime/wrapper';
import { rendererRegistry } from '../renderers/registry';
import { detectTemplateType } from '../renderers';
import type { TemplateBuilderFn } from '../types';

// ============================================
// Build Types
// ============================================

/**
 * Network access mode for the target environment.
 *
 * - `'open'`: Can fetch external resources (CDN scripts, fonts)
 * - `'blocked'`: Network is sandboxed, must inline everything
 */
export type NetworkMode = 'open' | 'blocked';

/**
 * Script loading strategy.
 *
 * - `'cdn'`: Load scripts from CDN (smaller HTML, requires network)
 * - `'inline'`: Embed scripts in HTML (larger, works offline)
 * - `'auto'`: Choose based on network mode
 */
export type ScriptStrategy = 'cdn' | 'inline' | 'auto';

/**
 * Build configuration options.
 * Capability-based rather than platform-specific.
 */
export interface BuildConfig {
  /**
   * Network access mode.
   * @default 'open'
   */
  network?: NetworkMode;

  /**
   * Script loading strategy.
   * @default 'auto' (uses 'inline' if network is 'blocked')
   */
  scripts?: ScriptStrategy;

  /**
   * Whether to include the FrontMCP Bridge runtime.
   * The bridge auto-detects the host platform at runtime.
   * @default true
   */
  includeBridge?: boolean;

  /**
   * Whether to minify the output HTML.
   * @default false
   */
  minify?: boolean;
}

/**
 * Options for building a tool UI template.
 *
 * @example
 * ```typescript
 * const result = await buildToolUI({
 *   template: {
 *     template: (ctx) => `<div>${ctx.output.value}</div>`,
 *     widgetAccessible: true,
 *   },
 *   toolName: 'my_tool',
 *   input: { query: 'hello' },
 *   output: { value: 'world' },
 * });
 *
 * // Universal HTML that works on any platform
 * console.log(result.html);
 * ```
 */
export interface BuildOptions<In = unknown, Out = unknown> {
  /**
   * UI template configuration.
   */
  template: UITemplateConfig<In, Out>;

  /**
   * Name of the tool this UI is for.
   */
  toolName: string;

  /**
   * Tool input arguments.
   */
  input?: In;

  /**
   * Tool output/result data.
   */
  output?: Out;

  /**
   * Theme configuration override.
   */
  theme?: DeepPartial<ThemeConfig>;

  /**
   * Build configuration.
   * Controls network mode, script strategy, etc.
   */
  config?: BuildConfig;

  /**
   * Title for the HTML document.
   */
  title?: string;
}

/**
 * MIME types for different host platforms.
 * Returned as suggestions - the MCP server response layer decides which to use.
 */
export interface MimeTypes {
  /** For OpenAI ChatGPT Apps SDK */
  openai: 'text/html+skybridge';
  /** For Claude, MCP Apps, and standard MCP hosts */
  mcp: 'text/html+mcp';
  /** Generic HTML (fallback) */
  html: 'text/html';
}

/**
 * Result of building a tool UI template.
 */
export interface BuildResult {
  /**
   * Complete HTML document string.
   * This is universal - works on all platforms.
   */
  html: string;

  /**
   * Size of the HTML in bytes.
   */
  size: number;

  /**
   * Size of the gzipped HTML in bytes (estimated).
   */
  gzipSize: number;

  /**
   * SHA-256 hash of the HTML content.
   */
  hash: string;

  /**
   * Suggested MIME types for different hosts.
   * The MCP server response layer should select based on detected client.
   */
  mimeTypes: MimeTypes;

  /**
   * Renderer type used (html, react, mdx).
   */
  rendererType: string;

  /**
   * Build timestamp (ISO 8601).
   */
  buildTime: string;

  /**
   * Build configuration used.
   */
  config: Required<BuildConfig>;
}

// ============================================
// Build Functions
// ============================================

/**
 * Build a tool UI template into a universal HTML document.
 *
 * The output HTML:
 * - Works on ALL platforms (OpenAI, Claude, MCP Apps, Gemini, etc.)
 * - Includes FrontMCP Bridge that auto-detects the host at runtime
 * - Adapts communication protocol based on detected platform
 *
 * @example Basic usage
 * ```typescript
 * import { buildToolUI } from '@frontmcp/ui/build';
 *
 * const result = await buildToolUI({
 *   template: { template: WeatherWidget },
 *   toolName: 'get_weather',
 *   output: { temperature: 72, conditions: 'sunny' },
 * });
 *
 * // Upload to CDN - works everywhere
 * await uploadToCDN('widgets/get_weather.html', result.html);
 * ```
 *
 * @example With blocked network (for Claude Artifacts)
 * ```typescript
 * const result = await buildToolUI({
 *   template: { template: WeatherWidget },
 *   toolName: 'get_weather',
 *   config: { network: 'blocked' }, // Inlines all scripts
 * });
 * ```
 *
 * @example MCP server response
 * ```typescript
 * const result = await buildToolUI({ template, toolName, output });
 *
 * // In MCP server - choose MIME type based on client
 * const mimeType = isOpenAIClient(clientInfo)
 *   ? result.mimeTypes.openai  // 'text/html+skybridge'
 *   : result.mimeTypes.mcp;    // 'text/html+mcp'
 *
 * return { content: [{ type: mimeType, data: result.html }] };
 * ```
 */
export async function buildToolUI<In = unknown, Out = unknown>(
  options: BuildOptions<In, Out>
): Promise<BuildResult> {
  const startTime = Date.now();

  const {
    template: uiConfig,
    toolName,
    input = {} as In,
    output = {} as Out,
    theme,
    title,
    config: userConfig = {},
  } = options;

  // Build final config with defaults
  const config: Required<BuildConfig> = {
    network: userConfig.network ?? 'open',
    scripts: userConfig.scripts ?? 'auto',
    includeBridge: userConfig.includeBridge ?? true,
    minify: userConfig.minify ?? false,
  };

  // Resolve script strategy
  const useInlineScripts =
    config.scripts === 'inline' || (config.scripts === 'auto' && config.network === 'blocked');

  // Build template context
  const ctx = buildTemplateContext(input, output);

  // Render the template content
  const { html: content, rendererType } = await renderTemplate(uiConfig.template, ctx, {
    mdxComponents: uiConfig.mdxComponents,
  });

  // Wrap in universal HTML document
  const html = wrapToolUIUniversal({
    content,
    toolName,
    input: input as Record<string, unknown>,
    output,
    csp: uiConfig.csp,
    widgetAccessible: uiConfig.widgetAccessible,
    title: title || `${toolName} Widget`,
    theme,
    includeBridge: config.includeBridge,
    inlineScripts: useInlineScripts,
    rendererType,
  });

  // Optionally minify
  const finalHtml = config.minify ? minifyHtml(html) : html;

  // Calculate size and hash
  const size = Buffer.byteLength(finalHtml, 'utf8');
  const gzipSize = estimateGzipSize(finalHtml);
  const hash = await calculateHash(finalHtml);

  return {
    html: finalHtml,
    size,
    gzipSize,
    hash,
    mimeTypes: {
      openai: 'text/html+skybridge',
      mcp: 'text/html+mcp',
      html: 'text/html',
    },
    rendererType,
    buildTime: new Date(startTime).toISOString(),
    config,
  };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build template context from input/output.
 */
function buildTemplateContext<In = unknown, Out = unknown>(
  input: In,
  output: Out,
  structuredContent?: unknown
): TemplateContext<In, Out> {
  return {
    input,
    output,
    structuredContent,
    helpers: createTemplateHelpers(),
  };
}

/**
 * Render a template using the appropriate renderer.
 */
async function renderTemplate<In = unknown, Out = unknown>(
  template: UITemplateConfig<In, Out>['template'],
  ctx: TemplateContext<In, Out>,
  options?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mdxComponents?: Record<string, any>;
  }
): Promise<{ html: string; rendererType: string }> {
  // Detect template type
  const detection = detectTemplateType(template);

  // For simple HTML templates, use direct execution (sync, faster)
  if (detection.type === 'html-function' || detection.type === 'html-string') {
    const html =
      typeof template === 'function'
        ? (template as TemplateBuilderFn<In, Out>)(ctx)
        : (template as string);

    return { html, rendererType: 'html' };
  }

  // For React/MDX, use the renderer registry
  try {
    const result = await rendererRegistry.render(template, ctx, {
      mdxComponents: options?.mdxComponents,
    });

    return { html: result.html, rendererType: result.rendererType };
  } catch (error) {
    // Fallback to HTML if renderer fails
    console.warn(
      `[@frontmcp/ui/build] Renderer failed for ${detection.type}, falling back to HTML:`,
      error instanceof Error ? error.message : error
    );

    if (typeof template === 'function') {
      try {
        const html = (template as TemplateBuilderFn<In, Out>)(ctx);
        return { html, rendererType: 'html-fallback' };
      } catch {
        return {
          html: `<div class="error">Template rendering failed</div>`,
          rendererType: 'error',
        };
      }
    }

    return { html: String(template), rendererType: 'html-fallback' };
  }
}

/**
 * Simple HTML minification (remove whitespace between tags).
 */
function minifyHtml(html: string): string {
  return html
    .replace(/>\s+</g, '><') // Remove whitespace between tags
    .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Estimate gzipped size (rough approximation).
 */
function estimateGzipSize(content: string): number {
  // Rough estimate: gzip typically achieves 70-90% compression on HTML
  // We use 75% as a middle ground
  return Math.round(Buffer.byteLength(content, 'utf8') * 0.25);
}

/**
 * Calculate SHA-256 hash of content.
 */
async function calculateHash(content: string): Promise<string> {
  // Use Web Crypto API if available, otherwise fallback to simple hash
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Simple fallback hash (not cryptographically secure, but good enough for cache keys)
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ============================================
// Static Widget Builder
// ============================================

/**
 * Options for building a static widget that reads from host at runtime.
 */
export interface StaticWidgetOptions<In = unknown, Out = unknown> {
  /**
   * UI template configuration.
   */
  template: UITemplateConfig<In, Out>;

  /**
   * Name of the tool this UI is for.
   */
  toolName: string;

  /**
   * Theme configuration override.
   */
  theme?: DeepPartial<ThemeConfig>;

  /**
   * Build configuration.
   */
  config?: BuildConfig;

  /**
   * Title for the HTML document.
   */
  title?: string;
}

/**
 * Build a static widget that reads data from the host platform at runtime.
 *
 * Unlike buildToolUI which pre-renders with data, this creates a widget
 * that waits for data from the host platform via the FrontMCP Bridge.
 *
 * @example
 * ```typescript
 * import { buildStaticWidget } from '@frontmcp/ui/build';
 *
 * const widget = await buildStaticWidget({
 *   template: {
 *     template: (ctx) => `<div id="weather">${ctx.output?.temperature || 'Loading...'}</div>`,
 *   },
 *   toolName: 'get_weather',
 * });
 *
 * // This widget will receive data via FrontMCP Bridge
 * await uploadToCDN('widgets/get_weather.html', widget.html);
 * ```
 */
export async function buildStaticWidget<In = unknown, Out = unknown>(
  options: StaticWidgetOptions<In, Out>
): Promise<BuildResult> {
  const { template, toolName, theme, config, title } = options;

  // Build with empty data - the widget will receive data from host at runtime
  return buildToolUI({
    template,
    toolName,
    input: {} as In,
    output: {} as Out,
    theme,
    config,
    title: title || `${toolName} Widget`,
  });
}

// ============================================
// Re-exports for Convenience
// ============================================

export { createTemplateHelpers } from '../runtime/wrapper';
export type {
  UITemplateConfig,
  UITemplate,
  TemplateContext,
  TemplateHelpers,
  TemplateBuilderFn,
  UIContentSecurityPolicy,
  WidgetServingMode,
  WidgetDisplayMode,
} from '../types';
export type { ThemeConfig, PlatformCapabilities, DeepPartial } from '../theme';
export { DEFAULT_THEME, OPENAI_PLATFORM, CLAUDE_PLATFORM } from '../theme';

// ============================================
// Widget Manifest Builder (New API)
// ============================================

export {
  // Main builder
  buildToolWidgetManifest,
  batchBuildWidgets,
  // Detection utilities
  detectUIType,
  isFilePathTemplate,
  // CSP utilities
  buildCSPForType,
  buildCSPMetaContent,
  // Asset utilities
  getRendererAssets,
  // _meta field builders
  buildToolResponseMeta,
  getOutputModeForClient,
  // File-based component building
  buildFileComponent,
  buildFileComponents,
  needsFileComponentRebuild,
  getCachedFileComponent,
  getPlatformFromClientInfo,
} from './widget-manifest';

export type {
  BatchBuildOptions,
  BatchBuildResult,
  BuildMetaOptions,
  // File-based component types
  FileComponentBuildOptions,
  FileComponentBuildResult,
} from './widget-manifest';

// Re-export runtime types for convenience
export type {
  UIType,
  BundlingMode,
  DisplayMode,
  OutputMode,
  CSPDirectives,
  RendererAssets,
  WidgetManifest,
  WidgetConfig,
  BuildManifestResult,
  BuildManifestOptions,
  // _meta field types (NEW)
  UIMetaFields,
  OpenAIMetaFields,
  ToolResponseMeta,
} from '../types/ui-runtime';

export {
  DEFAULT_CSP_BY_TYPE,
  DEFAULT_RENDERER_ASSETS,
  isUIType,
  isBundlingMode,
  isDisplayMode,
  isResourceMode,
  isOutputMode,
} from '../types/ui-runtime';

export type { ResourceMode, CDNResource } from '../types/ui-runtime';

// ============================================
// CDN Resource Utilities
// ============================================

export {
  // CDN URL Constants
  REACT_CDN,
  REACT_DOM_CDN,
  MARKED_CDN,
  HANDLEBARS_CDN,
  MDX_RUNTIME_CDN,
  TAILWIND_CDN,
  // Cloudflare CDN (Claude-compatible)
  CLOUDFLARE_CDN,
  // Helper Functions
  getDefaultAssets,
  buildCDNScriptTag,
  buildScriptsForUIType,
  buildTailwindScriptTag,
  hasInlineScripts,
  getURLsToPreFetch,
  // Platform-aware Tailwind
  getTailwindForPlatform,
  buildCloudflareStylesheetTag,
  buildCloudflareScriptTag,
  // CDN Info for tools/list _meta
  buildCDNInfoForUIType,
} from './cdn-resources';

export type { CDNInfo, CDNPlatform } from './cdn-resources';

// ============================================
// Hybrid Mode Data Injection
// ============================================

export {
  // Constants
  HYBRID_DATA_PLACEHOLDER,
  HYBRID_INPUT_PLACEHOLDER,
  // Helper functions
  injectHybridData,
  injectHybridDataFull,
  injectHybridDataWithTrigger,
  isHybridShell,
  needsInputInjection,
  getHybridPlaceholders,
} from './hybrid-data';

// ============================================
// Browser-Compatible UI Components
// ============================================

export {
  // Main builder
  buildUIComponentsRuntime,
  // Individual builders (for custom composition)
  buildStyleConstants,
  buildCardComponent,
  buildButtonComponent,
  buildBadgeComponent,
  buildAlertComponent,
  buildNamespaceExport,
} from './ui-components-browser';

export type { BrowserUIComponentsOptions } from './ui-components-browser';

// ============================================
// New Builder Architecture
// ============================================

export {
  // Types
  type BuildMode,
  type CdnMode,
  type BuilderOptions,
  type BuildToolOptions,
  type StaticBuildResult,
  type HybridBuildResult,
  type InlineBuildResult,
  type BuilderResult,
  type Builder,
  type IStaticBuilder,
  type IHybridBuilder,
  type IInlineBuilder,
  type TemplateType,
  type TemplateDetection,
  type TranspileOptions,
  type TranspileResult,
  // Builders
  BaseBuilder,
  StaticBuilder,
  HybridBuilder,
  InlineBuilder,
  // esbuild utilities
  DEFAULT_EXTERNALS,
  EXTERNAL_GLOBALS,
  CDN_URLS,
  CLOUDFLARE_CDN_URLS,
  createTransformConfig,
  createExternalizedConfig,
  createInlineConfig,
  createExternalsBanner,
  generateCdnScriptTags,
  generateGlobalsSetupScript,
} from './builders';
