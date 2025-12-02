/**
 * Runtime Types for Tool UI Templates
 *
 * Types for the MCP Bridge runtime that adapts to different host environments
 * (OpenAI Apps SDK, ext-apps, Claude, etc.).
 */

// Re-export UI types from SDK for convenience
export type {
  UIContentSecurityPolicy,
  TemplateContext,
  TemplateHelpers,
  TemplateBuilderFn,
  ToolUIConfig,
} from '@frontmcp/sdk';

// Import for local use
import type { UIContentSecurityPolicy as UICSPType } from '@frontmcp/sdk';

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
