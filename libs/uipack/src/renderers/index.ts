/**
 * Renderer Module
 *
 * Multi-framework rendering system for Tool UI templates.
 * Supports HTML, React, and MDX templates with auto-detection.
 *
 * @module @frontmcp/ui
 *
 * @example Basic usage with auto-detection
 * ```typescript
 * import { rendererRegistry } from '@frontmcp/ui';
 *
 * // HTML template
 * const htmlTemplate = (ctx) => `<div>${ctx.output.name}</div>`;
 * const result = await rendererRegistry.render(htmlTemplate, context);
 * ```
 *
 * @example Register React renderer
 * ```typescript
 * import { rendererRegistry, reactRenderer } from '@frontmcp/ui';
 *
 * rendererRegistry.register(reactRenderer);
 *
 * // Now React components are auto-detected
 * const MyComponent = ({ output }) => <div>{output.name}</div>;
 * const result = await rendererRegistry.render(MyComponent, context);
 * ```
 */

// Types
// Note: TemplateBuilderFn and ToolUITemplate are exported from ../runtime/types
// to avoid duplication with the main runtime exports
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
} from './types';

// Cache
export { TranspileCache, transpileCache, renderCache, type TranspileCacheOptions } from './cache';

// Registry
export { RendererRegistry, rendererRegistry } from './registry';

// HTML Renderer (built-in)
export { HtmlRenderer, htmlRenderer } from './html.renderer';

// MDX Renderer
export { MdxRenderer, mdxRenderer, buildMdxHydrationScript } from './mdx.renderer';

// Note: React renderer is in @frontmcp/ui package (requires React)

// Utilities
export {
  isReactComponent,
  isTemplateBuilderFunction,
  containsJsx,
  containsMdxSyntax,
  isPlainHtml,
  detectTemplateType,
  hashString,
  hashCombined,
  isHash,
  transpileJsx,
  isSwcAvailable,
  executeTranspiledCode,
  transpileAndExecute,
} from './utils';
