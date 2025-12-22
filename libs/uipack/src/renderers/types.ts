/**
 * Renderer System Types
 *
 * Core interfaces for the multi-framework rendering system.
 * Supports HTML, React, and MDX templates with auto-detection.
 */

import type { TemplateContext, TemplateHelpers, TemplateBuilderFn } from '../runtime/types';
import type { PlatformCapabilities } from '../theme';

// ============================================
// Renderer Types
// ============================================

/**
 * Supported renderer types for template processing.
 * - 'html': Plain HTML string or template function
 * - 'react': React functional component
 * - 'mdx': MDX content string
 */
export type RendererType = 'html' | 'react' | 'mdx';

/**
 * Props passed to React components used as templates.
 *
 * For SSR (server-side rendering), `output` is always available.
 * For client-side hydration with the bridge, use `HydratedToolUIProps`.
 */
export interface ToolUIProps<In = unknown, Out = unknown> {
  /** Tool input arguments */
  input: In;
  /** Tool output result */
  output: Out;
  /** Structured content parsed from output */
  structuredContent?: unknown;
  /** Helper functions for rendering */
  helpers: TemplateHelpers;
}

/**
 * Props for client-side hydrated components using the Platform Bridge.
 *
 * These props include loading/error state for reactive rendering.
 * Use with `useSyncExternalStore` from React 18+:
 *
 * @example
 * ```tsx
 * import { useSyncExternalStore } from 'react';
 *
 * function useToolBridge<T>(): HydratedToolUIProps<T> {
 *   const state = useSyncExternalStore(
 *     window.__frontmcp.bridge.subscribe,
 *     window.__frontmcp.bridge.getSnapshot,
 *     window.__frontmcp.bridge.getServerSnapshot
 *   );
 *   return {
 *     data: state.data as T,
 *     loading: state.loading,
 *     error: state.error,
 *   };
 * }
 *
 * function MyWidget() {
 *   const { data, loading, error } = useToolBridge<WeatherData>();
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <Error message={error} />;
 *   if (!data) return <Empty />;
 *
 *   return <WeatherCard {...data} />;
 * }
 * ```
 */
export interface HydratedToolUIProps<Out = unknown> {
  /** Tool output data (null when loading or no data) */
  data: Out | null;
  /** Whether the bridge is waiting for data */
  loading: boolean;
  /** Error message if data loading failed */
  error: string | null;
}

/**
 * Result of transpiling a template.
 */
export interface TranspileResult {
  /** Transpiled JavaScript code */
  code: string;
  /** Content hash for caching */
  hash: string;
  /** Whether result was retrieved from cache */
  cached: boolean;
  /** Source map for debugging (optional) */
  sourceMap?: string;
}

/**
 * Options for transpilation.
 */
export interface TranspileOptions {
  /** Enable source maps */
  sourceMaps?: boolean;
  /** Development mode (more detailed errors) */
  development?: boolean;
}

/**
 * Options for rendering a template.
 */
export interface RenderOptions {
  /** Target platform capabilities */
  platform?: PlatformCapabilities;
  /** Enable client-side hydration */
  hydrate?: boolean;
  /** Custom MDX components */
  mdxComponents?: Record<string, unknown>;
}

/**
 * Runtime scripts to inject for client-side functionality.
 */
export interface RuntimeScripts {
  /** Scripts to include in <head> */
  headScripts: string;
  /** Inline script content (for blocked-network platforms) */
  inlineScripts?: string;
  /** Whether scripts are inline or external */
  isInline: boolean;
}

/**
 * Result of rendering a template.
 */
export interface RenderResult {
  /** Rendered HTML content (body only) */
  html: string;
  /** Renderer type that was used */
  rendererType: RendererType;
  /** Whether transpilation was cached */
  transpileCached: boolean;
  /** Runtime scripts needed for this template */
  runtimeScripts: RuntimeScripts;
}

// ============================================
// Renderer Interface
// ============================================

/**
 * Abstract renderer interface for processing templates.
 *
 * Each renderer handles a specific template type (HTML, React, MDX)
 * and provides:
 * - Template type detection
 * - Transpilation (if needed)
 * - HTML rendering
 * - Client runtime script generation
 */
export interface UIRenderer<T = unknown> {
  /**
   * Unique renderer type identifier.
   */
  readonly type: RendererType;

  /**
   * Priority for auto-detection.
   * Higher values are checked first.
   * - React: 20
   * - MDX: 10
   * - HTML: 0 (fallback)
   */
  readonly priority: number;

  /**
   * Check if this renderer can handle the given template.
   *
   * @param template - The template to check
   * @returns True if this renderer can process the template
   */
  canHandle(template: unknown): template is T;

  /**
   * Transpile the template to executable JavaScript (if needed).
   *
   * For React components from imports, no transpilation is needed.
   * For JSX strings, SWC transpilation is performed.
   * Results are cached by content hash.
   *
   * @param template - Template to transpile
   * @param options - Transpilation options
   * @returns Transpiled result with caching metadata
   */
  transpile(template: T, options?: TranspileOptions): Promise<TranspileResult>;

