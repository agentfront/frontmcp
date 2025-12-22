/**
 * Renderer Registry
 *
 * Global registry for template renderers with auto-detection.
 * Manages registration, detection, and rendering of templates.
 */
import type { TemplateContext } from '../runtime/types';
import type {
  UIRenderer,
  RendererType,
  RendererRegistryOptions,
  DetectionResult,
  RenderResult,
  RenderOptions,
} from './types';
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
export declare class RendererRegistry {
  private renderers;
  private sortedRenderers;
  private defaultRenderer;
  private debug;
  constructor(options?: RendererRegistryOptions);
  /**
   * Register a renderer.
   *
   * Renderers are sorted by priority (highest first) for detection.
   *
   * @param renderer - Renderer to register
   */
  register(renderer: UIRenderer): void;
  /**
   * Unregister a renderer.
   *
   * @param type - Type of renderer to remove
   * @returns True if renderer was removed
   */
  unregister(type: RendererType): boolean;
  /**
   * Get a renderer by type.
   *
   * @param type - Renderer type
   * @returns Renderer or undefined if not found
   */
  get(type: RendererType): UIRenderer | undefined;
  /**
   * Check if a renderer type is registered.
   *
   * @param type - Renderer type
   * @returns True if registered
   */
  has(type: RendererType): boolean;
  /**
   * Get all registered renderer types.
   *
   * @returns Array of renderer types
   */
  getTypes(): RendererType[];
  /**
   * Auto-detect the renderer for a template.
   *
   * Checks renderers in priority order (highest first).
   * Returns HTML renderer as fallback.
   *
   * @param template - Template to detect
   * @returns Detection result with renderer and confidence
   */
  detect(template: unknown): DetectionResult;
  /**
   * Render a template with auto-detection.
   *
   * @param template - Template to render (React, MDX, or HTML)
   * @param context - Template context with input/output
   * @param options - Render options
   * @returns Rendered result with HTML and metadata
   */
  render<In, Out>(template: unknown, context: TemplateContext<In, Out>, options?: RenderOptions): Promise<RenderResult>;
  /**
   * Render with a specific renderer type.
   *
   * @param type - Renderer type to use
   * @param template - Template to render
   * @param context - Template context
   * @param options - Render options
   * @returns Rendered result
   */
  renderWith<In, Out>(
    type: RendererType,
    template: unknown,
    context: TemplateContext<In, Out>,
    options?: RenderOptions,
  ): Promise<RenderResult>;
  /**
   * Update the sorted renderer list by priority.
   */
  private updateSortedList;
  /**
   * Set the default renderer type.
   *
   * @param type - Renderer type to use as default
   */
  setDefault(type: RendererType): void;
  /**
   * Get registry statistics.
   */
  getStats(): {
    registeredRenderers: RendererType[];
    defaultRenderer: RendererType;
    priorityOrder: Array<{
      type: RendererType;
      priority: number;
    }>;
  };
}
/**
 * Global renderer registry instance.
 *
 * Pre-configured with the HTML renderer.
 * React and MDX renderers can be added:
 *
 * ```typescript
 * import { rendererRegistry } from '@frontmcp/ui';
 * import { reactRenderer } from '@frontmcp/ui';
 * import { mdxRenderer } from '@frontmcp/ui';
 *
 * rendererRegistry.register(reactRenderer);
 * rendererRegistry.register(mdxRenderer);
 * ```
 */
export declare const rendererRegistry: RendererRegistry;
//# sourceMappingURL=registry.d.ts.map
