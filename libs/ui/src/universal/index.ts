/**
 * Universal Renderer Module
 *
 * Multi-format client-side rendering system for FrontMCP widgets.
 * Supports HTML, Markdown, React, and MDX content with auto-detection.
 *
 * @module @frontmcp/ui/universal
 *
 * @example Basic usage
 * ```tsx
 * import { UniversalAppWithProvider } from '@frontmcp/ui/universal';
 *
 * function App() {
 *   return (
 *     <UniversalAppWithProvider
 *       initialState={{
 *         toolName: 'get_weather',
 *         output: { temperature: 72 },
 *       }}
 *       content={{
 *         type: 'markdown',
 *         source: '# Weather: {output.temperature}°F',
 *       }}
 *     />
 *   );
 * }
 * ```
 *
 * @example Custom components
 * ```tsx
 * const components = {
 *   WeatherCard: ({ temp }) => <div>{temp}°F</div>,
 * };
 *
 * function App() {
 *   return (
 *     <UniversalAppWithProvider
 *       components={components}
 *       content={{
 *         type: 'markdown',
 *         source: '# Weather\n\n<WeatherCard temp={72} />',
 *       }}
 *     />
 *   );
 * }
 * ```
 */

// ============================================
// Types
// ============================================

export type {
  ContentType,
  UniversalContent,
  FrontMCPState,
  FrontMCPStore,
  RenderContext,
  ClientRenderer,
  UniversalAppProps,
  FrontMCPProviderProps,
  CDNType,
  UniversalRuntimeOptions,
  UniversalRuntimeResult,
} from './types';

export { DEFAULT_FRONTMCP_STATE, UNIVERSAL_CDN, detectContentType } from './types';

// ============================================
// Store
// ============================================

export {
  createFrontMCPStore,
  getGlobalStore,
  setGlobalStore,
  resetGlobalStore,
  useFrontMCPStore,
  useToolOutput,
  useToolInput,
  useContent,
  useToolName,
  useLoadingState,
  initializeStoreFromWindow,
  createStoreSelector,
} from './store';

// ============================================
// Context
// ============================================

export {
  FrontMCPProvider,
  ComponentsProvider,
  UniversalProvider,
  useFrontMCPContext,
  useComponents,
  useFrontMCPContextSafe,
  withFrontMCP,
} from './context';

export type { ComponentsProviderProps, UniversalProviderProps } from './context';

// ============================================
// Renderers
// ============================================

export {
  // Registry
  RendererRegistry,
  rendererRegistry,
  detectRenderer,
  renderContent,
  createContent,
  // Individual renderers
  htmlRenderer,
  safeHtmlRenderer,
  markdownRenderer,
  createMarkdownRenderer,
  reactRenderer,
  isReactComponent,
  mdxRenderer,
  isMdxSupported,
  createMdxRenderer,
} from './renderers';

// ============================================
// Universal App
// ============================================

export { UniversalApp, UniversalAppWithProvider, LoadingSpinner, ErrorDisplay, EmptyState } from './UniversalApp';

// ============================================
// Runtime Builder
// ============================================

export { buildUniversalRuntime, buildMinimalRuntime } from './runtime-builder';

// ============================================
// Cached Runtime (Optimized)
// ============================================

export {
  // Cache API
  getCachedRuntime,
  clearRuntimeCache,
  getRuntimeCacheStats,
  // Helper functions
  buildAppScript,
  buildDataInjectionCode,
  buildComponentCode,
  // Placeholders
  RUNTIME_PLACEHOLDERS,
  // Types
  type CachedRuntimeOptions,
  type CachedRuntimeResult,
} from './cached-runtime';
