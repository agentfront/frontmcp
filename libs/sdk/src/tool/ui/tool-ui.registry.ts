/**
 * Tool UI Registry
 *
 * Manages UI template rendering for tool responses.
 * Provides platform-specific metadata generation for MCP clients.
 *
 * Two serving modes:
 * - **inline**: HTML is rendered per-request and embedded in _meta['ui/html']
 * - **mcp-resource**: Static widget is pre-compiled at startup, client fetches via resources/read
 */

import type { ToolUIConfig, WidgetManifest, BuildManifestResult } from '../../common/metadata/tool-ui.metadata';
import type { AIPlatformType } from '../../notification/notification.service';
import { renderToolTemplateAsync, isReactComponent } from './render-template';
import { buildUIMeta, type UIMetadata } from './platform-adapters';
import { wrapToolUIUniversal, wrapStaticWidgetUniversal, wrapLeanWidgetShell } from '@frontmcp/ui/runtime';
import { buildToolWidgetManifest, detectUIType } from '@frontmcp/ui/build';

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
  uiConfig: ToolUIConfig;
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
 * ToolUIRegistry manages UI template rendering for tool responses.
 *
 * It provides:
 * - Static widget compilation for mcp-resource mode (pre-compiled at startup)
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
  template: ToolUIConfig['template'];
  /** Tool UI configuration */
  uiConfig: ToolUIConfig;
}

export class ToolUIRegistry {
  /**
   * Cache for static widgets (keyed by tool name).
   * Static widgets are pre-compiled at server startup for tools with servingMode: 'mcp-resource'.
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
   * For tools with `servingMode: 'mcp-resource'`, the widget HTML is pre-compiled
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
      const extendedConfig = uiConfig as ToolUIConfig & {
        uiType?: string;
        bundlingMode?: string;
        resourceMode?: 'cdn' | 'inline';
        runtimeOptions?: { hydrate?: boolean };
      };
      const detectedType = detectUIType(template as Parameters<typeof detectUIType>[0]);

      // Convert ToolUIConfig to WidgetConfig format for the manifest builder
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
  compileLeanWidgetAsync(options: { toolName: string; uiConfig: ToolUIConfig }): void {
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
  detectUIType(template: ToolUIConfig['template']): string {
    // Use the imported detectUIType function from @frontmcp/ui/build
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
   * mcp-resource mode, but with data embedded in each response.
   *
   * @param options - Rendering options
   * @returns Promise resolving to render result with HTML and metadata
   */
  async renderAndRegisterAsync(options: RenderOptions): Promise<UIRenderResult> {
    const { toolName, input, output, structuredContent, uiConfig, platformType, token, directUrl } = options;

    // Detect if this is a React component
    const detectedType = this.detectUIType(uiConfig.template);
    const isReactBased = detectedType === 'react' || detectedType === 'mdx';

    let html: string;

    if (isReactBased && typeof uiConfig.template === 'function') {
      // For React/MDX components: Use wrapStaticWidgetUniversal with component code
      // This includes the React 19 CDN, client-side renderer, and all FrontMCP hooks
      // Same approach as mcp-resource mode, but with data embedded

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
  requiresAsyncRendering(template: ToolUIConfig['template']): boolean {
    return isReactComponent(template);
  }
}
