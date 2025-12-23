/**
 * Renderer Adapter Types
 *
 * Defines the interface for renderer adapters that handle different
 * UI types (HTML, React, MDX) at runtime.
 *
 * @packageDocumentation
 */

import type { UIType } from '../../types/ui-runtime';

/**
 * Context passed to renderer adapters.
 */
export interface RenderContext {
  /** Tool input arguments */
  input: Record<string, unknown>;
  /** Tool output/result */
  output: unknown;
  /** Structured content (if schema provided) */
  structuredContent?: unknown;
  /** Tool name */
  toolName: string;
}

/**
 * Options for rendering.
 */
export interface RenderOptions {
  /** Target element to render into */
  target?: HTMLElement;
  /** Whether to hydrate existing SSR content */
  hydrate?: boolean;
  /** Manifest data from the page */
  manifest?: Record<string, unknown>;
}

/**
 * Result of a render operation.
 */
export interface RenderResult {
  /** Whether rendering was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** The rendered HTML (for SSR) */
  html?: string;
}

/**
 * Renderer adapter interface.
 *
 * Each adapter handles a specific UI type and provides methods
 * for rendering templates to the DOM.
 */
export interface RendererAdapter {
  /** The UI type this adapter handles */
  readonly type: UIType;

  /**
   * Check if this adapter can handle the given content.
   */
  canHandle(content: string | unknown): boolean;

  /**
   * Render content to an HTML string.
   * Used for SSR and initial page generation.
   */
  render(content: string, context: RenderContext, options?: RenderOptions): Promise<string>;

  /**
   * Render content directly to the DOM.
   * Used for client-side rendering.
   */
  renderToDOM?(
    content: string,
    target: HTMLElement,
    context: RenderContext,
    options?: RenderOptions,
  ): Promise<RenderResult>;

  /**
   * Hydrate existing SSR content with interactivity.
   * Used for React/MDX components that were server-rendered.
   */
  hydrate?(target: HTMLElement, context: RenderContext, options?: RenderOptions): Promise<RenderResult>;

  /**
   * Update the rendered content with new data.
   * Used when tool output changes at runtime.
   */
  update?(target: HTMLElement, context: RenderContext): Promise<RenderResult>;

  /**
   * Clean up any resources (event listeners, etc.).
   */
  destroy?(target: HTMLElement): void;
}

/**
 * Lazy loader function for adapters.
 */
export type AdapterLoader = () => Promise<RendererAdapter>;

/**
 * Adapter registry entry.
 */
export interface AdapterRegistryEntry {
  type: UIType;
  loader: AdapterLoader;
  instance?: RendererAdapter;
}
