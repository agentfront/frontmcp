/**
 * React Renderer Module
 *
 * Provides the React renderer for template processing.
 * Other renderers (HTML, MDX) and utilities are available in @frontmcp/uipack.
 *
 * @module @frontmcp/ui/renderers
 *
 * @example
 * ```typescript
 * import { reactRenderer, ReactRenderer } from '@frontmcp/ui/renderers';
 * import { rendererRegistry } from '@frontmcp/uipack/renderers';
 *
 * // Register React renderer
 * rendererRegistry.register(reactRenderer);
 * ```
 */

// Re-export types from @frontmcp/uipack for convenience
export type {
  RendererType,
  UIRenderer,
  ToolUIProps,
  HydratedToolUIProps,
  TranspileResult,
  TranspileOptions,
  RenderOptions,
  RuntimeScripts,
  RenderResult,
  RendererRegistryOptions,
  DetectionResult,
  ReactComponentType,
  WrapperContext,
  ExtendedToolUIConfig,
} from '@frontmcp/uipack/renderers';

// React Renderer (only available in @frontmcp/ui)
export { ReactRenderer, reactRenderer, buildHydrationScript } from './react.renderer';

// React Renderer Adapter (client-side rendering)
export { ReactRendererAdapter, createReactAdapter, loadReactAdapter } from './react.adapter';
