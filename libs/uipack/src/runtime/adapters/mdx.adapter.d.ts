/**
 * MDX Renderer Adapter
 *
 * Client-side adapter for rendering MDX (Markdown + JSX) content.
 * Builds on top of the React adapter for component rendering.
 *
 * @packageDocumentation
 */
import type { RendererAdapter, RenderContext, RenderOptions, RenderResult } from './types';
import type { UIType } from '../../types/ui-runtime';
/**
 * MDX Renderer Adapter.
 *
 * Renders MDX content to the DOM with support for:
 * - Pre-compiled MDX (recommended)
 * - Runtime MDX compilation (if mdx-js available)
 * - Custom component injection
 */
export declare class MdxRendererAdapter implements RendererAdapter {
  readonly type: UIType;
  private mdxRuntime;
  private loadPromise;
  /**
   * Check if this adapter can handle the given content.
   */
  canHandle(content: string | unknown): boolean;
  /**
   * Render MDX content to a string.
   */
  render(content: string, context: RenderContext, _options?: RenderOptions): Promise<string>;
  /**
   * Render MDX content directly to the DOM.
   */
  renderToDOM(
    content: string,
    target: HTMLElement,
    context: RenderContext,
    _options?: RenderOptions,
  ): Promise<RenderResult>;
  /**
   * Hydrate existing SSR content.
   * MDX hydration follows React patterns.
   */
  hydrate(target: HTMLElement, context: RenderContext, options?: RenderOptions): Promise<RenderResult>;
  /**
   * Update rendered MDX content with new data.
   */
  update(target: HTMLElement, context: RenderContext): Promise<RenderResult>;
  /**
   * Clean up (no-op for MDX adapter).
   */
  destroy(_target: HTMLElement): void;
  /**
   * Ensure MDX runtime is loaded.
   */
  private ensureMdxLoaded;
  /**
   * Load MDX runtime.
   */
  private loadMdx;
  /**
   * Compile MDX content.
   */
  private compileMdx;
  /**
   * Basic markdown rendering (fallback).
   */
  private renderMarkdown;
}
/**
 * Create a new MDX renderer adapter.
 */
export declare function createMdxAdapter(): MdxRendererAdapter;
/**
 * Adapter loader for lazy loading.
 */
export declare function loadMdxAdapter(): Promise<RendererAdapter>;
//# sourceMappingURL=mdx.adapter.d.ts.map
