/**
 * React Renderer Module
 *
 * Provides the React renderer and MDX server-side renderer for template processing.
 * For React-free renderers (HTML, client-side MDX) use @frontmcp/uipack/renderers.
 *
 * @module @frontmcp/ui/renderers
 *
 * @example
 * ```typescript
 * import { reactRenderer, ReactRenderer, mdxRenderer, MdxRenderer } from '@frontmcp/ui/renderers';
 * import { rendererRegistry } from '@frontmcp/uipack/renderers';
 *
 * // Register React renderer
 * rendererRegistry.register(reactRenderer);
 *
 * // Use MDX server-side renderer
 * const html = await mdxRenderer.render('# Hello {output.name}', context);
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

// MDX Server Renderer (requires React, uses react-dom/server for SSR)
// For client-side CDN-based MDX rendering, use MdxClientRenderer from @frontmcp/uipack
export { MdxRenderer, mdxRenderer, buildMdxHydrationScript } from './mdx.renderer';

// JSX Execution (requires React)
// For transpilation only (without React), use transpileJsx from @frontmcp/uipack
export { executeTranspiledCode, transpileAndExecute } from './transpiler';
