/**
 * Renderer Adapters
 *
 * Client-side adapters for rendering different UI types.
 *
 * @packageDocumentation
 */

// Types
export type {
  RendererAdapter,
  RenderContext,
  RenderOptions,
  RenderResult,
  AdapterLoader,
  AdapterRegistryEntry,
} from './types';

// HTML Adapter
export { HtmlRendererAdapter, createHtmlAdapter, loadHtmlAdapter } from './html.adapter';

// MDX Adapter
export { MdxRendererAdapter, createMdxAdapter, loadMdxAdapter } from './mdx.adapter';

// Note: React adapter is in @frontmcp/ui package (requires React)

// Adapter registry for lazy loading
import type { UIType } from '../../types/ui-runtime';
import type { AdapterLoader, RendererAdapter } from './types';

/**
 * Registry of adapter loaders by UI type.
 * Note: React adapter is in @frontmcp/ui package.
 */
export const adapterLoaders: Record<UIType, AdapterLoader | undefined> = {
  html: () => import(/* webpackIgnore: true */ './html.adapter.js').then((m) => m.createHtmlAdapter()),
  react: undefined, // React adapter is in @frontmcp/ui
  mdx: () => import(/* webpackIgnore: true */ './mdx.adapter.js').then((m) => m.createMdxAdapter()),
  markdown: () => import(/* webpackIgnore: true */ './mdx.adapter.js').then((m) => m.createMdxAdapter()), // Use MDX for markdown
  auto: undefined, // Auto-detection handled by runtime
};

/**
 * Get an adapter loader for a UI type.
 */
export function getAdapterLoader(type: UIType): AdapterLoader | undefined {
  return adapterLoaders[type];
}

/**
 * Load an adapter for a UI type.
 */
export async function loadAdapter(type: UIType): Promise<RendererAdapter | null> {
  const loader = getAdapterLoader(type);
  if (!loader) {
    return null;
  }
  return loader();
}
