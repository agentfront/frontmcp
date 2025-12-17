/**
 * Tool UI Registry
 *
 * Manages UI template rendering for tool responses.
 * Provides platform-specific metadata generation for MCP clients.
 *
 * Three serving modes:
 * - **inline**: HTML is rendered per-request and embedded in _meta['ui/html']
 * - **static**: Static widget is pre-compiled at startup, client fetches via resources/read
 * - **hybrid**: Shell (React + renderer) cached at startup, component + data in response
 *
 * @packageDocumentation
 */

import { createHash } from 'crypto';
import type { UITemplateConfig, WidgetManifest, BuildManifestResult } from '../types';
import type { AIPlatformType, UIMetadata } from '../adapters';
import { renderToolTemplateAsync, isReactComponent } from './render-template';
import { buildUIMeta } from '../adapters';
import {
  wrapToolUIUniversal,
  wrapStaticWidgetUniversal,
  wrapLeanWidgetShell,
  wrapHybridWidgetShell,
} from '../runtime/wrapper';
import { buildToolWidgetManifest, detectUIType } from '../build';

/**
 * Options for renderAndRegisterAsync (inline mode).
 */
export interface RenderOptions {
  /** Tool name */
  toolName: string;
  /** Unique request identifier */
  requestId: string;
  /** Tool input arguments */
  input: Record<string, unknown>;
  /** Raw tool output */
  output: unknown;
  /** Structured content (parsed from output) */
  structuredContent?: unknown;
  /** Tool UI configuration */
  uiConfig: UITemplateConfig;
  /** Detected platform type */
  platformType: AIPlatformType;
  /** Widget access token (optional) */
  token?: string;
  /** Direct URL for widget serving (optional) */
  directUrl?: string;
}

/**
 * Result of rendering UI for inline mode.
 */
export interface UIRenderResult {
  /** Rendered HTML content */
  html: string;
  /** Platform-specific metadata for _meta field */
  meta: UIMetadata;
}

/**
 * Result when UI rendering fails in production (graceful degradation).
 * The caller should proceed without UI metadata.
 */
export interface UIRenderFailure {
  /** Indicates rendering failed */
  success: false;
  /** Reason for failure (for logging, not exposed to client) */
  reason: string;
}

/**
 * Type guard to check if a render result is a failure.
 *
 * @param result - The result to check
 * @returns true if the result is a UIRenderFailure
 *
 * @example
 * ```typescript
 * const result = await registry.renderAndRegisterAsync(options);
 * if (isUIRenderFailure(result)) {
 *   // Handle graceful degradation - proceed without UI
 *   console.log('UI rendering failed:', result.reason);
 *   return;
 * }
 * // result is UIRenderResult, has html and meta
 * const { html, meta } = result;
 * ```
 */
export function isUIRenderFailure(result: UIRenderResult | UIRenderFailure): result is UIRenderFailure {
  return 'success' in result && result.success === false;
}

/**
 * ToolUIRegistry manages UI template rendering for tool responses.
 *
 * It provides:
 * - Static widget compilation for static mode (pre-compiled at startup)
 * - Per-request HTML rendering for inline mode (embedded in _meta)
 * - Platform-specific _meta generation
 * - Widget manifest management
 *
 * @example
 * ```typescript
 * const registry = new ToolUIRegistry();
 *
 * // For inline mode: render HTML per-request
 * const result = await registry.renderAndRegisterAsync({
 *   toolName: 'get_weather',
 *   requestId: 'abc123',
 *   input: { location: 'London' },
 *   output: { temp: 72, conditions: 'Sunny' },
 *   uiConfig: tool.metadata.ui,
 *   platformType: 'openai',
 * });
 *
 * // result.meta can be spread into tool result _meta
 * return { content: [...], _meta: { ...result.meta } };
 * ```
 */

/**
 * Options for compiling a static widget.
 */
export interface CompileStaticWidgetOptions {
  /** Tool name (used for cache key and URI) */
  toolName: string;
  /** The template to compile (React component, HTML string, or builder function) */
  template: UITemplateConfig['template'];
  /** Tool UI configuration */
  uiConfig: UITemplateConfig;
}

/**
 * Payload for hybrid mode component delivery.
 * Sent in `_meta['ui/component']` at tool call time.
 */
export interface HybridComponentPayload {
  /** Transpiled component JavaScript code (ES module format) */
  code: string;
  /** Renderer type for the component */
  type: 'react' | 'mdx' | 'html';
  /** Tool name for identification */
  toolName: string;
  /** Content hash for cache validation */
  hash: string;
}

