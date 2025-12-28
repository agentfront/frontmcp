/**
 * Widget Manifest Builder
 *
 * Builds static widget wrappers with embedded manifests for tool UIs.
 * Produces complete HTML documents with FrontMCP Bridge runtime.
 *
 * @packageDocumentation
 */

import type {
  UIType,
  BundlingMode,
  DisplayMode,
  ResourceMode,
  OutputMode,
  CSPDirectives,
  RendererAssets,
  WidgetManifest,
  WidgetConfig,
  BuildManifestResult,
  BuildManifestOptions,
  OpenAIMetaFields,
  ToolResponseMeta,
} from '../types/ui-runtime';
import {
  DEFAULT_CSP_BY_TYPE,
  isUIType,
  isResourceMode,
} from '../types/ui-runtime';
import { getDefaultAssets } from './cdn-resources';
import type { ThemeConfig } from '../theme';
import { wrapToolUIUniversal } from '../runtime/wrapper';
import { rendererRegistry } from '../renderers/registry';
import { detectTemplateType, mdxClientRenderer } from '../renderers';

// File-based template support
import { detectTemplateMode, detectFormatFromPath } from '../dependency/types';

// Template validation
import { validateTemplate, logValidationWarnings } from '../validation';
import type {
  CDNPlatformType,
  ComponentBuildManifest,
  TemplateFormat,
} from '../dependency/types';
import { resolveTemplate } from '../dependency/template-loader';
import { processTemplate } from '../dependency/template-processor';

// ============================================
// UI Type Detection
// ============================================

/**
 * Check if a template is a file path.
 *
 * @param template - Widget template
 * @returns true if the template is a file path
 */
export function isFilePathTemplate(template: unknown): template is string {
  return detectTemplateMode(template) === 'file-path';
}

/**
 * Check if a template is a URL.
 *
 * @param template - Widget template
 * @returns true if the template is a URL
 */
export function isUrlTemplate(template: unknown): template is string {
  return detectTemplateMode(template) === 'url';
}

/**
 * Check if a template is file-based (either file path or URL).
 *
 * @param template - Widget template
 * @returns true if the template is file-based
 */
export function isFileBasedTemplate(template: unknown): template is string {
  const mode = detectTemplateMode(template);
  return mode === 'file-path' || mode === 'url';
}

/**
 * Detect the UI type from a template.
 *
 * @param template - Widget template
 * @returns Detected UI type
 */
export function detectUIType(template: WidgetConfig['template']): UIType {
  // Check for file-based templates first (file paths or URLs)
  if (isFileBasedTemplate(template)) {
    // Detect based on file extension using the shared utility
    const format = detectFormatFromPath(template);
    return templateFormatToUIType(format);
  }

  const detection = detectTemplateType(template);

  switch (detection.type) {
    case 'react':
      return 'react';
    case 'mdx':
      return 'mdx';
    case 'jsx-string':
      return 'react'; // JSX strings are rendered as React
    case 'html-string':
    case 'html-function':
      return 'html';
    default:
      return 'auto';
  }
}

/**
 * Convert a TemplateFormat to UIType.
 *
 * @param format - Template format
 * @returns Corresponding UI type
 */
function templateFormatToUIType(format: TemplateFormat): UIType {
  switch (format) {
    case 'react':
      return 'react';
    case 'mdx':
      return 'mdx';
    case 'markdown':
      return 'html'; // Markdown renders to HTML
    case 'html':
    default:
      return 'html';
  }
}

// ============================================
// CSP Building
// ============================================

/**
 * Build CSP directives for a UI type.
 *
 * @param uiType - UI renderer type
 * @param userCsp - User-provided CSP overrides
 * @returns Complete CSP directives
 */
