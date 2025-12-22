/**
 * Renderer Runtime
 *
 * Client-side runtime that manages renderer adapters and handles
 * communication with the FrontMCP Bridge.
 *
 * @packageDocumentation
 */

import type { UIType, WidgetManifest } from '../types/ui-runtime';
import type { RendererAdapter, RenderContext, RenderResult } from './adapters/types';
import { loadAdapter } from './adapters';

/**
 * Runtime configuration.
 */
export interface RendererRuntimeConfig {
  /** The manifest embedded in the page */
  manifest?: Partial<WidgetManifest>;
  /** Initial tool input */
  input?: Record<string, unknown>;
  /** Initial tool output */
  output?: unknown;
  /** Initial structured content */
  structuredContent?: unknown;
  /** Tool name */
  toolName?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Runtime state.
 */
interface RuntimeState {
  initialized: boolean;
  currentAdapter: RendererAdapter | null;
  currentTarget: HTMLElement | null;
  context: RenderContext;
}

/**
 * Renderer Runtime.
 *
 * Client-side runtime that:
 * - Reads manifest from the page
 * - Lazy-loads the appropriate renderer adapter
 * - Handles tool output updates from the Bridge
 * - Re-renders when data changes
 *
 * @example
 * ```typescript
 * // Bootstrap from manifest in page
 * const runtime = new RendererRuntime();
 * await runtime.init();
 *
 * // Listen for updates
 * runtime.onUpdate((context) => {
 *   console.log('Tool output updated:', context.output);
 * });
 * ```
 */
export class RendererRuntime {
  private config: RendererRuntimeConfig;
  private adapters = new Map<UIType, RendererAdapter>();
  private state: RuntimeState;
  private updateCallbacks: Array<(context: RenderContext) => void> = [];
  private bridgeUnsubscribe: (() => void) | null = null;

  constructor(config: RendererRuntimeConfig = {}) {
    this.config = config;
    this.state = {
      initialized: false,
      currentAdapter: null,
      currentTarget: null,
      context: {
        input: config.input ?? {},
        output: config.output,
        structuredContent: config.structuredContent,
        toolName: config.toolName ?? 'unknown',
      },
    };
  }

  /**
   * Initialize the runtime.
   * Reads manifest, sets up Bridge listeners, and prepares adapters.
   */
  async init(): Promise<void> {
    if (this.state.initialized) {
      return;
    }

    this.log('Initializing RendererRuntime');

    // Read manifest from page
    this.readManifest();

    // Read initial data from page globals
    this.readPageGlobals();

    // Set up Bridge listeners
    this.setupBridgeListeners();

    this.state.initialized = true;
    this.log('RendererRuntime initialized', this.config.manifest);
  }

  /**
   * Get the current render context.
   */
  get context(): RenderContext {
    return { ...this.state.context };
  }

  /**
   * Get the manifest.
   */
  get manifest(): Partial<WidgetManifest> | undefined {
    return this.config.manifest;
  }

  /**
   * Get the resolved UI type.
   */
  get uiType(): UIType {
    return this.config.manifest?.uiType ?? 'auto';
  }

  /**
   * Render content to a target element.
   *
   * @param target - Element to render into
   * @param content - Content to render (optional, uses existing innerHTML)
   * @param options - Render options
   */
  async render(target: HTMLElement, content?: string, options?: { hydrate?: boolean }): Promise<RenderResult> {
    const type = this.uiType;
    const contentToRender = content ?? target.innerHTML;

    this.log('Rendering', { type, hasContent: !!content, hydrate: options?.hydrate });

    // Get or load adapter
    const adapter = await this.getAdapter(type, contentToRender);

    if (!adapter) {
      return {
        success: false,
        error: `No adapter available for UI type: ${type}`,
      };
    }

    this.state.currentAdapter = adapter;
    this.state.currentTarget = target;

    // Hydrate or render
    if (options?.hydrate && adapter.hydrate) {
      return adapter.hydrate(target, this.state.context);
    }

    if (adapter.renderToDOM) {
      return adapter.renderToDOM(contentToRender, target, this.state.context);
    }

    // Fallback to string render + innerHTML
    const html = await adapter.render(contentToRender, this.state.context);
    target.innerHTML = html;
    return { success: true, html };
  }

