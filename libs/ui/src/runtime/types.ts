/**
 * Runtime Types for Tool UI Templates
 *
 * Types for the MCP Bridge runtime that adapts to different host environments
 * (OpenAI Apps SDK, ext-apps, Claude, etc.).
 *
 * Note: UI-related types are defined locally to avoid circular dependency with @frontmcp/sdk.
 * These are kept in sync with the SDK's tool-ui.metadata.ts definitions.
 */

// ============================================
// Content Security Policy (mirrors SDK types)
// ============================================

/**
 * Content Security Policy for UI templates rendered in sandboxed iframes.
 * Based on OpenAI Apps SDK and ext-apps (SEP-1865) specifications.
 */
export interface UIContentSecurityPolicy {
  /**
   * Origins allowed for fetch/XHR/WebSocket connections.
   * Maps to CSP `connect-src` directive.
   */
  connectDomains?: string[];

  /**
   * Origins allowed for images, scripts, fonts, and styles.
   * Maps to CSP `img-src`, `script-src`, `style-src`, `font-src` directives.
   */
  resourceDomains?: string[];
}

// ============================================
// Template Context & Helpers (mirrors SDK types)
// ============================================

/**
 * Helper functions available in template context.
 */
export interface TemplateHelpers {
  /** Escape HTML special characters to prevent XSS. */
  escapeHtml: (str: string) => string;

  /** Format a date for display. */
  formatDate: (date: Date | string, format?: string) => string;

  /** Format a number as currency. */
  formatCurrency: (amount: number, currency?: string) => string;

  /** Generate a unique ID for DOM elements. */
  uniqueId: (prefix?: string) => string;

  /** Safely embed JSON data in HTML (escapes script-breaking characters). */
  jsonEmbed: (data: unknown) => string;
}

/**
 * Context passed to template builder functions.
 */
export interface TemplateContext<In, Out> {
  /** The input arguments passed to the tool. */
  input: In;

  /** The raw output returned by the tool's execute method. */
  output: Out;

  /** The structured content parsed from the output (if outputSchema was provided). */
  structuredContent?: unknown;

  /** Helper functions for template rendering. */
  helpers: TemplateHelpers;
}

/**
 * Template builder function type.
 */
export type TemplateBuilderFn<In, Out> = (ctx: TemplateContext<In, Out>) => string;

/**
 * Widget serving mode determines how the widget HTML is delivered to the client.
 */
export type WidgetServingMode =
  | 'inline' // HTML embedded directly in tool response _meta
  | 'mcp-resource' // Via ui:// resource URI (MCP resources/read)
  | 'hybrid' // Shell (React + renderer) cached, component + data in response
  | 'direct-url' // HTTP endpoint on MCP server
  | 'custom-url'; // Custom URL (CDN or external hosting)

/**
 * Template type - can be:
 * - HTML string
 * - Template builder function: (ctx) => string
 * - React component function (imported from .tsx file)
 * - JSX string (transpiled at runtime)
 * - MDX string (Markdown + JSX, transpiled at runtime)
 *
 * The renderer is auto-detected based on template type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolUITemplate<In = unknown, Out = unknown> = TemplateBuilderFn<In, Out> | string | ((props: any) => any);

/**
 * UI template configuration for tools.
 */
export interface ToolUIConfig<In = unknown, Out = unknown> {
  /**
   * Template for rendering the tool UI.
   *
   * Supports multiple formats (auto-detected):
   * - HTML string: `"<div>Hello</div>"`
   * - Template builder: `(ctx) => \`<div>\${ctx.output.name}</div>\``
   * - React component: `import { MyWidget } from './widget.tsx'`
   * - JSX string: `"function Widget({ output }) { return <div>{output.name}</div>; }"`
   * - MDX string: `"# Title\n<Card name={output.name} />"`
   *
   * @example HTML template builder
   * ```typescript
   * template: (ctx) => `<div>${ctx.helpers.escapeHtml(ctx.output.name)}</div>`
   * ```
   *
   * @example React component
   * ```typescript
   * import { MyWidget } from './my-widget.tsx';
   * template: MyWidget
   * ```
   *
   * @example MDX content
   * ```typescript
   * template: `
   * # User Profile
   * <UserCard name={output.name} />
   * `
   * ```
   */
  template: ToolUITemplate<In, Out>;