/**
 * Options for building a hybrid component payload.
 */
export interface BuildHybridComponentPayloadOptions {
  /** Tool name */
  toolName: string;
  /** The template to transpile */
  template: UITemplateConfig['template'];
  /** Tool UI configuration */
  uiConfig: UITemplateConfig;
}

export class ToolUIRegistry {
  /**
   * Cache for static widgets (keyed by tool name).
   * Static widgets are pre-compiled at server startup for tools with servingMode: 'static'.
   * These widgets read data from the FrontMCP Bridge at runtime (window.openai.toolOutput).
   */
  private readonly staticWidgetCache = new Map<string, string>();

  /**
   * Cache for widget manifests (keyed by tool name).
   * Manifests describe the widget's renderer type, CSP, and other metadata.
   */
  private readonly manifestCache = new Map<string, WidgetManifest>();

  /**
   * Cache for build results (keyed by tool name).
   * Includes HTML, manifest, and hash for cache validation.
   */
  private readonly buildResultCache = new Map<string, BuildManifestResult>();

  /**
   * Compile a static widget template for a tool at server startup.
   *
   * For tools with `servingMode: 'static'`, the widget HTML is pre-compiled
   * WITHOUT embedded data. The widget reads data from the FrontMCP Bridge at runtime
   * (via window.openai.toolOutput or window.__frontmcp.toolOutput).
   *
   * This is called during tool registration, not during tool calls.
   *
   * @param options - Static widget compilation options
   */
  async compileStaticWidgetAsync(options: CompileStaticWidgetOptions): Promise<void> {
    const { toolName, template, uiConfig } = options;

    // Try to use the new manifest builder first
    try {
      // Detect uiType if not provided (using type assertion for extended config)
      const extendedConfig = uiConfig as UITemplateConfig & {
        uiType?: string;
        bundlingMode?: string;
        resourceMode?: 'cdn' | 'inline';
        runtimeOptions?: { hydrate?: boolean };
      };
      const detectedType = detectUIType(template as Parameters<typeof detectUIType>[0]);

      // Convert UITemplateConfig to WidgetConfig format for the manifest builder
      const widgetConfig = {
        template: template as Parameters<typeof buildToolWidgetManifest>[0]['uiConfig']['template'],
        uiType: (extendedConfig.uiType ?? detectedType) as 'html' | 'react' | 'mdx' | 'markdown' | 'auto',
        displayMode: (uiConfig.displayMode ?? 'inline') as 'inline' | 'fullscreen' | 'pip',
        bundlingMode: (extendedConfig.bundlingMode ?? 'static') as 'static' | 'dynamic',
        resourceMode: (extendedConfig.resourceMode ?? 'cdn') as 'cdn' | 'inline',
        widgetAccessible: uiConfig.widgetAccessible,
        widgetDescription: uiConfig.widgetDescription,
        csp: uiConfig.csp
          ? {
              scriptSrc: uiConfig.csp.resourceDomains ?? [],
              styleSrc: uiConfig.csp.resourceDomains ?? [],
              connectSrc: uiConfig.csp.connectDomains ?? [],
              imgSrc: uiConfig.csp.resourceDomains ?? [],
            }
          : undefined,
        mdxComponents: uiConfig.mdxComponents,
        runtimeOptions: extendedConfig.runtimeOptions,
      };

      const result = await buildToolWidgetManifest({
        toolName,
        uiConfig: widgetConfig,
        schema: {},
      });

      // For React/MDX components, we need to use wrapStaticWidgetUniversal
      // to include the React runtime and rendering script
      if (result.componentCode && (result.rendererType === 'react' || result.rendererType === 'mdx')) {
        // Re-wrap with wrapStaticWidgetUniversal to include React runtime + rendering
        const widgetHtml = wrapStaticWidgetUniversal({
          toolName,
          ssrContent: result.content,
          uiConfig,
          rendererType: result.rendererType,
          componentCode: result.componentCode,
        });
        this.staticWidgetCache.set(toolName, widgetHtml);
      } else {
        // Use the pre-built HTML for non-React templates
        this.staticWidgetCache.set(toolName, result.html);
      }

      this.manifestCache.set(toolName, result.manifest);
      this.buildResultCache.set(toolName, result);
      return;
    } catch (error) {
      // Fall back to legacy compilation
      console.warn(`[ToolUIRegistry] Manifest build failed for ${toolName}, using legacy method:`, error);
    }

    // Legacy fallback: Render the template SSR'd WITHOUT data
    // The widget will read data from Bridge at runtime
    const ssrContent = await renderToolTemplateAsync({
      template,
      input: {}, // Empty - data comes from Bridge at runtime
      output: undefined,
      structuredContent: undefined,
      mdxComponents: uiConfig.mdxComponents,
    });

    // Handle graceful degradation: rendering failed in production
    // For static compilation, we still cache an empty widget with an error message
    if (ssrContent === null) {
      console.warn('[ToolUIRegistry] Static widget compilation failed (graceful degradation)', { toolName });
      // Don't cache anything - the tool will work without UI
      return;
    }

    // Wrap in a complete HTML document with FrontMCP Bridge
    // The Bridge will read data from window.openai.toolOutput at runtime
    const widgetHtml = wrapStaticWidgetUniversal({
      toolName,
      ssrContent,
      uiConfig,
    });

    // Cache the static widget HTML
    this.staticWidgetCache.set(toolName, widgetHtml);
  }

