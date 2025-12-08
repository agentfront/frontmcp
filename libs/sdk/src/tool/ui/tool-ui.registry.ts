/**
 * Tool UI Registry
 *
 * Manages UI template rendering and caching for tool responses.
 * Provides platform-specific metadata generation for MCP clients.
 */

import type { ToolUIConfig } from '../../common/metadata/tool-ui.metadata';
import type { AIPlatformType } from '../../notification/notification.service';
import { renderToolTemplate, renderToolTemplateAsync, isReactComponent } from './render-template';
import { buildUIMeta, type UIMetadata } from './platform-adapters';
import { wrapToolUIUniversal } from '@frontmcp/ui/runtime';

/**
 * Default TTL for cached UI entries (5 minutes).
 */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Maximum number of cached entries before cleanup.
 */
const MAX_CACHE_SIZE = 1000;

/**
 * Cached UI entry.
 */
export interface CachedUI {
  /** Rendered HTML content */
  html: string;
  /** Original context for potential re-rendering */
  context: {
    toolName: string;
    input: Record<string, unknown>;
    output: unknown;
    structuredContent?: unknown;
  };
  /** Expiration timestamp */
  expiresAt: number;
  /** Creation timestamp for ordering */
  createdAt: number;
}

/**
 * Options for renderAndRegister.
 */
export interface RenderAndRegisterOptions {
  /** Tool name (used for URI generation) */
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
  /** Cache TTL in milliseconds (default: 5 minutes) */
  cacheTtl?: number;
}

/**
 * Result of UI registration.
 */
export interface UIRegistrationResult {
  /** Generated resource URI */
  uri: string;
  /** Rendered HTML content */
  html: string;
  /** Platform-specific metadata for _meta field */
  meta: UIMetadata;
}