  /** Content Security Policy for the sandboxed widget. */
  csp?: UIContentSecurityPolicy;

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
  servingMode?: WidgetServingMode;

  /** Custom URL for widget serving when `servingMode: 'custom-url'`. */
  customWidgetUrl?: string;

  /** Path for direct URL serving when `servingMode: 'direct-url'`. */
  directPath?: string;

  /**
   * Enable client-side hydration for React/MDX components.
   * When true, the rendered HTML includes hydration markers and
   * the React runtime is included for client-side interactivity.
   *
   * @default false
   */
  hydrate?: boolean;

  /**
   * Custom React components to make available in MDX templates.
   * These components can be used directly in MDX content.
   *
   * @example
   * ```typescript
   * import { Card, Badge } from './components';
   *
   * mdxComponents: { Card, Badge }
   * // Now in MDX: # Title\n<Card><Badge>New</Badge></Card>
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mdxComponents?: Record<string, any>;

  /**
   * Custom wrapper function for the rendered content.
   * Allows per-tool customization of the HTML document structure.
   *
   * @example
   * ```typescript
   * wrapper: (content, ctx) => `
   *   <div class="custom-wrapper">
   *     ${content}
   *   </div>
   * `
   * ```
   */
  wrapper?: (content: string, ctx: TemplateContext<In, Out>) => string;
}

// Local alias for use within this file
type UICSPType = UIContentSecurityPolicy;

/**
 * Provider identifier for the host environment
 */
export type ProviderType = 'openai' | 'ext-apps' | 'claude' | 'unknown';

/**
 * Display mode for the widget
 */
export type DisplayMode = 'inline' | 'fullscreen' | 'pip' | 'carousel';

/**
 * Theme mode
 */
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Host context provided by the environment
 */
export interface HostContext {
  /** Current theme mode */
  theme: ThemeMode;

  /** Current display mode */
  displayMode: DisplayMode;

  /** Available display modes */
  availableDisplayModes?: DisplayMode[];

  /** Viewport dimensions */
  viewport?: {
    width: number;
    height: number;
    maxHeight?: number;
    maxWidth?: number;
  };

  /** BCP 47 locale code */
  locale?: string;

  /** IANA timezone */
  timeZone?: string;

  /** User agent string */
  userAgent?: string;

  /** Platform type */
  platform?: 'web' | 'desktop' | 'mobile';

  /** Device capabilities */
  deviceCapabilities?: {
    touch?: boolean;
    hover?: boolean;
  };

  /** Safe area insets (for mobile) */
  safeAreaInsets?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

/**
 * MCP Bridge interface available as window.mcpBridge
 */
export interface MCPBridge {
  /**
   * Detected provider type
   */
  readonly provider: ProviderType;

  /**
   * Call a tool on the MCP server
   */
  callTool(name: string, params: Record<string, unknown>): Promise<unknown>;

  /**
   * Send a message to the chat interface
   */
  sendMessage(content: string): Promise<void>;

  /**
   * Open an external link
   */
  openLink(url: string): Promise<void>;

  /**
   * Get the tool input arguments
   */
  readonly toolInput: Record<string, unknown>;

  /**
   * Get the tool output/result
   */
  readonly toolOutput: unknown;

  /**
   * Get the structured content from the tool result
   */
  readonly structuredContent: unknown;

  /**
   * Get the current widget state
   */
  readonly widgetState: Record<string, unknown>;

  /**
   * Set the widget state (persisted)
   */
  setWidgetState(state: Record<string, unknown>): void;

  /**
   * Get the host context (theme, display mode, etc.)
   */
  readonly context: HostContext;

  /**
   * Subscribe to host context changes
   */
  onContextChange(callback: (context: Partial<HostContext>) => void): () => void;

  /**
   * Subscribe to tool result updates
   */
  onToolResult(callback: (result: unknown) => void): () => void;
}

/**
 * Options for wrapping tool UI templates
 */
export interface WrapToolUIOptions {
  /** HTML content of the template */
  content: string;

  /** Tool name */
  toolName: string;

  /** Tool input arguments */
  input?: Record<string, unknown>;