  /**
   * Compile a lean widget shell for inline mode tools at server startup.
   *
   * For tools with `servingMode: 'inline'`, we create a minimal HTML shell that:
   * - Contains only HTML structure, theme CSS, and fonts
   * - NO React runtime, NO component code, NO bridge
   * - OpenAI caches this at discovery time
   * - The actual React widget comes in each tool response with embedded data
   *
   * @param options - Options for lean widget compilation
   */
  compileLeanWidgetAsync(options: { toolName: string; uiConfig: UITemplateConfig }): void {
    const { toolName, uiConfig } = options;

    // Create a lean HTML shell with just theme and structure
    const leanHtml = wrapLeanWidgetShell({
      toolName,
      uiConfig: {
        widgetAccessible: uiConfig.widgetAccessible,
      },
    });

    // Cache the lean widget HTML
    this.staticWidgetCache.set(toolName, leanHtml);
  }

  /**
   * Compile a hybrid widget shell at server startup.
   *
   * For tools with `servingMode: 'hybrid'`, we create a shell that:
   * - Contains React 19 runtime from esm.sh CDN
   * - Contains FrontMCP Bridge (universal)
   * - Contains all FrontMCP hooks (useMcpBridgeContext, useToolOutput, etc.)
   * - Contains all FrontMCP UI components (Card, Badge, Button)
   * - Contains dynamic renderer script that imports components via blob URL
   * - NO component code (comes at tool call time via `_meta['ui/component']`)
   *
   * The shell listens for `ui/component` in tool response metadata and dynamically
   * imports the transpiled component code, then renders it with tool output data.
   *
   * @param options - Options for hybrid widget compilation
   */
  compileHybridWidgetAsync(options: { toolName: string; uiConfig: UITemplateConfig }): void {
    const { toolName, uiConfig } = options;

    // Create a hybrid shell with React runtime and dynamic renderer
    const hybridHtml = wrapHybridWidgetShell({
      toolName,
      uiConfig: {
        widgetAccessible: uiConfig.widgetAccessible,
        csp: uiConfig.csp,
      },
    });

    // Cache the hybrid widget HTML
    this.staticWidgetCache.set(toolName, hybridHtml);
  }

  /**
   * Build a component payload for hybrid mode tool responses.
   *
   * For tools with `servingMode: 'hybrid'`, this method is called at tool call time
   * to build the transpiled component code that gets delivered in `_meta['ui/component']`.
   *
   * The component code is in ES module format so it can be dynamically imported
   * via blob URL in the hybrid shell's renderer.
   *
   * @param options - Options for building the component payload
   * @returns The hybrid component payload, or undefined if template is not a function
   */
  buildHybridComponentPayload(options: BuildHybridComponentPayloadOptions): HybridComponentPayload | undefined {
    const { toolName, template } = options;

    // Detect the UI type
    const detectedType = this.detectUIType(template);

    // Only support function templates (React components) for hybrid mode
    if (typeof template !== 'function') {
      // For HTML strings, return undefined - hybrid mode is designed for React components
      // HTML templates should use inline mode instead
      return undefined;
    }

    // Get the component function as a string
    const componentSource = template.toString();

    // Sanitize tool name for JavaScript variable name
    const safeName = toolName.replace(/[^a-zA-Z0-9_]/g, '_');

    // Build ES module compatible component code
    // The component is exported as default and also registered globally
    // for the hybrid shell's dynamic renderer
    const code = `
// FrontMCP Hybrid Widget Component: ${toolName}
// Type: ${detectedType}

// The component function
const ${safeName} = ${componentSource};

// Register component globally for dynamic rendering
window.__frontmcp_component = ${safeName};

// Also register in __frontmcp_components for multiple components
window.__frontmcp_components = window.__frontmcp_components || {};
window.__frontmcp_components['${toolName}'] = ${safeName};

// Export as default for ES module import
export default ${safeName};
`.trim();

    // Generate hash for cache validation
    const hash = createHash('sha256').update(code).digest('hex').substring(0, 16);

    // Determine renderer type
    const type = detectedType === 'react' || detectedType === 'mdx' ? (detectedType as 'react' | 'mdx') : 'react'; // Default to react for function templates

    return {
      code,
      type,
      toolName,
      hash,
    };
  }

