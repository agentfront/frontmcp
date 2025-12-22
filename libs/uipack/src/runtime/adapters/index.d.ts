/**
 * Renderer Adapters
 *
 * Client-side adapters for rendering different UI types.
 *
 * @packageDocumentation
 */
export type {
  RendererAdapter,
  RenderContext,
  RenderOptions,
  RenderResult,
  AdapterLoader,
  AdapterRegistryEntry,
} from './types';
export { HtmlRendererAdapter, createHtmlAdapter, loadHtmlAdapter } from './html.adapter';
export { MdxRendererAdapter, createMdxAdapter, loadMdxAdapter } from './mdx.adapter';
import type { UIType } from '../../types/ui-runtime';
import type { AdapterLoader, RendererAdapter } from './types';
/**
 * Registry of adapter loaders by UI type.
 * Note: React adapter is in @frontmcp/ui package.
 */
export declare const adapterLoaders: Record<UIType, AdapterLoader | undefined>;
/**
 * Get an adapter loader for a UI type.
 */
export declare function getAdapterLoader(type: UIType): AdapterLoader | undefined;
/**
 * Load an adapter for a UI type.
 */
export declare function loadAdapter(type: UIType): Promise<RendererAdapter | null>;
//# sourceMappingURL=index.d.ts.map