  /**
   * Render the template to HTML string.
   *
   * @param template - Template to render
   * @param context - Template context with input/output/helpers
   * @param options - Render options (platform, hydration, etc.)
   * @returns Rendered HTML string
   */
  render<In, Out>(template: T, context: TemplateContext<In, Out>, options?: RenderOptions): Promise<string>;

  /**
   * Get runtime scripts needed for client-side functionality.
   *
   * @param platform - Target platform capabilities
   * @returns Scripts to inject (CDN or inline based on platform)
   */
  getRuntimeScripts(platform: PlatformCapabilities): RuntimeScripts;
}

// ============================================
// Registry Types
// ============================================

/**
 * Options for the renderer registry.
 */
export interface RendererRegistryOptions {
  /** Maximum cache size for transpiled results */
  maxCacheSize?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result of detecting a template's renderer type.
 */
export interface DetectionResult {
  /** The detected renderer */
  renderer: UIRenderer;
  /** Confidence level (0-1) */
  confidence: number;
  /** Detection reason for debugging */
  reason: string;
}

// ============================================
// Extended ToolUIConfig
// ============================================

/**
 * React component type for Tool UI templates.
 *
 * This is a generic function type that accepts props and returns JSX.
 * We use a loose type here to avoid requiring React types at compile time.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReactComponentType<In = unknown, Out = unknown> = (props: ToolUIProps<In, Out>) => any;

// Note: TemplateBuilderFn is imported from ../runtime/types and re-exported
// from the renderers index to avoid duplication

/**
 * All possible template types.
 * Auto-detected at runtime.
 */
export type ToolUITemplate<In = unknown, Out = unknown> =
  | TemplateBuilderFn<In, Out> // HTML template function: (ctx) => string
  | string // MDX or static HTML string
  | ReactComponentType<In, Out>; // React functional/class component

/**
 * Context passed to custom wrapper functions.
 */
export interface WrapperContext {
  /** Tool name */
  toolName: string;
  /** Rendered content HTML */
  content: string;
  /** Detected renderer type */
  rendererType: RendererType;
  /** Target platform */
  platform: PlatformCapabilities;
  /** Runtime scripts to inject */
  runtimeScripts: RuntimeScripts;
}

/**
 * Extended Tool UI configuration with multi-framework support.
 *
 * The template type is auto-detected - no need to specify a renderer!
 *
 * @example React component
 * ```typescript
 * import { UserCard } from './components/user-card.tsx';
 *
 * @Tool({
 *   ui: {
 *     template: UserCard, // Auto-detected as React
 *     hydrate: true,      // Enable client-side interactivity
 *   }
 * })
 * ```
 *
 * @example MDX template
 * ```typescript
 * @Tool({
 *   ui: {
 *     template: `
 *       # Welcome
 *       <UserCard name={output.name} />
 *     `,
 *     mdxComponents: { UserCard },
 *   }
 * })
 * ```
 *
 * @example HTML template (unchanged)
 * ```typescript
 * @Tool({
 *   ui: {
 *     template: (ctx) => `<div>${ctx.output.name}</div>`,
 *   }
 * })
 * ```
 */
export interface ExtendedToolUIConfig<In = unknown, Out = unknown> {
  /**
   * Template for rendering the UI.
   *
   * Can be:
   * - React component: `({ input, output }) => <div>...</div>`
   * - MDX string: `# Title\n<Component />`
   * - HTML function: `(ctx) => \`<div>...</div>\``
   * - Static HTML string
   *
   * Type is auto-detected at runtime.
   */
  template: ToolUITemplate<In, Out>;

  /**
   * Enable client-side hydration for React components.
   * When true, the React runtime is included and components
   * become interactive in the browser.
   *
   * @default false
   */
  hydrate?: boolean;

  /**
   * Custom wrapper function to override the default HTML document wrapper.
   * Useful for completely custom document structures.
   *
   * @param content - Rendered template HTML
   * @param ctx - Wrapper context with metadata
   * @returns Complete HTML document string
   */
  wrapper?: (content: string, ctx: WrapperContext) => string;

  /**
   * Custom MDX components available in MDX templates.
   * These components can be used directly in MDX content.
   *
   * @example
   * ```typescript
   * mdxComponents: {
   *   UserCard: ({ name }) => <div>{name}</div>,
   *   Badge: ({ type }) => <span className={type}>...</span>,
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mdxComponents?: Record<string, (props: any) => any>;

  // ============================================
  // Existing fields (from ToolUIConfig)
  // ============================================

  /** Content Security Policy for the sandboxed widget. */
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
  };

  /** Whether the widget can invoke tools via the MCP bridge. */
  widgetAccessible?: boolean;

  /** Preferred display mode for the widget. */
  displayMode?: 'inline' | 'fullscreen' | 'pip';

  /** Human-readable description shown to users about what the widget does. */
  widgetDescription?: string;

  /** Status messages shown during tool invocation. */
  invocationStatus?: {
    invoking?: string;
    invoked?: string;
  };

  /** How the widget HTML should be served to the client. */
  servingMode?: 'inline' | 'static' | 'hybrid' | 'direct-url' | 'custom-url';

  /** Custom URL for widget serving when `servingMode: 'custom-url'`. */
  customWidgetUrl?: string;

  /** Path for direct URL serving when `servingMode: 'direct-url'`. */
  directPath?: string;
}
