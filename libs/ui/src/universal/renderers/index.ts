/**
 * Renderer Registry
 *
 * Central registry for client-side renderers with auto-detection.
 * Manages registration and selection of renderers based on content type.
 */

import type { ClientRenderer, UniversalContent, RenderContext, ContentType } from '../types';
import { detectContentType } from '../types';
import { htmlRenderer, safeHtmlRenderer } from './html.renderer';
import { markdownRenderer, createMarkdownRenderer } from './markdown.renderer';
import { reactRenderer, isReactComponent } from './react.renderer';
import { mdxRenderer, isMdxSupported, createMdxRenderer } from './mdx.renderer';

// ============================================
// Registry Class
// ============================================

/**
 * Client-side renderer registry.
 *
 * Manages renderers and provides auto-detection based on content type.
 *
 * @example
 * ```typescript
 * const registry = new RendererRegistry();
 *
 * // Auto-detect and get renderer
 * const renderer = registry.detect({ type: 'markdown', source: '# Hello' });
 *
 * // Register custom renderer
 * registry.register(myCustomRenderer);
 * ```
 */
export class RendererRegistry {
  private renderers = new Map<ContentType, ClientRenderer>();
  private sortedRenderers: ClientRenderer[] = [];

  constructor() {
    // Register default renderers
    this.register(htmlRenderer);
    this.register(markdownRenderer);
    this.register(reactRenderer);
    this.register(mdxRenderer);
  }

  /**
   * Register a renderer.
   * Renderers are sorted by priority (highest first) for auto-detection.
   */
  register(renderer: ClientRenderer): void {
    this.renderers.set(renderer.type, renderer);
    this.updateSortedList();
  }

  /**
   * Unregister a renderer by type.
   */
  unregister(type: ContentType): boolean {
    const removed = this.renderers.delete(type);
    if (removed) {
      this.updateSortedList();
    }
    return removed;
  }

  /**
   * Get a renderer by type.
   */
  get(type: ContentType): ClientRenderer | undefined {
    return this.renderers.get(type);
  }

  /**
   * Check if a renderer type is registered.
   */
  has(type: ContentType): boolean {
    return this.renderers.has(type);
  }

  /**
   * Get all registered renderer types.
   */
  getTypes(): ContentType[] {
    return Array.from(this.renderers.keys());
  }

  /**
   * Auto-detect the best renderer for content.
   *
   * Checks renderers in priority order (highest first).
   * Falls back to HTML renderer if no match.
   */
  detect(content: UniversalContent): ClientRenderer {
    // If type is explicitly set, use that renderer
    if (content.type) {
      const explicit = this.renderers.get(content.type);
      if (explicit) {
        return explicit;
      }
    }

    // Auto-detect by checking each renderer
    for (const renderer of this.sortedRenderers) {
      if (renderer.canHandle(content)) {
        return renderer;
      }
    }

    // Fallback to HTML
    return htmlRenderer;
  }

  /**
   * Render content using auto-detection.
   */
  render(content: UniversalContent, context: RenderContext): React.ReactNode {
    const renderer = this.detect(content);
    return renderer.render(content, context);
  }

  /**
   * Render with a specific renderer type.
   */
  renderWith(type: ContentType, content: UniversalContent, context: RenderContext): React.ReactNode {
    const renderer = this.renderers.get(type);
    if (!renderer) {
      throw new Error(`Renderer '${type}' not registered`);
    }
    return renderer.render(content, context);
  }

  /**
   * Get registry statistics.
   */
  getStats(): {
    registeredTypes: ContentType[];
    priorityOrder: Array<{ type: ContentType; priority: number }>;
  } {
    return {
      registeredTypes: this.getTypes(),
      priorityOrder: this.sortedRenderers.map((r) => ({
        type: r.type,
        priority: r.priority,
      })),
    };
  }

  /**
   * Update the sorted renderer list by priority.
   */
  private updateSortedList(): void {
    this.sortedRenderers = Array.from(this.renderers.values()).sort((a, b) => b.priority - a.priority);
  }
}

// ============================================
// Global Registry Instance
// ============================================

/**
 * Global renderer registry instance.
 *
 * Pre-configured with HTML, Markdown, React, and MDX renderers.
 */
export const rendererRegistry = new RendererRegistry();

// ============================================
// Utility Functions
// ============================================

/**
 * Detect the best renderer for content.
 *
 * @param content - Content to analyze
 * @returns Best matching renderer
 */
export function detectRenderer(content: UniversalContent): ClientRenderer {
  return rendererRegistry.detect(content);
}

/**
 * Render content with auto-detection.
 *
 * @param content - Content to render
 * @param context - Render context
 * @returns Rendered React node
 */
export function renderContent(content: UniversalContent, context: RenderContext): React.ReactNode {
  return rendererRegistry.render(content, context);
}

/**
 * Create content object from source with auto-detected type.
 *
 * @param source - Content source (string or component)
 * @param options - Additional options
 * @returns Content object
 */
export function createContent(
  source: UniversalContent['source'],
  options?: Partial<Omit<UniversalContent, 'source'>>,
): UniversalContent {
  return {
    type: options?.type ?? detectContentType(source),
    source,
    props: options?.props,
    components: options?.components,
  };
}

// ============================================
// Re-exports
// ============================================

// Renderers
export { htmlRenderer, safeHtmlRenderer } from './html.renderer';
export { markdownRenderer, createMarkdownRenderer } from './markdown.renderer';
export { reactRenderer, isReactComponent } from './react.renderer';
export { mdxRenderer, isMdxSupported, createMdxRenderer } from './mdx.renderer';