  /**
   * Update the render context and re-render if needed.
   */
  async updateContext(updates: Partial<RenderContext>): Promise<void> {
    this.state.context = {
      ...this.state.context,
      ...updates,
    };

    this.log('Context updated', updates);

    // Notify callbacks
    for (const callback of this.updateCallbacks) {
      try {
        callback(this.state.context);
      } catch (error) {
        console.error('[FrontMCP] Update callback error:', error);
      }
    }

    // Re-render if we have a current target
    if (this.state.currentTarget && this.state.currentAdapter) {
      if (this.state.currentAdapter.update) {
        await this.state.currentAdapter.update(this.state.currentTarget, this.state.context);
      }
    }
  }

  /**
   * Subscribe to context updates.
   */
  onUpdate(callback: (context: RenderContext) => void): () => void {
    this.updateCallbacks.push(callback);
    return () => {
      const index = this.updateCallbacks.indexOf(callback);
      if (index > -1) {
        this.updateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    // Unsubscribe from Bridge
    if (this.bridgeUnsubscribe) {
      this.bridgeUnsubscribe();
      this.bridgeUnsubscribe = null;
    }

    // Destroy current adapter
    if (this.state.currentAdapter && this.state.currentTarget) {
      this.state.currentAdapter.destroy?.(this.state.currentTarget);
    }

    // Clear state
    this.state.initialized = false;
    this.state.currentAdapter = null;
    this.state.currentTarget = null;
    this.updateCallbacks = [];
  }

  /**
   * Read manifest from page.
   */
  private readManifest(): void {
    // Check for manifest in script tag
    const manifestEl = document.getElementById('frontmcp-widget-manifest');
    if (manifestEl) {
      try {
        const manifest = JSON.parse(manifestEl.textContent ?? '{}');
        this.config.manifest = manifest;
        this.log('Loaded manifest from page', manifest);
        return;
      } catch {
        console.warn('[FrontMCP] Failed to parse manifest from page');
      }
    }

    // Check for __mcp_manifest script tag (legacy)
    const legacyManifestEl = document.getElementById('__mcp_manifest');
    if (legacyManifestEl) {
      try {
        const manifest = JSON.parse(legacyManifestEl.textContent ?? '{}');
        this.config.manifest = manifest;
        return;
      } catch {
        console.warn('[FrontMCP] Failed to parse legacy manifest from page');
      }
    }

    // Check window global
    const win = window as unknown as { __frontmcp?: { widget?: { manifest?: Partial<WidgetManifest> } } };
    if (win.__frontmcp?.widget?.manifest) {
      this.config.manifest = win.__frontmcp.widget.manifest;
    }
  }

  /**
   * Read initial data from page globals.
   */
  private readPageGlobals(): void {
    const win = window as Window & {
      __mcpToolName?: string;
      __mcpToolInput?: Record<string, unknown>;
      __mcpToolOutput?: unknown;
      __mcpStructuredContent?: unknown;
      openai?: {
        toolInput?: Record<string, unknown>;
        toolOutput?: unknown;
      };
    };

    // Tool name
    if (win.__mcpToolName) {
      this.state.context.toolName = win.__mcpToolName;
    } else if (this.config.manifest?.tool) {
      this.state.context.toolName = this.config.manifest.tool;
    }

    // Input
    if (win.__mcpToolInput) {
      this.state.context.input = win.__mcpToolInput;
    } else if (win.openai?.toolInput) {
      this.state.context.input = win.openai.toolInput;
    }

    // Output
    if (win.__mcpToolOutput !== undefined) {
      this.state.context.output = win.__mcpToolOutput;
    } else if (win.openai?.toolOutput !== undefined) {
      this.state.context.output = win.openai.toolOutput;
    }

    // Structured content
    if (win.__mcpStructuredContent !== undefined) {
      this.state.context.structuredContent = win.__mcpStructuredContent;
    }
  }

  /**
   * Set up Bridge event listeners.
   */
  private setupBridgeListeners(): void {
    const win = window as Window & {
      mcpBridge?: {
        onToolResult?: (callback: (result: unknown) => void) => () => void;
      };
    };

    // Listen for tool result updates via Bridge
    if (win.mcpBridge?.onToolResult) {
      this.bridgeUnsubscribe = win.mcpBridge.onToolResult((result) => {
        this.updateContext({ output: result });
      });
    }

    // Also listen for custom events
    window.addEventListener('frontmcp:toolOutput', ((event: CustomEvent) => {
      this.updateContext({ output: event.detail });
    }) as EventListener);
  }

  /**
   * Get or load an adapter for a UI type.
   */
  private async getAdapter(type: UIType, content?: string): Promise<RendererAdapter | null> {
    // Check cache
    if (this.adapters.has(type)) {
      return this.adapters.get(type)!;
    }

    // Auto-detect type from content
    let resolvedType = type;
    if (type === 'auto' && content) {
      resolvedType = this.detectType(content);
      this.log('Auto-detected type:', resolvedType);
    }

    // Check cache again with resolved type
    if (this.adapters.has(resolvedType)) {
      return this.adapters.get(resolvedType)!;
    }

    // Load adapter
    const adapter = await loadAdapter(resolvedType);
    if (adapter) {
      this.adapters.set(resolvedType, adapter);
      if (resolvedType !== type) {
        this.adapters.set(type, adapter); // Cache under original type too
      }
    }

    return adapter;
  }

  /**
   * Auto-detect UI type from content.
   */
  private detectType(content: string): UIType {
    // Check for React patterns
    if (
      content.includes('React.createElement') ||
      content.includes('jsx(') ||
      /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*return\s*[\s\S]*</.test(content)
    ) {
      return 'react';
    }

    // Check for MDX patterns
    if (
      /^---[\s\S]*?---/.test(content) ||
      /<[A-Z][a-zA-Z0-9]*[\s/>]/.test(content) ||
      /^import\s+/m.test(content) ||
      /^export\s+/m.test(content)
    ) {
      return 'mdx';
    }

    // Default to HTML
    return 'html';
  }

  /**
   * Log message if debug enabled.
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.config.debug) {
      console.log(`[FrontMCP Runtime] ${message}`, ...args);
    }
  }
}

/**
 * Create and initialize a renderer runtime.
 */
export async function createRendererRuntime(config?: RendererRuntimeConfig): Promise<RendererRuntime> {
  const runtime = new RendererRuntime(config);
  await runtime.init();
  return runtime;
}

/**
 * Bootstrap the renderer runtime from page manifest.
 * This is the main entry point for the IIFE bootstrap script.
 */
export async function bootstrapRendererRuntime(): Promise<RendererRuntime | null> {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      document.addEventListener('DOMContentLoaded', () => resolve());
    });
  }

  try {
    const runtime = await createRendererRuntime({ debug: false });

    // Find and render the main content element
    const contentEl =
      document.querySelector('[data-frontmcp-widget]') ||
      document.querySelector('[data-mcp-widget]') ||
      document.body.firstElementChild;

    if (contentEl instanceof HTMLElement) {
      await runtime.render(contentEl, undefined, { hydrate: true });
    }

    // Expose runtime globally
    const win = window as unknown as {
      __frontmcp?: { runtime?: RendererRuntime };
    };
    win.__frontmcp = win.__frontmcp ?? {};
    win.__frontmcp.runtime = runtime;

    return runtime;
  } catch (error) {
    console.error('[FrontMCP] Failed to bootstrap renderer runtime:', error);
    return null;
  }
}

/**
 * Generate the bootstrap IIFE script for embedding in HTML.
 */
export function generateBootstrapScript(): string {
  return `
<script>
(function() {
  'use strict';

  // Wait for runtime to load
  function bootstrap() {
    if (window.__frontmcp && window.__frontmcp.bootstrapRuntime) {
      window.__frontmcp.bootstrapRuntime();
    } else {
      // Retry after short delay
      setTimeout(bootstrap, 50);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
</script>
`.trim();
}