export function buildCSPForType(
  uiType: UIType,
  userCsp?: Partial<CSPDirectives>
): CSPDirectives {
  const baseCsp = DEFAULT_CSP_BY_TYPE[uiType] ?? DEFAULT_CSP_BY_TYPE['auto'];

  if (!userCsp) {
    return { ...baseCsp };
  }

  // Merge user CSP with base CSP
  return {
    scriptSrc: mergeCspArray(baseCsp.scriptSrc, userCsp.scriptSrc),
    styleSrc: mergeCspArray(baseCsp.styleSrc, userCsp.styleSrc),
    connectSrc: mergeCspArray(baseCsp.connectSrc, userCsp.connectSrc),
    imgSrc: userCsp.imgSrc ?? baseCsp.imgSrc,
    fontSrc: userCsp.fontSrc ?? baseCsp.fontSrc,
    defaultSrc: userCsp.defaultSrc ?? baseCsp.defaultSrc,
    frameSrc: userCsp.frameSrc ?? baseCsp.frameSrc,
    objectSrc: userCsp.objectSrc ?? baseCsp.objectSrc,
  };
}

/**
 * Merge CSP arrays, preserving uniqueness.
 */
function mergeCspArray(base: string[], override?: string[]): string[] {
  if (!override) return [...base];
  const merged = new Set([...base, ...override]);
  return Array.from(merged);
}

/**
 * Build CSP meta tag content.
 */
export function buildCSPMetaContent(csp: CSPDirectives): string {
  const directives: string[] = [];

  if (csp.defaultSrc?.length) {
    directives.push(`default-src ${csp.defaultSrc.join(' ')}`);
  }
  if (csp.scriptSrc.length) {
    directives.push(`script-src ${csp.scriptSrc.join(' ')}`);
  }
  if (csp.styleSrc.length) {
    directives.push(`style-src ${csp.styleSrc.join(' ')}`);
  }
  if (csp.connectSrc.length) {
    directives.push(`connect-src ${csp.connectSrc.join(' ')}`);
  }
  if (csp.imgSrc?.length) {
    directives.push(`img-src ${csp.imgSrc.join(' ')}`);
  }
  if (csp.fontSrc?.length) {
    directives.push(`font-src ${csp.fontSrc.join(' ')}`);
  }
  if (csp.frameSrc?.length) {
    directives.push(`frame-src ${csp.frameSrc.join(' ')}`);
  }
  if (csp.objectSrc?.length) {
    directives.push(`object-src ${csp.objectSrc.join(' ')}`);
  }

  return directives.join('; ');
}

// ============================================
// Renderer Assets
// ============================================

/**
 * Get renderer assets for a UI type.
 *
 * @param uiType - UI renderer type
 * @param resourceMode - Resource loading mode (cdn or inline)
 * @returns Required renderer assets with CDN URLs or inline placeholders
 *
 * @example
 * ```typescript
 * // Get CDN-based assets for React
 * const assets = getRendererAssets('react', 'cdn');
 * console.log(assets.react?.url);
 * // "https://unpkg.com/react@18/umd/react.production.min.js"
 *
 * // Get inline-mode assets
 * const inlineAssets = getRendererAssets('react', 'inline');
 * // inlineAssets.mode === 'inline'
 * ```
 */
export function getRendererAssets(uiType: UIType, resourceMode: ResourceMode = 'cdn'): RendererAssets {
  // Use the CDN resources helper which provides proper CDN URLs
  return getDefaultAssets(uiType, resourceMode);
}

// ============================================
// Hash Generation
// ============================================

/**
 * Generate a hash for content.
 */
