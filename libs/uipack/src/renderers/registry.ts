/**
 * Renderer Registry
 *
 * Global registry for template renderers with auto-detection.
 * Manages registration, detection, and rendering of templates.
 */

import type { TemplateContext } from '../runtime/types';
import { OPENAI_PLATFORM } from '../theme';
import type {
  UIRenderer,
  RendererType,
  RendererRegistryOptions,
  DetectionResult,
  RenderResult,
  RenderOptions,
} from './types';
import { htmlRenderer } from './html.renderer';

/**
 * Renderer Registry.
 *
 * Manages a collection of renderers and provides:
 * - Registration of custom renderers
 * - Auto-detection of template types
 * - Unified rendering interface
 *
 * @example
 * ```typescript
 * // Register a custom renderer
 * registry.register(myCustomRenderer);
 *
 * // Auto-detect and render
 * const result = await registry.render(template, context);
 * ```
 */
export class RendererRegistry {
  private renderers = new Map<RendererType, UIRenderer>();
  private sortedRenderers: UIRenderer[] = [];
  private defaultRenderer: RendererType = 'html';
  private debug: boolean;

  constructor(options: RendererRegistryOptions = {}) {
    this.debug = options.debug ?? false;

    // Register built-in HTML renderer
    this.register(htmlRenderer);
  }

  /**
   * Register a renderer.
   *
   * Renderers are sorted by priority (highest first) for detection.
   *
   * @param renderer - Renderer to register
   */
  register(renderer: UIRenderer): void {
    this.renderers.set(renderer.type, renderer);
    this.updateSortedList();

    if (this.debug) {
      console.log(`[RendererRegistry] Registered renderer: ${renderer.type} (priority: ${renderer.priority})`);
    }
  }

  /**
   * Unregister a renderer.
   *
   * @param type - Type of renderer to remove
   * @returns True if renderer was removed
   */
  unregister(type: RendererType): boolean {
    const removed = this.renderers.delete(type);
    if (removed) {
      this.updateSortedList();
    }
    return removed;
  }

  /**
   * Get a renderer by type.
   *
   * @param type - Renderer type
   * @returns Renderer or undefined if not found
   */
  get(type: RendererType): UIRenderer | undefined {
    return this.renderers.get(type);
  }

  /**
   * Check if a renderer type is registered.
   *
   * @param type - Renderer type
   * @returns True if registered
   */
  has(type: RendererType): boolean {
    return this.renderers.has(type);
  }

  /**
   * Get all registered renderer types.
   *
   * @returns Array of renderer types
   */
  getTypes(): RendererType[] {
    return Array.from(this.renderers.keys());
  }

  /**
   * Auto-detect the renderer for a template.
   *
   * Checks renderers in priority order (highest first).
   * Returns HTML renderer as fallback.
   *
   * @param template - Template to detect
   * @returns Detection result with renderer and confidence
   */
  detect(template: unknown): DetectionResult {
    // Check each renderer in priority order
    for (const renderer of this.sortedRenderers) {
      if (renderer.canHandle(template)) {
        const result: DetectionResult = {
          renderer,
          confidence: renderer.priority / 100, // Normalize to 0-1
          reason: `Matched by ${renderer.type} renderer`,
        };

        if (this.debug) {
          console.log(`[RendererRegistry] Detected template as ${renderer.type} (confidence: ${result.confidence})`);
        }

        return result;
      }
    }

    // Fallback to HTML renderer (should always match strings/functions)
    const fallback = this.renderers.get(this.defaultRenderer);
    if (!fallback) {
      throw new Error(`Default renderer '${this.defaultRenderer}' not found`);
    }

    return {
      renderer: fallback,
      confidence: 0.5,
      reason: 'Fallback to default HTML renderer',
    };
  }

  /**
   * Render a template with auto-detection.
   *
   * @param template - Template to render (React, MDX, or HTML)
   * @param context - Template context with input/output
   * @param options - Render options
   * @returns Rendered result with HTML and metadata
   */
  async render<In, Out>(
    template: unknown,
    context: TemplateContext<In, Out>,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    const platform = options.platform ?? OPENAI_PLATFORM;

    // Detect renderer
    const detection = this.detect(template);
    const renderer = detection.renderer;

    if (this.debug) {
      console.log(`[RendererRegistry] Rendering with ${renderer.type} renderer`);
    }

    // Transpile if needed
    const transpileResult = await renderer.transpile(template);

    // Render to HTML
    const html = await renderer.render(template, context, options);

    // Get runtime scripts
    const runtimeScripts = renderer.getRuntimeScripts(platform);

    return {
      html,
      rendererType: renderer.type,
      transpileCached: transpileResult.cached,
      runtimeScripts,
    };
  }

  /**
   * Render with a specific renderer type.
   *
   * @param type - Renderer type to use
   * @param template - Template to render
   * @param context - Template context
   * @param options - Render options
   * @returns Rendered result
   */
  async renderWith<In, Out>(
    type: RendererType,
    template: unknown,
    context: TemplateContext<In, Out>,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    const renderer = this.renderers.get(type);
    if (!renderer) {
      throw new Error(`Renderer '${type}' not registered`);
    }

    const platform = options.platform ?? OPENAI_PLATFORM;

    // Transpile
    const transpileResult = await renderer.transpile(template);

    // Render
    const html = await renderer.render(template, context, options);

    // Runtime scripts
    const runtimeScripts = renderer.getRuntimeScripts(platform);

    return {
      html,
      rendererType: type,
      transpileCached: transpileResult.cached,
      runtimeScripts,
    };
  }

  /**
   * Update the sorted renderer list by priority.
   */
  private updateSortedList(): void {
    this.sortedRenderers = Array.from(this.renderers.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Set the default renderer type.
   *
   * @param type - Renderer type to use as default
   */
  setDefault(type: RendererType): void {
    if (!this.renderers.has(type)) {
      throw new Error(`Cannot set default to unregistered renderer '${type}'`);
    }
    this.defaultRenderer = type;
  }

  /**
   * Get registry statistics.
   */
  getStats(): {
    registeredRenderers: RendererType[];
    defaultRenderer: RendererType;
    priorityOrder: Array<{ type: RendererType; priority: number }>;
  } {
    return {
      registeredRenderers: this.getTypes(),
      defaultRenderer: this.defaultRenderer,
      priorityOrder: this.sortedRenderers.map((r) => ({
        type: r.type,
        priority: r.priority,
      })),
    };
  }
}

/**
 * Global renderer registry instance.
 *
 * Pre-configured with the HTML renderer.
 * React and MDX renderers can be added:
 *
 * ```typescript
 * import { rendererRegistry, mdxClientRenderer } from '@frontmcp/uipack/renderers';
 * import { reactRenderer } from '@frontmcp/ui';
 *
 * rendererRegistry.register(reactRenderer);
 * rendererRegistry.register(mdxClientRenderer);
 * ```
 */
export const rendererRegistry = new RendererRegistry();
