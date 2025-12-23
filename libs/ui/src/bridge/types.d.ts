/**
 * FrontMcpBridge Core Types
 *
 * Type definitions for the unified multi-platform adapter system.
 * Supports OpenAI, Claude, ext-apps (SEP-1865), Gemini, and custom adapters.
 *
 * @packageDocumentation
 */
/**
 * Widget display mode preference.
 */
export type DisplayMode = 'inline' | 'fullscreen' | 'pip' | 'carousel';
/**
 * User agent information for device capability detection.
 */
export interface UserAgentInfo {
  /** Device type */
  type: 'web' | 'mobile' | 'desktop';
  /** Has hover capability (mouse/trackpad) */
  hover: boolean;
  /** Has touch capability */
  touch: boolean;
}
/**
 * Safe area insets for mobile devices (notch, home indicator, etc.)
 */
export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
/**
 * Viewport information for responsive widgets.
 */
export interface ViewportInfo {
  width?: number;
  height?: number;
  maxWidth?: number;
  maxHeight?: number;
}
/**
 * Host context provided by the AI platform.
 */
export interface HostContext {
  /** Current theme */
  theme: 'light' | 'dark';
  /** Current display mode */
  displayMode: DisplayMode;
  /** BCP 47 locale */
  locale: string;
  /** IANA timezone */
  timezone?: string;
  /** User agent capabilities */
  userAgent: UserAgentInfo;
  /** Safe area insets */
  safeArea: SafeAreaInsets;
  /** Viewport dimensions */
  viewport?: ViewportInfo;
  /** Platform identifier */
  platform?: 'web' | 'desktop' | 'ios' | 'android';
}
/**
 * Capability flags for platform adapters.
 * Used for feature detection before calling unavailable features.
 */
export interface AdapterCapabilities {
  /** Can invoke server-side MCP tools */
  canCallTools: boolean;
  /** Can send follow-up messages to the conversation */
  canSendMessages: boolean;
  /** Can open external links */
  canOpenLinks: boolean;
  /** Can persist widget state across sessions */
  canPersistState: boolean;
  /** Has network access for fetch/XHR */
  hasNetworkAccess: boolean;
  /** Supports display mode changes (fullscreen, pip) */
  supportsDisplayModes: boolean;
  /** Supports theme detection */
  supportsTheme: boolean;
  /** Custom capability extensions */
  extensions?: Record<string, boolean>;
}
/**
 * Platform adapter interface - implemented by each platform.
 * Provides a consistent API across OpenAI, Claude, ext-apps, Gemini, etc.
 */
export interface PlatformAdapter {
  /** Unique adapter identifier (e.g., 'openai', 'claude', 'ext-apps') */
  readonly id: string;
  /** Human-readable adapter name */
  readonly name: string;
  /** Adapter priority for auto-detection (higher = checked first) */
  readonly priority: number;
  /** Static capability flags */
  readonly capabilities: AdapterCapabilities;
  /**
   * Check if this adapter can handle the current environment.
   * Called during auto-detection to find the best adapter.
   */
  canHandle(): boolean;
  /**
   * Initialize the adapter.
   * For ext-apps, this performs the ui/initialize handshake.
   * @returns Promise that resolves when the adapter is ready
   */
  initialize(): Promise<void>;
  /**
   * Clean up adapter resources.
   * Called when switching adapters or disposing the bridge.
   */
  dispose(): void;
  /** Get current theme */
  getTheme(): 'light' | 'dark';
  /** Get current display mode */
  getDisplayMode(): DisplayMode;
  /** Get user agent info */
  getUserAgent(): UserAgentInfo;
  /** Get BCP 47 locale */
  getLocale(): string;
  /** Get tool input arguments */
  getToolInput(): Record<string, unknown>;
  /** Get tool output/result */
  getToolOutput(): unknown;
  /** Get structured content (parsed output) */
  getStructuredContent(): unknown;
  /** Get persisted widget state */
  getWidgetState(): Record<string, unknown>;
  /** Get safe area insets */
  getSafeArea(): SafeAreaInsets;
  /** Get viewport info */
  getViewport(): ViewportInfo | undefined;
  /** Get full host context */
  getHostContext(): HostContext;
  /**
   * Call a tool on the MCP server.
   * @param name - Tool name
   * @param args - Tool arguments
   * @returns Promise resolving to tool result
   */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /**
   * Send a follow-up message to the conversation.
   * @param content - Message content
   */
  sendMessage(content: string): Promise<void>;
  /**
   * Open an external link.
   * @param url - URL to open
   */
  openLink(url: string): Promise<void>;
  /**
   * Request a display mode change.
   * @param mode - Desired display mode
   */
  requestDisplayMode(mode: DisplayMode): Promise<void>;
  /**
   * Request widget close.
   */
  requestClose(): Promise<void>;
  /**
   * Set widget state (persisted across sessions).
   * @param state - State object to persist
   */
  setWidgetState(state: Record<string, unknown>): void;
  /**
   * Subscribe to host context changes.
   * @param callback - Called when context changes (theme, displayMode, etc.)
   * @returns Unsubscribe function
   */
  onContextChange(callback: (changes: Partial<HostContext>) => void): () => void;
  /**
   * Subscribe to tool result updates.
   * @param callback - Called when tool result is received
   * @returns Unsubscribe function
   */
  onToolResult(callback: (result: unknown) => void): () => void;
}
/**
 * Per-adapter configuration options.
 */