  /** Tool output */
  output?: unknown;

  /** Structured content from parsing */
  structuredContent?: unknown;

  /** Content Security Policy */
  csp?: UICSPType;

  /** Whether widget can call tools */
  widgetAccessible?: boolean;

  /** Title for the page */
  title?: string;
}

// Extend Window interface
declare global {
  interface Window {
    mcpBridge?: MCPBridge | MCPBridgeExtended;
    openai?: OpenAIRuntime;
    claude?: unknown; // Claude's runtime interface (if any)
    __mcpPlatform?: string; // Platform identifier injected by server
    __mcpToolName?: string;
    __mcpToolInput?: Record<string, unknown>;
    __mcpToolOutput?: unknown;
    __mcpStructuredContent?: unknown;
    __mcpToolResponseMetadata?: Record<string, unknown>;
    __mcpHostContext?: HostContext;
    __mcpWidgetToken?: string; // Widget access token
  }
}

/**
 * User agent information from OpenAI
 */
export interface OpenAIUserAgent {
  /** Device type */
  type?: 'web' | 'mobile' | 'desktop';
  /** Whether device supports hover interactions */
  hover?: boolean;
  /** Whether device supports touch interactions */
  touch?: boolean;
}

/**
 * Safe area insets (for mobile devices with notches, etc.)
 */
export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Full OpenAI runtime interface matching window.openai API
 * @see https://developers.openai.com/apps-sdk/build/chatgpt-ui
 */
export interface OpenAIRuntime {
  // ==================== Properties ====================

  /** Display theme */
  theme?: 'light' | 'dark';

  /** User agent information */
  userAgent?: OpenAIUserAgent;

  /** BCP 47 locale string */
  locale?: string;

  /** Maximum height available for widget (pixels) */
  maxHeight?: number;

  /** Current display mode */
  displayMode?: DisplayMode;

  /** Safe area insets for mobile devices */
  safeArea?: SafeAreaInsets;

  /** Tool input arguments passed to the tool */
  toolInput?: Record<string, unknown>;

  /** Structured tool output/result */
  toolOutput?: unknown;

  /** Additional metadata from tool response */
  toolResponseMetadata?: Record<string, unknown>;

  /** Persisted widget state */
  widgetState?: Record<string, unknown>;

  // ==================== Methods ====================

  /**
   * Invoke an MCP tool
   * @param name - Tool name
   * @param args - Tool arguments
   * @returns Promise resolving to tool result
   */
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;

  /**
   * Request a display mode change
   * @param options - Display mode options
   */
  requestDisplayMode?: (options: { mode: DisplayMode }) => Promise<void>;

  /**
   * Request to close the widget
   */
  requestClose?: () => Promise<void>;

  /**
   * Open an external URL
   * @param options - URL options
   */
  openExternal?: (options: { href: string }) => Promise<void>;

  /**
   * Send a follow-up message to the chat
   * @param options - Message options
   */
  sendFollowUpMessage?: (options: { prompt: string }) => Promise<void>;

  /**
   * Set widget state (persisted across sessions)
   * @param state - State object to persist
   */
  setWidgetState?: (state: Record<string, unknown>) => void;
}

/**
 * Extended MCP Bridge interface with full OpenAI API compatibility
 */
export interface MCPBridgeExtended extends MCPBridge {
  // ==================== OpenAI-Compatible Properties ====================

  /** Display theme (proxied from window.openai or polyfilled) */
  readonly theme: 'light' | 'dark';

  /** User agent info */
  readonly userAgent: OpenAIUserAgent;

  /** BCP 47 locale */
  readonly locale: string;

  /** Max height for widget */
  readonly maxHeight: number | undefined;

  /** Current display mode */
  readonly displayMode: DisplayMode;

  /** Safe area insets */
  readonly safeArea: SafeAreaInsets;

  /** Tool response metadata */
  readonly toolResponseMetadata: Record<string, unknown>;

  // ==================== OpenAI-Compatible Methods ====================

  /**
   * Request display mode change
   */
  requestDisplayMode(options: { mode: DisplayMode }): Promise<void>;

  /**
   * Request to close the widget
   */
  requestClose(): Promise<void>;
}
