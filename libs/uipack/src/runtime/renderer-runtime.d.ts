/**
 * Renderer Runtime
 *
 * Client-side runtime that manages renderer adapters and handles
 * communication with the FrontMCP Bridge.
 *
 * @packageDocumentation
 */
import type { UIType, WidgetManifest } from '../types/ui-runtime';
import type { RenderContext, RenderResult } from './adapters/types';
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
export declare class RendererRuntime {
  private config;
  private adapters;
  private state;
  private updateCallbacks;
  private bridgeUnsubscribe;
  constructor(config?: RendererRuntimeConfig);
  /**
   * Initialize the runtime.
   * Reads manifest, sets up Bridge listeners, and prepares adapters.
   */
  init(): Promise<void>;
  /**
   * Get the current render context.
   */
  get context(): RenderContext;
  /**
   * Get the manifest.
   */
  get manifest(): Partial<WidgetManifest> | undefined;
  /**
   * Get the resolved UI type.
   */
  get uiType(): UIType;
  /**
   * Render content to a target element.
   *
   * @param target - Element to render into
   * @param content - Content to render (optional, uses existing innerHTML)
   * @param options - Render options
   */
  render(
    target: HTMLElement,
    content?: string,
    options?: {
      hydrate?: boolean;
    },
  ): Promise<RenderResult>;
  /**
   * Update the render context and re-render if needed.
   */
  updateContext(updates: Partial<RenderContext>): Promise<void>;
  /**
   * Subscribe to context updates.
   */
  onUpdate(callback: (context: RenderContext) => void): () => void;
  /**
   * Clean up resources.
   */
  destroy(): void;
  /**
   * Read manifest from page.
   */
  private readManifest;
  /**
   * Read initial data from page globals.
   */
  private readPageGlobals;
  /**
   * Set up Bridge event listeners.
   */
  private setupBridgeListeners;
  /**
   * Get or load an adapter for a UI type.
   */
  private getAdapter;
  /**
   * Auto-detect UI type from content.
   */
  private detectType;
  /**
   * Log message if debug enabled.
   */
  private log;
}
/**
 * Create and initialize a renderer runtime.
 */
export declare function createRendererRuntime(config?: RendererRuntimeConfig): Promise<RendererRuntime>;
/**
 * Bootstrap the renderer runtime from page manifest.
 * This is the main entry point for the IIFE bootstrap script.
 */
export declare function bootstrapRendererRuntime(): Promise<RendererRuntime | null>;
/**
 * Generate the bootstrap IIFE script for embedding in HTML.
 */
export declare function generateBootstrapScript(): string;
//# sourceMappingURL=renderer-runtime.d.ts.map
