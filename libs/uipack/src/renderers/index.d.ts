/**
 * Renderer Module
 *
 * Multi-framework rendering system for Tool UI templates.
 * Supports HTML, React, and MDX templates with auto-detection.
 *
 * @module @frontmcp/uipack/renderers
 *
 * @example Basic usage with auto-detection
 * ```typescript
 * import { rendererRegistry } from '@frontmcp/uipack/renderers';
 *
 * // HTML template
 * const htmlTemplate = (ctx) => `<div>${ctx.output.name}</div>`;
 * const result = await rendererRegistry.render(htmlTemplate, context);
 * ```
 *
 * @example Register React renderer
 * ```typescript
 * import { rendererRegistry } from '@frontmcp/uipack/renderers';
 * import { reactRenderer } from '@frontmcp/ui';
 *
 * rendererRegistry.register(reactRenderer);
 *
 * // Now React components are auto-detected
 * const MyComponent = ({ output }) => <div>{output.name}</div>;
 * const result = await rendererRegistry.render(MyComponent, context);
 * ```
 */
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
export { TranspileCache, transpileCache, renderCache, type TranspileCacheOptions } from './cache';
export { RendererRegistry, rendererRegistry } from './registry';
export { HtmlRenderer, htmlRenderer } from './html.renderer';
export { MdxRenderer, mdxRenderer, buildMdxHydrationScript } from './mdx.renderer';
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
//# sourceMappingURL=index.d.ts.map