async function generateHash(content: string): Promise<string> {
  // Use Web Crypto API if available
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback: simple hash
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

// ============================================
// Main Builder
// ============================================

/**
 * Build a widget manifest for a tool.
 *
 * Creates a static widget wrapper with embedded manifest.
 * The widget can be cached and reused across tool invocations.
 *
 * @param options - Build options
 * @returns Build result with HTML, manifest, and metadata
 *
 * @example
 * ```typescript
 * import { buildToolWidgetManifest } from '@frontmcp/ui/build';
 *
 * const result = await buildToolWidgetManifest({
 *   toolName: 'weather.get',
 *   uiConfig: {
 *     template: WeatherWidget,
 *     uiType: 'react',
 *     displayMode: 'inline',
 *     widgetAccessible: true,
 *   },
 *   schema: { type: 'object', properties: { ... } },
 * });
 *
 * // Cache the HTML
 * cache.set(`ui://widget/${result.manifest.tool}.html`, result.html);
 * ```
 */
export async function buildToolWidgetManifest<
  Input = Record<string, unknown>,
  Output = unknown,
>(options: BuildManifestOptions<Input, Output>): Promise<BuildManifestResult> {
  const { toolName, uiConfig, schema, theme: _theme, sampleInput, sampleOutput, outputSchema, inputSchema } = options;

  // Resolve UI type
  // Use type assertion to handle complex generic template types
  const uiType: UIType = isUIType(uiConfig.uiType)
    ? uiConfig.uiType
    : detectUIType(uiConfig.template as WidgetConfig['template']);

  // Resolve display mode
  const displayMode: DisplayMode = uiConfig.displayMode ?? 'inline';

  // Resolve bundling mode
  const bundlingMode: BundlingMode = uiConfig.bundlingMode ?? 'static';

  // Resolve resource mode (cdn or inline)
  const resourceMode: ResourceMode = isResourceMode(uiConfig.resourceMode)
    ? uiConfig.resourceMode
    : 'cdn';

  // ============================================
  // Template Validation (Development Mode Only)
  // ============================================

  // Validate Handlebars expressions against output schema when provided
  if (outputSchema && process.env['NODE_ENV'] !== 'production') {
    const template = uiConfig.template;

    // Only validate string templates (inline HTML/MDX with Handlebars)
    if (typeof template === 'string') {
      const validation = validateTemplate(template, outputSchema, {
        inputSchema,
        warnOnOptional: true,
        suggestSimilar: true,
        toolName,
      });

      if (!validation.valid || validation.warnings.length > 0) {
        logValidationWarnings(validation, toolName);
      }
    }
    // For file-based templates, validation happens during template loading
  }

  // Build CSP
  const csp = buildCSPForType(uiType, uiConfig.csp);

  // Get renderer assets based on resource mode
  const rendererAssets = getRendererAssets(uiType, resourceMode);

  // Render the template to get initial content
  // Cast to generic type to avoid complex type inference issues
  const templateConfig = uiConfig as WidgetConfig<Record<string, unknown>, unknown>;
  const content = await renderTemplate(templateConfig, {
    input: (sampleInput ?? {}) as Record<string, unknown>,
    output: (sampleOutput ?? {}) as unknown,
    uiType,
    outputSchema,
    inputSchema,
    toolName,
  });

  // Generate component code for client-side rendering (React/MDX only)
  const componentCode = (uiType === 'react' || uiType === 'mdx')
    ? buildComponentCode(uiConfig.template, toolName)
    : undefined;

  // Build manifest
  // Note: We intentionally omit 'uri' since we're not using resource-based serving.
  // The content/html is returned directly in the tool response.
  const manifestBase: Omit<WidgetManifest, 'hash'> = {
    tool: toolName,
    uiType,
    bundlingMode,
    displayMode,
    widgetAccessible: uiConfig.widgetAccessible ?? false,
    schema: schema ?? {},
    csp,
    rendererAssets,
    createdAt: new Date().toISOString(),
    description: uiConfig.widgetDescription,
  };

  // Convert CSPDirectives to UIContentSecurityPolicy for wrapper
  const wrapperCsp = uiConfig.csp ? {
    connectDomains: uiConfig.csp.connectSrc,
    resourceDomains: [
      ...(uiConfig.csp.scriptSrc ?? []),
      ...(uiConfig.csp.styleSrc ?? []),
      ...(uiConfig.csp.imgSrc ?? []),
    ].filter((d) => d !== "'self'" && d !== "'unsafe-inline'"),
  } : undefined;

  // Build manifest script to embed in the page
  const manifestScript = buildManifestScript(manifestBase);

  // Prepend manifest script to content so it's available before the UI renders
  const contentWithManifest = manifestScript + '\n' + content;

  // Build the complete HTML with manifest embedded
  // Use inlineScripts when resourceMode is 'inline' (for blocked-network environments)
  const html = wrapToolUIUniversal({
    content: contentWithManifest,
    toolName,
    input: (sampleInput ?? {}) as Record<string, unknown>,
    output: sampleOutput as unknown,
    csp: wrapperCsp,
    widgetAccessible: uiConfig.widgetAccessible,
    includeBridge: true,
    rendererType: uiType,
    inlineScripts: resourceMode === 'inline',
    resourceMode, // Pass resource mode for CDN script generation
  });

  // Generate hash based on tool name + content (for cache invalidation)
  // Including toolName ensures different tools have different hashes even if content is similar
  const hash = await generateHash(`${toolName}:${content}`);

  // Complete manifest with hash
  const manifest: WidgetManifest = {
    ...manifestBase,
    hash: `sha256-${hash}`,
  };

  // Calculate sizes
  const contentSize = new TextEncoder().encode(content).length;
  const htmlSize = new TextEncoder().encode(html).length;
  const gzipSize = Math.round(htmlSize * 0.25); // Rough estimate

  return {
    // Transpiled content only (for capable clients like OpenAI)
    content,
    // Full HTML document (for limited/unknown MCP clients)
    html,
    manifest,
    hash,
    rendererType: uiType,
    // Component code for client-side rendering (React/MDX only)
    componentCode,
    contentSize,
    htmlSize,
    gzipSize,
    // Deprecated, kept for backwards compatibility
    size: htmlSize,
  };
}

/**
 * Build the manifest script tag for embedding in HTML.
 */
function buildManifestScript(manifest: Omit<WidgetManifest, 'hash'>): string {
  // Escape for embedding in script tag
  const json = JSON.stringify(manifest)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  return `
<script type="application/json" id="frontmcp-widget-manifest">
${json}
</script>
<script>
(function() {
  try {
    var manifest = JSON.parse(document.getElementById('frontmcp-widget-manifest').textContent);
    window.__frontmcp = window.__frontmcp || {};
    window.__frontmcp.widget = window.__frontmcp.widget || {};
    window.__frontmcp.widget.manifest = manifest;
  } catch (e) {
    console.error('[FrontMCP] Failed to parse widget manifest:', e);
  }
})();
</script>
  `.trim();
}

// ============================================
// Component Code Builder (for Client-Side Rendering)
// ============================================

/**
 * Build client-side component code for React templates.
 *
 * This converts the server-side React component into a string that can be
 * embedded in the widget HTML for client-side rendering when tool output
 * becomes available.
 *
 * @param template - The React component or template
 * @param toolName - Tool name for naming the component
 * @returns JavaScript code string that defines the component
 */
function buildComponentCode(template: unknown, toolName: string): string | undefined {
  if (typeof template !== 'function') {
    return undefined;
  }

  // Get the component function as a string
  const componentSource = template.toString();

  // Sanitize tool name for JavaScript variable name
  const safeName = toolName.replace(/[^a-zA-Z0-9_]/g, '_');

  // Build the component code that will be embedded in the HTML
  // The component is registered on window.__frontmcp_component for the render script
  return `
// FrontMCP Widget Component: ${toolName}
(function() {
  // The component function
  var ${safeName} = ${componentSource};

  // Register component globally for client-side rendering
  window.__frontmcp_component = ${safeName};

  // Also register in __frontmcp_components for multiple components
  window.__frontmcp_components = window.__frontmcp_components || {};
  window.__frontmcp_components['${toolName}'] = ${safeName};
})();
`.trim();
}

/**
 * Ensure renderers are registered before use.
 * This is called once and ensures React/MDX renderers are available.
 */
let renderersInitialized = false;

function ensureRenderersRegistered(): void {
  if (renderersInitialized) {
    return;
  }

  // Note: React renderer is in @frontmcp/ui package
  // For React support, use @frontmcp/ui instead of @frontmcp/uipack

  // Register MDX client renderer if not already registered
  if (!rendererRegistry.has('mdx')) {
    rendererRegistry.register(mdxClientRenderer);
  }

  renderersInitialized = true;
}

/**
 * Render template content.
 */
async function renderTemplate(
  uiConfig: WidgetConfig,
  options: {
    input: Record<string, unknown>;
    output: unknown;
    uiType: UIType;
    outputSchema?: import('zod').ZodTypeAny;
    inputSchema?: import('zod').ZodTypeAny;
    toolName?: string;
  }
): Promise<string> {
  const { input, output, uiType, outputSchema, inputSchema, toolName } = options;
  const template = uiConfig.template;

  // Ensure renderers are available
  ensureRenderersRegistered();

  // Build context for template
  const context = {
    input: input as Record<string, unknown>,
    output,
    structuredContent: undefined,
    helpers: {
      escapeHtml: (str: unknown) => {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, (c) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c] ?? c);
      },
      formatDate: (date: Date | string) => new Date(date).toLocaleDateString(),
      formatCurrency: (amount: number, currency = 'USD') =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount),
      uniqueId: (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 9)}`,
      jsonEmbed: (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
    },
  };

  // Handle file-based templates (file paths or URLs)
  if (typeof template === 'string' && isFileBasedTemplate(template)) {
    try {
      // Resolve template from file path or URL
      const resolved = await resolveTemplate(template);

      // React templates need bundling, return the code for client-side rendering
      if (resolved.format === 'react') {
        // React templates are bundled separately, return placeholder
        return `<div id="frontmcp-react-root" data-component="${template}">Loading...</div>`;
      }

      // Process non-React templates (HTML, Markdown, MDX) with Handlebars
      const processed = await processTemplate(resolved, {
        context: {
          input,
          output,
          structuredContent: undefined,
        },
        outputSchema,
        inputSchema,
        toolName,
      });

      // Return the processed HTML (HTML, Markdown, MDX all produce html)
      if ('html' in processed && processed.html) {
        return processed.html;
      }

      // Fallback for code output (shouldn't happen for non-React since we handled it above)
      if ('code' in processed && processed.code) {
        return processed.code;
      }

      return resolved.content;
    } catch (error) {
      console.warn('[FrontMCP] File-based template rendering failed:', error);
      return `<div class="error">Template loading failed: ${error instanceof Error ? error.message : 'Unknown error'}</div>`;
    }
  }

  // Try to render using the registry for inline templates
  try {
    // Use the detected uiType to render with the correct renderer
    if (uiType === 'react' && rendererRegistry.has('react')) {
      const result = await rendererRegistry.renderWith('react', template, context, {
        mdxComponents: uiConfig.mdxComponents,
      });
      return result.html;
    }

    if (uiType === 'mdx' && rendererRegistry.has('mdx')) {
      const result = await rendererRegistry.renderWith('mdx', template, context, {
        mdxComponents: uiConfig.mdxComponents,
      });
      return result.html;
    }

    // Auto-detect and render
    const result = await rendererRegistry.render(template, context, {
      mdxComponents: uiConfig.mdxComponents,
    });
    return result.html;
  } catch (error) {
    // Fallback: simple rendering
    if (typeof template === 'string') {
      return template;
    }
    if (typeof template === 'function') {
      // Check if it's a React component (has prototype or is class)
      const isReact = template.prototype?.isReactComponent ||
        (template as { $$typeof?: symbol }).$$typeof !== undefined;

      if (!isReact) {
        // It's a template builder function
        return (template as (ctx: typeof context) => string)(context);
      }
    }
    // Log the error for debugging
    console.warn('[FrontMCP] Template rendering failed:', error);
    return `<div class="error">Template rendering failed</div>`;
  }
}

// ============================================
// Batch Building
// ============================================

/**
 * Options for batch building multiple widgets.
 */
export interface BatchBuildOptions {
  /**
   * Array of tool configurations to build.
   */
  tools: Array<{
    toolName: string;
    uiConfig: WidgetConfig;
    schema?: object;
  }>;

  /**
   * Theme configuration to apply to all widgets.
   */
  theme?: ThemeConfig;

  /**
   * Enable parallel building.
   * @default true
   */
  parallel?: boolean;
}

/**
 * Result of batch building.
 */
export interface BatchBuildResult {
  /**
   * Individual build results keyed by tool name.
   */
  results: Map<string, BuildManifestResult>;

  /**
   * Total build time in ms.
   */
  totalTime: number;

  /**
   * Number of successful builds.
   */
  successCount: number;

  /**
   * Errors encountered (keyed by tool name).
   */
  errors: Map<string, Error>;
}

/**
 * Build multiple widget manifests in batch.
 *
 * @param options - Batch build options
 * @returns Batch build results
 *
 * @example
 * ```typescript
 * const { results, errors } = await batchBuildWidgets({
 *   tools: [
 *     { toolName: 'weather.get', uiConfig: weatherConfig },
 *     { toolName: 'stock.quote', uiConfig: stockConfig },
 *   ],
 * });
 *
 * for (const [name, result] of results) {
 *   cache.set(result.manifest.uri, result.html);
 * }
 * ```
 */
export async function batchBuildWidgets(options: BatchBuildOptions): Promise<BatchBuildResult> {
  const startTime = performance.now();
  const results = new Map<string, BuildManifestResult>();
  const errors = new Map<string, Error>();

  const { tools, theme, parallel = true } = options;

  if (parallel) {
    // Build in parallel
    const promises = tools.map(async (tool) => {
      try {
        const result = await buildToolWidgetManifest({
          toolName: tool.toolName,
          uiConfig: tool.uiConfig,
          schema: tool.schema,
          theme,
        });
        return { toolName: tool.toolName, result, error: null };
      } catch (error) {
        return {
          toolName: tool.toolName,
          result: null,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    });

    const outcomes = await Promise.all(promises);

    for (const outcome of outcomes) {
      if (outcome.result) {
        results.set(outcome.toolName, outcome.result);
      } else if (outcome.error) {
        errors.set(outcome.toolName, outcome.error);
      }
    }
  } else {
    // Build sequentially
    for (const tool of tools) {
      try {
        const result = await buildToolWidgetManifest({
          toolName: tool.toolName,
          uiConfig: tool.uiConfig,
          schema: tool.schema,
          theme,
        });
        results.set(tool.toolName, result);
      } catch (error) {
        errors.set(
          tool.toolName,
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }
  }

  return {
    results,
    totalTime: performance.now() - startTime,
    successCount: results.size,
    errors,
  };
}

// ============================================
// _meta Field Builders
// ============================================

/**
 * Options for building tool response _meta fields.
 */
export interface BuildMetaOptions {
  /**
   * Build result from buildToolWidgetManifest.
   */
  buildResult: BuildManifestResult;

  /**
   * Output mode - determines which content to include.
   * - 'code-only': Include ui/content (transpiled code only)
   * - 'full-ssr': Include ui/html (complete HTML document)
   *
   * @default 'code-only'
   */
  outputMode?: OutputMode;

  /**
   * Include OpenAI-specific meta fields.
   * @default true
   */
  includeOpenAI?: boolean;
}

/**
 * Build _meta fields for a tool response.
 *
 * This function generates the proper _meta structure for UI widgets.
 * All UI-related data goes in _meta, NOT in the content array.
 *
 * @param options - Build options
 * @returns _meta fields object to spread into tool response
 *
 * @example
 * ```typescript
 * const buildResult = await buildToolWidgetManifest({...});
 *
 * // For OpenAI (code-only mode)
 * const meta = buildToolResponseMeta({
 *   buildResult,
 *   outputMode: 'code-only',
 * });
 *
 * return {
 *   content: [{ type: 'text', text: 'Weather retrieved' }],
 *   _meta: meta,
 * };
 *
 * // For unknown clients (full-ssr mode)
 * const meta = buildToolResponseMeta({
 *   buildResult,
 *   outputMode: 'full-ssr',
 * });
 * ```
 */
export function buildToolResponseMeta(options: BuildMetaOptions): ToolResponseMeta {
  const { buildResult, outputMode = 'code-only', includeOpenAI = true } = options;
  const { manifest, content, html, hash, rendererType } = buildResult;

  // Base UI meta fields
  const meta: ToolResponseMeta = {
    'ui/type': rendererType,
    'ui/hash': hash,
  };

  // Add content based on output mode
  if (outputMode === 'code-only') {
    meta['ui/content'] = content;
  } else {
    meta['ui/html'] = html;
  }

  // Add optional fields from manifest
  if (manifest.displayMode && manifest.displayMode !== 'inline') {
    meta['ui/displayMode'] = manifest.displayMode;
  }

  if (manifest.widgetAccessible) {
    meta['ui/widgetAccessible'] = true;
  }

  if (manifest.description) {
    meta['ui/description'] = manifest.description;
  }

  // Add resource mode if not default
  if (manifest.rendererAssets?.mode && manifest.rendererAssets.mode !== 'cdn') {
    meta['ui/resourceMode'] = manifest.rendererAssets.mode;
  }

  // Add OpenAI-specific fields
  if (includeOpenAI) {
    if (manifest.widgetAccessible) {
      meta['openai/widgetAccessible'] = true;
    }

    if (manifest.description) {
      meta['openai/widgetDescription'] = manifest.description;
    }

    if (manifest.displayMode && manifest.displayMode !== 'inline') {
      meta['openai/displayMode'] = manifest.displayMode;
    }

    // Build OpenAI CSP from manifest CSP
    const csp = manifest.csp;
    if (csp) {
      const openaiCsp: OpenAIMetaFields['openai/widgetCSP'] = {};

      if (csp.connectSrc && csp.connectSrc.length > 0) {
        openaiCsp.connect_domains = csp.connectSrc.filter(
          (d) => d !== "'self'" && d !== "'none'"
        );
      }

      const resourceDomains = [
        ...(csp.scriptSrc || []),
        ...(csp.styleSrc || []),
        ...(csp.imgSrc || []),
      ].filter((d) => d !== "'self'" && d !== "'unsafe-inline'" && d !== "'none'");

      if (resourceDomains.length > 0) {
        openaiCsp.resource_domains = [...new Set(resourceDomains)];
      }

      if (openaiCsp.connect_domains?.length || openaiCsp.resource_domains?.length) {
        meta['openai/widgetCSP'] = openaiCsp;
      }
    }
  }

  return meta;
}

/**
 * Determine the appropriate output mode based on client info.
 *
 * Platform capabilities:
 * - OpenAI/ChatGPT/Cursor: Can load CDN scripts, use 'code-only' (smaller payload)
 * - Claude: Sandboxed artifacts block ALL external requests, MUST use 'full-ssr' (embedded HTML)
 * - Unknown: Default to 'full-ssr' for maximum compatibility
 *
 * @param clientInfo - MCP client information
 * @returns Recommended output mode
 *
 * @example
 * ```typescript
 * const outputMode = getOutputModeForClient(request.clientInfo);
 * const meta = buildToolResponseMeta({ buildResult, outputMode });
 * ```
 */
export function getOutputModeForClient(clientInfo?: {
  name?: string;
  version?: string;
}): OutputMode {
  if (!clientInfo?.name) {
    // Unknown client - use full SSR for safety
    return 'full-ssr';
  }

  const name = clientInfo.name.toLowerCase();

  // OpenAI/ChatGPT/Cursor: Can fetch CDN resources, provide their own runtime
  if (
    name.includes('openai') ||
    name.includes('chatgpt') ||
    name.includes('cursor')
  ) {
    return 'code-only';
  }

  // Claude: Uses dual-payload format for Artifacts
  // - Block 0: Pure JSON stringified data (for programmatic parsing)
  // - Block 1: Markdown-wrapped HTML (```html...```) for visual rendering
  // - Uses Cloudflare CDN (cdnjs.cloudflare.com) which is trusted by Claude sandbox
  if (name.includes('claude')) {
    return 'dual-payload';
  }

  // Default to full SSR for unknown clients
  return 'full-ssr';
}

// ============================================
// File-Based Template Building
// ============================================

/**
 * Options for building a file-based UI component.
 */
export interface FileComponentBuildOptions {
  /**
   * File path to the component entry point.
   * @example './widgets/chart.tsx'
   */
  entryPath: string;

  /**
   * Tool name for this component.
   */
  toolName: string;

  /**
   * Packages to load from CDN.
   */
  externals?: string[];

  /**
   * Explicit CDN dependency overrides.
   */
  dependencies?: Record<string, import('../dependency/types').CDNDependency>;

  /**
   * Bundle options.
   */
  bundleOptions?: import('../dependency/types').FileBundleOptions;

  /**
   * Target platform for CDN selection.
   * @default 'unknown'
   */
  platform?: CDNPlatformType;

  /**
   * Whether to skip cache lookup.
   * @default false
   */
  skipCache?: boolean;
}

/**
 * Result of a file-based component build.
 */
export interface FileComponentBuildResult {
  /**
   * The build manifest.
   */
  manifest: ComponentBuildManifest;

  /**
   * Complete HTML with dependencies and component code.
   */
  html: string;

  /**
   * Whether the result came from cache.
   */
  cached: boolean;

  /**
   * Build time in milliseconds.
   */
  buildTimeMs: number;
}

// Lazy-loaded component builder (to avoid circular dependencies)
let componentBuilderPromise: Promise<import('../bundler/file-cache').ComponentBuilder> | null = null;

/**
 * Get or create the component builder instance.
 */
async function getComponentBuilder(): Promise<import('../bundler/file-cache').ComponentBuilder> {
  if (!componentBuilderPromise) {
    componentBuilderPromise = (async () => {
      const { createFilesystemBuilder } = await import('../bundler/file-cache/component-builder.js');
      return createFilesystemBuilder();
    })();
  }
  return componentBuilderPromise;
}

/**
 * Build a file-based UI component.
 *
 * This function handles the complete build pipeline for file-based templates:
 * 1. Check cache for existing build
 * 2. Parse entry file for imports
 * 3. Resolve external dependencies to CDN URLs
 * 4. Bundle the component with esbuild
 * 5. Generate import map for CDN dependencies
 * 6. Store result in cache
 *
 * @param options - Build options
 * @returns Build result with manifest and HTML
 *
 * @example
 * ```typescript
 * const result = await buildFileComponent({
 *   entryPath: './widgets/chart.tsx',
 *   toolName: 'chart_display',
 *   externals: ['chart.js', 'react-chartjs-2'],
 *   platform: 'claude',
 * });
 *
 * // Use the HTML in tool response
 * return {
 *   content: [{ type: 'text', text: 'Chart rendered' }],
 *   _meta: {
 *     'ui/html': result.html,
 *     'ui/hash': result.manifest.contentHash,
 *   },
 * };
 * ```
 */
export async function buildFileComponent(
  options: FileComponentBuildOptions
): Promise<FileComponentBuildResult> {
  const {
    entryPath,
    toolName,
    externals = [],
    dependencies = {},
    bundleOptions = {},
    platform = 'unknown',
    skipCache = false,
  } = options;

  const startTime = performance.now();

  // Get the component builder
  const builder = await getComponentBuilder();

  // Build the component
  const buildResult = await builder.build({
    entryPath,
    toolName,
    externals,
    dependencies,
    bundleOptions,
    platform,
    skipCache,
  });

  // Generate the complete HTML
  const html = builder.generateHTML(buildResult.manifest, process.env['NODE_ENV'] === 'production');

  return {
    manifest: buildResult.manifest,
    html,
    cached: buildResult.cached,
    buildTimeMs: performance.now() - startTime,
  };
}

/**
 * Build multiple file-based components.
 *
 * @param options - Array of build options
 * @returns Array of build results
 */
export async function buildFileComponents(
  options: FileComponentBuildOptions[]
): Promise<FileComponentBuildResult[]> {
  return Promise.all(options.map(buildFileComponent));
}

/**
 * Check if a file-based component needs rebuilding.
 *
 * @param options - Build options (without skipCache)
 * @returns true if the component needs rebuilding
 */
export async function needsFileComponentRebuild(
  options: Omit<FileComponentBuildOptions, 'skipCache'>
): Promise<boolean> {
  const builder = await getComponentBuilder();
  return builder.needsRebuild({
    entryPath: options.entryPath,
    externals: options.externals,
    dependencies: options.dependencies,
    bundleOptions: options.bundleOptions,
  });
}

/**
 * Get a cached file-based component build.
 *
 * @param options - Build options
 * @returns Cached manifest or undefined
 */
export async function getCachedFileComponent(
  options: Omit<FileComponentBuildOptions, 'skipCache' | 'toolName'>
): Promise<ComponentBuildManifest | undefined> {
  const builder = await getComponentBuilder();
  return builder.getCached({
    entryPath: options.entryPath,
    externals: options.externals,
    dependencies: options.dependencies,
    bundleOptions: options.bundleOptions,
  });
}

/**
 * Map MCP client info to platform type.
 *
 * @param clientInfo - MCP client information
 * @returns Platform type for CDN selection
 */
export function getPlatformFromClientInfo(clientInfo?: {
  name?: string;
  version?: string;
}): CDNPlatformType {
  if (!clientInfo?.name) {
    return 'unknown';
  }

  const name = clientInfo.name.toLowerCase();

  if (name.includes('claude')) return 'claude';
  if (name.includes('openai') || name.includes('chatgpt')) return 'openai';
  if (name.includes('cursor')) return 'cursor';
  if (name.includes('gemini')) return 'gemini';
  if (name.includes('continue')) return 'continue';
  if (name.includes('cody')) return 'cody';

  return 'unknown';
}
