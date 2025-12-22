/**
 * FrontMcpBridge Factory
 *
 * Main entry point for the unified multi-platform adapter system.
 * Provides automatic platform detection and a consistent API across
 * OpenAI, Claude, ext-apps, Gemini, and custom adapters.
 *
 * @packageDocumentation
 */
import type {
  PlatformAdapter,
  AdapterCapabilities,
  BridgeConfig,
  DisplayMode,
  HostContext,
  FrontMcpBridgeInterface,
} from '../types';
import { AdapterRegistry } from './adapter-registry';
/**
 * FrontMcpBridge - Unified multi-platform bridge for MCP tool widgets.
 *
 * @example Basic usage with auto-detection
 * ```typescript
 * const bridge = new FrontMcpBridge();
 * await bridge.initialize();
 *
 * const theme = bridge.getTheme();
 * const toolInput = bridge.getToolInput();
 * ```
 *
 * @example Force specific adapter
 * ```typescript
 * const bridge = new FrontMcpBridge({
 *   forceAdapter: 'openai',
 *   debug: true,
 * });
 * await bridge.initialize();
 * ```
 *
 * @example With custom registry
 * ```typescript
 * const registry = new AdapterRegistry();
 * registry.register('custom', createCustomAdapter);
 *
 * const bridge = new FrontMcpBridge({ forceAdapter: 'custom' }, registry);
 * await bridge.initialize();
 * ```
 */
export declare class FrontMcpBridge implements FrontMcpBridgeInterface {
  private _config;
  private _registry;
  private _adapter;
  private _initialized;
  private _initPromise;
  /**
   * Create a new FrontMcpBridge instance.
   * @param config - Bridge configuration
   * @param registry - Optional custom adapter registry (uses default if not provided)
   */
  constructor(config?: BridgeConfig, registry?: AdapterRegistry);
  /**
   * Whether the bridge has been initialized.
   */
  get initialized(): boolean;
  /**
   * Current adapter ID, or undefined if not initialized.
   */
  get adapterId(): string | undefined;
  /**
   * Current adapter capabilities, or undefined if not initialized.
   */
  get capabilities(): AdapterCapabilities | undefined;
  /**
   * Initialize the bridge.
   * Auto-detects the best adapter for the current platform unless
   * `forceAdapter` is specified in the config.
   *
   * @throws Error if no suitable adapter is found
   */
  initialize(): Promise<void>;
  /**
   * Internal initialization logic.
   */
  private _doInitialize;
  /**
   * Dispose the bridge and release resources.
   */
  dispose(): void;
  /**
   * Get the active adapter instance.
   */
  getAdapter(): PlatformAdapter | undefined;
  /**
   * Check if a specific capability is available.
   * @param cap - Capability key to check
   */
  hasCapability(cap: keyof AdapterCapabilities): boolean;
  /**
   * Get current theme.
   */
  getTheme(): 'light' | 'dark';
  /**
   * Get current display mode.
   */
  getDisplayMode(): DisplayMode;
  /**
   * Get tool input arguments.
   */
  getToolInput(): Record<string, unknown>;
  /**
   * Get tool output/result.
   */
  getToolOutput(): unknown;
  /**
   * Get structured content (parsed output).
   */
  getStructuredContent(): unknown;
  /**
   * Get persisted widget state.
   */
  getWidgetState(): Record<string, unknown>;
  /**
   * Get full host context.
   */
  getHostContext(): HostContext;
  /**
   * Call a tool on the MCP server.
   * @param name - Tool name
   * @param args - Tool arguments
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
   * @param callback - Called when context changes
   * @returns Unsubscribe function
   */
  onContextChange(callback: (changes: Partial<HostContext>) => void): () => void;
  /**
   * Subscribe to tool result updates.
   * @param callback - Called when tool result is received
   * @returns Unsubscribe function
   */
  onToolResult(callback: (result: unknown) => void): () => void;
  /**
   * Ensure the bridge is initialized before operations.
   */
  private _ensureInitialized;
  /**
   * Wrap a promise with a timeout.
   */
  private _withTimeout;
  /**
   * Emit a bridge event via CustomEvent.
   */
  private _emitEvent;
  /**
   * Log debug message if debugging is enabled.
   */
  private _log;
}
/**
 * Create and initialize a bridge instance.
 * Convenience function for one-liner initialization.
 *
 * @example
 * ```typescript
 * const bridge = await createBridge({ debug: true });
 * const theme = bridge.getTheme();
 * ```
 */
export declare function createBridge(config?: BridgeConfig, registry?: AdapterRegistry): Promise<FrontMcpBridge>;
/**
 * Get or create the global bridge instance.
 * Initializes automatically on first call.
 */
export declare function getGlobalBridge(config?: BridgeConfig): Promise<FrontMcpBridge>;
/**
 * Reset the global bridge instance.
 * Useful for testing or when switching configurations.
 */
export declare function resetGlobalBridge(): void;
//# sourceMappingURL=bridge-factory.d.ts.map