  /**
   * Get the pre-compiled static widget HTML for a tool.
   *
   * @param toolName - The tool name to look up
   * @returns Pre-compiled widget HTML, or undefined if not cached
   */
  getStaticWidget(toolName: string): string | undefined {
    return this.staticWidgetCache.get(toolName);
  }

  /**
   * Check if a tool has a pre-compiled static widget.
   *
   * @param toolName - The tool name to check
   * @returns true if the tool has a cached static widget
   */
  hasStaticWidget(toolName: string): boolean {
    return this.staticWidgetCache.has(toolName);
  }

  /**
   * Get the widget manifest for a tool.
   *
   * @param toolName - The tool name to look up
   * @returns Widget manifest, or undefined if not cached
   */
  getManifest(toolName: string): WidgetManifest | undefined {
    return this.manifestCache.get(toolName);
  }

  /**
   * Check if a tool has a cached manifest.
   *
   * @param toolName - The tool name to check
   * @returns true if the tool has a cached manifest
   */
  hasManifest(toolName: string): boolean {
    return this.manifestCache.has(toolName);
  }

  /**
   * Get the full build result for a tool.
   *
   * @param toolName - The tool name to look up
   * @returns Build result, or undefined if not cached
   */
  getBuildResult(toolName: string): BuildManifestResult | undefined {
    return this.buildResultCache.get(toolName);
  }

  /**
   * Detect the UI type for a template.
   *
   * @param template - The template to analyze
   * @returns Detected UI type
   */
  detectUIType(template: UITemplateConfig['template']): string {
    // Use the imported detectUIType function from build module
    return detectUIType(template as Parameters<typeof detectUIType>[0]);
  }

