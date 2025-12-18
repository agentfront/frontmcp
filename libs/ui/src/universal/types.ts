/**
 * Universal Renderer Types
 *
 * Core types for the multi-format client-side rendering system.
 * Supports HTML, Markdown, React, and MDX content types with
 * auto-detection and custom component injection.
 */

// ============================================
// Content Types
// ============================================

/**
 * Supported content types for the universal renderer.
 *
 * - 'html': Raw HTML string (rendered with dangerouslySetInnerHTML)
 * - 'markdown': Markdown content (rendered with react-markdown)
 * - 'react': React component (rendered directly)
 * - 'mdx': MDX content (rendered with @mdx-js/react)
 */
export type ContentType = 'html' | 'markdown' | 'react' | 'mdx';

/**
 * Content configuration for the universal renderer.
 */
export interface UniversalContent {
  /** Content type for auto-detection override */
  type: ContentType;

  /** Source content - string for HTML/Markdown/MDX, component for React */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: string | React.ComponentType<any>;

  /** Props to pass to React/MDX components */
  props?: Record<string, unknown>;

  /** Custom components available in Markdown/MDX content */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, React.ComponentType<any>>;
}

// ============================================
// Store Types
// ============================================

/**
 * FrontMCP store state shape.
 * Provides tool context and loading/error states.
 */
export interface FrontMCPState {
  /** Tool name from MCP context */
  toolName: string | null;

  /** Tool input arguments */
  input: Record<string, unknown> | null;

  /** Tool output data */
  output: unknown | null;

  /** Content configuration for rendering */
  content: UniversalContent | null;

  /** Structured content parsed from output */
  structuredContent: unknown | null;

  /** Whether data is currently loading */
  loading: boolean;

  /** Error message if loading failed */
  error: string | null;
}

/**
 * Default initial state for the FrontMCP store.
 */
export const DEFAULT_FRONTMCP_STATE: FrontMCPState = {
  toolName: null,
  input: null,
  output: null,
  content: null,
  structuredContent: null,
  loading: false,
  error: null,
};

/**
 * Store interface with subscription support.
 */
export interface FrontMCPStore {
  /** Get current state snapshot */
  getState(): FrontMCPState;

  /** Get server-side state (for SSR) */
  getServerState(): FrontMCPState;

  /** Update state with partial values */
  setState(partial: Partial<FrontMCPState>): void;

  /** Subscribe to state changes */
  subscribe(listener: () => void): () => void;

  /** Reset state to initial values */
  reset(): void;
}

// ============================================
// Renderer Types
// ============================================

/**
 * Render context passed to client-side renderers.
 */
export interface RenderContext {
  /** Tool output data */
  output: unknown;

  /** Tool input data */
  input: Record<string, unknown> | null;

  /** Custom components available for rendering */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: Record<string, React.ComponentType<any>>;

  /** Full store state */
  state: FrontMCPState;
}

/**
 * Client-side renderer interface.
 * Each renderer handles a specific content type.
 */
export interface ClientRenderer {
  /** Content type this renderer handles */
  readonly type: ContentType;

  /** Priority for auto-detection (higher = checked first) */
  readonly priority: number;

  /**
   * Check if this renderer can handle the given content.
   */
  canHandle(content: UniversalContent): boolean;

  /**
   * Render the content to React elements.
   */
  render(content: UniversalContent, context: RenderContext): React.ReactNode;
}

// ============================================
// Universal App Types
// ============================================

/**
 * Props for the UniversalApp component.
 */
export interface UniversalAppProps {
  /** Content to render (overrides store content) */
  content?: UniversalContent;

  /** Custom components available for rendering */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, React.ComponentType<any>>;

  /** Loading fallback component */
  fallback?: React.ReactNode;

  /** Error fallback component */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  errorFallback?: React.ComponentType<{ error: string }>;
}

/**
 * Props for the FrontMCPProvider component.
 */
export interface FrontMCPProviderProps {
  /** Store instance to provide */
  store?: FrontMCPStore;

  /** Initial state override */
  initialState?: Partial<FrontMCPState>;

  /** Children to render (optional when using React.createElement) */
  children?: React.ReactNode;
}

// ============================================
// Runtime Builder Types
// ============================================

/**
 * CDN type for runtime script loading.
 */
export type CDNType = 'esm' | 'umd';

/**
 * Options for building the universal runtime script.
 */
export interface UniversalRuntimeOptions {
  /** CDN type to use for external dependencies */
  cdnType: CDNType;

  /** Include markdown renderer (react-markdown) */
  includeMarkdown?: boolean;

  /** Include MDX renderer (@mdx-js/react) */
  includeMdx?: boolean;

  /** Custom components to include (as inline JavaScript) */
  customComponents?: string;

  /** Minify the output */
  minify?: boolean;
}

/**
 * Result from building the universal runtime.
 */
export interface UniversalRuntimeResult {
  /** Complete runtime script (including store, renderers, app) */
  script: string;

  /** CDN imports to include in head */
  cdnImports: string;

  /** Size of the runtime in bytes */
  size: number;
}

// ============================================
// CDN Dependencies
// ============================================

/**
 * CDN URLs for universal renderer dependencies.
 */
export const UNIVERSAL_CDN = {
  esm: {
    reactMarkdown: 'https://esm.sh/react-markdown@9',
    mdxReact: 'https://esm.sh/@mdx-js/react@3',
    remarkGfm: 'https://esm.sh/remark-gfm@4',
  },
  // Note: These libraries are not available on cdnjs
  // For Claude, we use inline implementations
} as const;

// ============================================
// Detection Utilities
// ============================================

/**
 * Detect content type from source content.
 *
 * Detection priority:
 * 1. React component function -> 'react'
 * 2. Module code (import/export) with JSX -> 'react' (needs transpilation)
 * 3. Markdown with JSX components -> 'mdx' (render with MDX renderer)
 * 4. Pure markdown -> 'markdown'
 * 5. Default -> 'html'
 */
export function detectContentType(source: unknown): ContentType {
  // React component function
  if (typeof source === 'function') {
    return 'react';
  }

  if (typeof source !== 'string') {
    return 'html'; // Fallback
  }

  // Check for module syntax (import/export statements)
  // This indicates a full React component module that needs transpilation
  const hasModuleSyntax =
    /^import\s+/m.test(source) ||
    /^export\s+(default\s+)?/m.test(source) ||
    /^const\s+\w+\s*=\s*\([^)]*\)\s*=>/m.test(source) || // Arrow function components
    /^function\s+\w+\s*\(/m.test(source); // Function components

  const hasJsxTags = /<[A-Z][a-zA-Z]*/.test(source);
  const hasMarkdown =
    /^#{1,6}\s/m.test(source) || /^\*\s/m.test(source) || /^-\s/m.test(source) || /^\d+\.\s/m.test(source);

  // Full React module (import/export with JSX) -> needs transpilation
  if (hasModuleSyntax && hasJsxTags) {
    return 'react';
  }

  // MDX: has JSX component tags AND markdown (but NOT module syntax)
  // This is markdown content with embedded components like <WeatherCard />
  if (hasJsxTags && hasMarkdown && !hasModuleSyntax) {
    return 'mdx';
  }

  // Markdown: has markdown syntax
  if (hasMarkdown || /\*\*[^*]+\*\*/.test(source) || /\[[^\]]+\]\([^)]+\)/.test(source)) {
    return 'markdown';
  }

  // JSX-only without module syntax -> treat as MDX (inline JSX)
  if (hasJsxTags && !hasModuleSyntax) {
    return 'mdx';
  }

  // Default to HTML
  return 'html';
}