export interface AdapterConfig {
  /** Enable/disable this adapter */
  enabled?: boolean;
  /** Priority override */
  priority?: number;
  /** Adapter-specific options */
  options?: Record<string, unknown>;
}
/**
 * FrontMcpBridge configuration.
 */
export interface BridgeConfig {
  /** Force a specific adapter (skip auto-detection) */
  forceAdapter?: string;
  /** Explicitly disable certain adapters */
  disabledAdapters?: string[];
  /** Debug mode (verbose logging) */
  debug?: boolean;
  /** Timeout for adapter initialization (ms) */
  initTimeout?: number;
  /** Trusted origins for postMessage (ext-apps security) */
  trustedOrigins?: string[];
  /** Per-adapter configurations */
  adapterConfigs?: Record<string, AdapterConfig>;
}
/**
 * JSON-RPC 2.0 message base.
 */
export interface JsonRpcMessage {
  jsonrpc: '2.0';
}
/**
 * JSON-RPC request message.
 */
export interface JsonRpcRequest extends JsonRpcMessage {
  id: string | number;
  method: string;
  params?: unknown;
}
/**
 * JSON-RPC response message.
 */
export interface JsonRpcResponse extends JsonRpcMessage {
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}
/**
 * JSON-RPC notification message (no id, no response expected).
 */
export interface JsonRpcNotification extends JsonRpcMessage {
  method: string;
  params?: unknown;
}
/**
 * JSON-RPC error object.
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}
/**
 * SEP-1865 ui/initialize request params.
 */
export interface ExtAppsInitializeParams {
  appInfo: {
    name: string;
    version: string;
  };
  appCapabilities: {
    tools?: {
      listChanged: boolean;
    };
  };
  protocolVersion: string;
}
/**
 * SEP-1865 ui/initialize response result.
 */
export interface ExtAppsInitializeResult {
  protocolVersion: string;
  hostInfo: {
    name: string;
    version: string;
  };
  hostCapabilities: {
    openLink?: boolean;
    serverToolProxy?: boolean;
    resourceRead?: boolean;
    logging?: boolean;
  };
  hostContext: HostContext;
}
/**
 * SEP-1865 tool input notification params.
 */
export interface ExtAppsToolInputParams {
  arguments: Record<string, unknown>;
}
/**
 * SEP-1865 tool result notification params.
 */
export interface ExtAppsToolResultParams {
  content: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}
/**
 * SEP-1865 host context change notification params.
 */
export interface ExtAppsHostContextChangeParams {
  theme?: 'light' | 'dark';
  displayMode?: DisplayMode;
  viewport?: ViewportInfo;
  locale?: string;
  timezone?: string;
}
/**
 * Bridge event types for CustomEvent dispatch.
 */
export type BridgeEventType =
  | 'bridge:ready'
  | 'bridge:error'
  | 'bridge:adapter-changed'
  | 'context:change'
  | 'tool:input'
  | 'tool:input-partial'
  | 'tool:result'
  | 'tool:cancelled';
/**
 * Bridge event payload map.
 */
export interface BridgeEventPayloads {
  'bridge:ready': {
    adapter: string;
  };
  'bridge:error': {
    error: Error;
    adapter?: string;
  };
  'bridge:adapter-changed': {
    from?: string;
    to: string;
  };
  'context:change': Partial<HostContext>;
  'tool:input': {
    arguments: Record<string, unknown>;
  };
  'tool:input-partial': {
    arguments: Record<string, unknown>;
  };
  'tool:result': {
    content: unknown;
    structuredContent?: unknown;
  };
  'tool:cancelled': {
    reason?: string;
  };
}
/**
 * Adapter factory function type.
 */
export type AdapterFactory = (config?: AdapterConfig) => PlatformAdapter;
/**
 * Adapter registration entry.
 */
export interface AdapterRegistration {
  id: string;
  factory: AdapterFactory;
  defaultConfig?: AdapterConfig;
}
/**
 * FrontMcpBridge public interface.
 * Unified entry point for all platform interactions.
 */
export interface FrontMcpBridgeInterface {
  /** Whether the bridge is initialized */
  readonly initialized: boolean;
  /** Current adapter ID */
  readonly adapterId: string | undefined;
  /** Current adapter capabilities */
  readonly capabilities: AdapterCapabilities | undefined;
  /**
   * Initialize the bridge (auto-detects platform).
   */
  initialize(): Promise<void>;
  /**
   * Get the active adapter.
   */
  getAdapter(): PlatformAdapter | undefined;
  /**
   * Check if a specific capability is available.
   */
  hasCapability(cap: keyof AdapterCapabilities): boolean;
  /**
   * Dispose the bridge and release resources.
   */
  dispose(): void;
  getTheme(): 'light' | 'dark';
  getDisplayMode(): DisplayMode;
  getToolInput(): Record<string, unknown>;
  getToolOutput(): unknown;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  sendMessage(content: string): Promise<void>;
  openLink(url: string): Promise<void>;
  requestDisplayMode(mode: DisplayMode): Promise<void>;
  setWidgetState(state: Record<string, unknown>): void;
  onContextChange(callback: (changes: Partial<HostContext>) => void): () => void;
  onToolResult(callback: (result: unknown) => void): () => void;
}
//# sourceMappingURL=types.d.ts.map