  /**
   * Render a tool's UI template for inline mode.
   *
   * This version supports all template types including React components.
   * The rendered HTML is embedded directly in _meta['ui/html'] for the client.
   *
   * For React/MDX components, the output is wrapped using wrapStaticWidgetUniversal
   * which includes the React 19 CDN, client-side rendering script, and all the
   * FrontMCP hooks/components. This provides the same rendering capability as
   * static mode, but with data embedded in each response.
   *
   * Error handling:
   * - **Production**: Returns `UIRenderFailure` on error (graceful degradation)
   * - **Development/Test**: Throws error for visibility and debugging
   *
   * @param options - Rendering options
   * @returns Promise resolving to render result with HTML and metadata, or failure on error
   */
  async renderAndRegisterAsync(options: RenderOptions): Promise<UIRenderResult | UIRenderFailure> {
    const { toolName, input, output, structuredContent, uiConfig, platformType, token, directUrl } = options;

    // Detect if this is a React component
    const detectedType = this.detectUIType(uiConfig.template);
    const isReactBased = detectedType === 'react' || detectedType === 'mdx';
    const templateType = typeof uiConfig.template;
    const templateIsFunction = templateType === 'function';

    // [DIAG] Log React detection for debugging CI failures
    if (detectedType === 'react' || toolName.includes('react')) {
      console.log('[DIAG:tool-ui-registry] React template detection', {
        toolName,
        detectedType,
        isReactBased,
        templateType,
        templateIsFunction,
        willUseReactPath: isReactBased && templateIsFunction,
        templateName: templateIsFunction ? (uiConfig.template as Function).name : 'N/A',
        platform: process.platform,
      });
    }

    let html: string;

    if (isReactBased && typeof uiConfig.template === 'function') {
      // For React/MDX components: Use wrapStaticWidgetUniversal with component code
      // This includes the React 19 CDN, client-side renderer, and all FrontMCP hooks
      // Same approach as static mode, but with data embedded

      // 1. Build the component code that will be embedded in the HTML
      const componentCode = this.buildComponentCode(uiConfig.template, toolName);

      // 2. Render SSR content (optional, for initial display)
      const ssrContent = await renderToolTemplateAsync({
        template: uiConfig.template,
        input,
        output,
        structuredContent,
        mdxComponents: uiConfig.mdxComponents,
      });

      // Check for graceful degradation (production error case)
      if (ssrContent === null) {
        console.warn('[ToolUIRegistry] React SSR returned null (graceful degradation)', { toolName, platformType });
        return { success: false, reason: 'React SSR rendering failed' };
      }

      // [DIAG] Log SSR result for React components
      if (toolName.includes('react')) {
        console.log('[DIAG:tool-ui-registry] React SSR completed', {
          toolName,
          componentCodeLength: componentCode?.length ?? 0,
          ssrContentLength: ssrContent?.length ?? 0,
          ssrContentPreview: ssrContent?.slice(0, 100),
        });
      }

      // 3. Wrap with React runtime + component code
      // This creates a complete HTML document with:
      // - React 19 CDN imports
      // - FrontMCP hooks (useMcpBridgeContext, useToolOutput, etc.)
      // - FrontMCP UI components (Card, Badge, Button)
      // - The component code registered as window.__frontmcp_component
      // - Client-side rendering script that hydrates with the embedded data
      html = wrapStaticWidgetUniversal({
        toolName,
        ssrContent,
        uiConfig,
        rendererType: detectedType,
        componentCode,
        // For inline mode, we embed the data in the HTML so the component
        // can render immediately without waiting for window.openai.toolOutput
        embeddedData: {
          input: input as Record<string, unknown>,
          output,
          structuredContent,
        },
        // Self-contained mode: no bridge, React manages state internally
        // This prevents OpenAI's wrapper from interfering with React re-renders
        selfContained: true,
      });

      // [DIAG] Log final HTML result for React components
      if (toolName.includes('react')) {
        console.log('[DIAG:tool-ui-registry] React HTML wrapped', {
          toolName,
          htmlLength: html?.length ?? 0,
          htmlHasDoctype: html?.startsWith('<!DOCTYPE'),
        });
      }
    } else {
      // For HTML templates: Use the original wrapToolUIUniversal approach
      // which embeds the pre-rendered content with the Bridge runtime

      // 1. Render the template
      const renderedContent = await renderToolTemplateAsync({
        template: uiConfig.template,
        input,
        output,
        structuredContent,
        mdxComponents: uiConfig.mdxComponents,
      });

      // Check for graceful degradation (production error case)
      if (renderedContent === null) {
        console.warn('[ToolUIRegistry] HTML template rendering returned null (graceful degradation)', {
          toolName,
          platformType,
        });
        return { success: false, reason: 'HTML template rendering failed' };
      }

      // 2. Wrap in a complete HTML document with FrontMCP Bridge runtime.
      // For OpenAI platform, we skip the CSP meta tag because OpenAI handles CSP
      // through `_meta['openai/widgetCSP']` in the MCP response, not HTML meta tags.
      const isOpenAIPlatform = platformType === 'openai';
      html = wrapToolUIUniversal({
        content: renderedContent,
        toolName,
        input: input as Record<string, unknown>,
        output,
        structuredContent,
        csp: uiConfig.csp,
        widgetAccessible: uiConfig.widgetAccessible,
        includeBridge: true,
        skipCspMeta: isOpenAIPlatform,
      });
    }

    // Get manifest info if available (from static widget compilation)
    const manifest = this.manifestCache.get(toolName);
    const buildResult = this.buildResultCache.get(toolName);

    // Determine renderer type
    const rendererType = manifest?.uiType ?? detectedType ?? 'auto';

    // Build platform-specific metadata
    // For inline mode, HTML is embedded in _meta['ui/html']
    const meta = buildUIMeta({
      uiConfig,
      platformType,
      html,
      token,
      directUrl,
      rendererType,
      contentHash: buildResult?.hash,
      manifestUri: manifest?.uri,
    });

    // [DIAG] Log final result for React tools
    if (toolName.includes('react')) {
      console.log('[DIAG:tool-ui-registry] Final result', {
        toolName,
        platformType,
        rendererType,
        htmlLength: html?.length ?? 0,
        metaKeys: Object.keys(meta),
        hasUiHtml: 'ui/html' in meta,
        uiHtmlLength: (meta['ui/html'] as string)?.length ?? 0,
      });
    }

    return { html, meta };
  }

  /**
   * Build component code string for embedding in widget HTML.
   *
   * @param template - The React component
   * @param toolName - Tool name for naming the component
   * @returns JavaScript code string that defines and registers the component
   */
  private buildComponentCode(template: unknown, toolName: string): string | undefined {
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
   * Check if a template requires async rendering (e.g., React components).
   *
   * @param template - The template to check
   * @returns true if the template requires async rendering
   */
  requiresAsyncRendering(template: UITemplateConfig['template']): boolean {
    return isReactComponent(template);
  }
}