/**
 * ToolUIRegistry manages UI template rendering and caching.
 *
 * It provides:
 * - Template rendering with context
 * - TTL-based caching for rendered HTML
 * - Platform-specific _meta generation
 * - Resource URI generation for ui:// protocol
 *
 * @example
 * ```typescript
 * const registry = new ToolUIRegistry();
 *
 * const result = registry.renderAndRegister({
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
export class ToolUIRegistry {
  private readonly cache = new Map<string, CachedUI>();
  private readonly defaultTtl: number;

  constructor(options?: { defaultTtl?: number }) {
    this.defaultTtl = options?.defaultTtl ?? DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Render a tool's UI template and register it for resource access.
   *
   * NOTE: This synchronous version does NOT support React components.
   * Use `renderAndRegisterAsync()` for React component templates.
   *
   * @param options - Rendering options
   * @returns Registration result with URI, HTML, and metadata
   */
  renderAndRegister(options: RenderAndRegisterOptions): UIRegistrationResult {
    const {
      toolName,
      requestId,
      input,
      output,
      structuredContent,
      uiConfig,
      platformType,
      token,
      directUrl,
      cacheTtl = this.defaultTtl,
    } = options;

    // 1. Render the template
    const html = renderToolTemplate({
      template: uiConfig.template,
      input,
      output,
      structuredContent,
    });

    // 2. Generate unique resource URI
    const uri = this.generateResourceUri(toolName, requestId);

    // 3. Cache the rendered HTML
    const now = Date.now();
    this.cacheEntry(uri, {
      html,
      context: { toolName, input, output, structuredContent },
      expiresAt: now + cacheTtl,
      createdAt: now,
    });

    // 4. Build platform-specific metadata
    const meta = buildUIMeta({
      uiConfig,
      platformType,
      resourceUri: uri,
      html,
      token,
      directUrl,
    });

    return { uri, html, meta };
  }

  /**
   * Render a tool's UI template and register it for resource access (async version).
   *
   * This version supports all template types including React components via SSR.
   * Use this method when the template may be a React component.
   *
   * For React/MDX components, the output is wrapped in a complete HTML document
   * with the FrontMCP Bridge runtime, enabling interactive features like button
   * clicks (via `data-tool-call` attribute) when loaded in OpenAI's iframe.
   *
   * @param options - Rendering options
   * @returns Promise resolving to registration result with URI, HTML, and metadata
   */
  async renderAndRegisterAsync(options: RenderAndRegisterOptions): Promise<UIRegistrationResult> {
    const {
      toolName,
      requestId,
      input,
      output,
      structuredContent,
      uiConfig,
      platformType,
      token,
      directUrl,
      cacheTtl = this.defaultTtl,
    } = options;

    // 1. Render the template (async for React/MDX support)
    const renderedContent = await renderToolTemplateAsync({
      template: uiConfig.template,
      input,
      output,
      structuredContent,
      mdxComponents: uiConfig.mdxComponents,
    });

    // 2. Wrap in a complete HTML document with FrontMCP Bridge runtime.
    // This is essential for React/MDX components to have working click handlers
    // (via `data-tool-call` attribute) when loaded in OpenAI's iframe.
    //
    // For OpenAI platform, we skip the CSP meta tag because OpenAI handles CSP
    // through `_meta['openai/widgetCSP']` in the MCP response, not HTML meta tags.
    // Including a CSP meta tag causes browser warnings when it's placed outside <head>
    // due to OpenAI's iframe HTML processing.
    const isOpenAIPlatform = platformType === 'openai';
    const html = wrapToolUIUniversal({
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

    // 3. Generate unique resource URI
    const uri = this.generateResourceUri(toolName, requestId);

    // 4. Cache the rendered HTML
    const now = Date.now();
    this.cacheEntry(uri, {
      html,
      context: { toolName, input, output, structuredContent },
      expiresAt: now + cacheTtl,
      createdAt: now,
    });

    // 5. Build platform-specific metadata
    const meta = buildUIMeta({
      uiConfig,
      platformType,
      resourceUri: uri,
      html,
      token,
      directUrl,
    });

    return { uri, html, meta };
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

  /**
   * Get rendered HTML for a resource URI.
   *
   * @param uri - The resource URI
   * @returns Rendered HTML, or undefined if not found or expired
   */
  getRenderedHtml(uri: string): string | undefined {
    const entry = this.cache.get(uri);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt < Date.now()) {
      this.cache.delete(uri);
      return undefined;
    }

    return entry.html;
  }

  /**
   * Get the full cached entry for a resource URI.
   *
   * @param uri - The resource URI
   * @returns Cached entry, or undefined if not found or expired
   */
  getCachedEntry(uri: string): CachedUI | undefined {
    const entry = this.cache.get(uri);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt < Date.now()) {
      this.cache.delete(uri);
      return undefined;
    }

    return entry;
  }

  /**
   * Check if a URI is registered and valid.
   *
   * @param uri - The resource URI to check
   * @returns true if the URI is registered and not expired
   */
  has(uri: string): boolean {
    return this.getRenderedHtml(uri) !== undefined;
  }

  /**
   * Get the latest (most recent) cached entry for a tool by name.
   * Useful for static widget URIs where requestId is not known.
   *
   * @param toolName - The tool name to look up
   * @returns The most recent cached entry for this tool, or undefined
   */
  getLatestForTool(toolName: string): CachedUI | undefined {
    const now = Date.now();
    let latestEntry: CachedUI | undefined;
    let latestCreatedAt = 0;

    // Find the most recent non-expired entry for this tool
    for (const [, entry] of this.cache) {
      if (entry.context.toolName === toolName && entry.expiresAt > now) {
        // Keep the entry with the latest creation time (most recently created)
        if (entry.createdAt > latestCreatedAt) {
          latestCreatedAt = entry.createdAt;
          latestEntry = entry;
        }
      }
    }

    return latestEntry;
  }

  /**
   * Remove a specific URI from the cache.
   *
   * @param uri - The resource URI to remove
   * @returns true if the URI was found and removed
   */
  remove(uri: string): boolean {
    return this.cache.delete(uri);
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached entries (including expired).
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Clean up expired entries.
   *
   * @returns Number of entries removed
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [uri, entry] of this.cache) {
      if (entry.expiresAt < now) {
        this.cache.delete(uri);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Generate a resource URI for a tool result.
   *
   * @param toolName - The tool name
   * @param requestId - The unique request ID
   * @returns Resource URI in ui:// protocol format
   */
  private generateResourceUri(toolName: string, requestId: string): string {
    return `ui://tools/${encodeURIComponent(toolName)}/result/${encodeURIComponent(requestId)}`;
  }

  /**
   * Cache an entry, enforcing size limits.
   */
  private cacheEntry(uri: string, entry: CachedUI): void {
    // Enforce size limit with LRU-style eviction
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // First, try to remove expired entries
      const removed = this.cleanup();

      // If still at limit after cleanup, remove oldest entries
      if (this.cache.size >= MAX_CACHE_SIZE && removed === 0) {
        // Remove ~10% of entries (oldest first by insertion order)
        const toRemove = Math.ceil(MAX_CACHE_SIZE * 0.1);
        const keys = [...this.cache.keys()].slice(0, toRemove);
        for (const key of keys) {
          this.cache.delete(key);
        }
      }
    }

    this.cache.set(uri, entry);
  }
}
