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
  BridgeEventType,
  BridgeEventPayloads,
} from '../types';
import { AdapterRegistry, defaultRegistry } from './adapter-registry';

/**
 * Default bridge configuration.
 */
const DEFAULT_CONFIG: BridgeConfig = {
  debug: false,
  initTimeout: 5000,
};

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
export class FrontMcpBridge implements FrontMcpBridgeInterface {
  private _config: BridgeConfig;
  private _registry: AdapterRegistry;
  private _adapter: PlatformAdapter | undefined;
  private _initialized = false;
  private _initPromise: Promise<void> | undefined;

  /**
   * Create a new FrontMcpBridge instance.
   * @param config - Bridge configuration
   * @param registry - Optional custom adapter registry (uses default if not provided)
   */
  constructor(config: BridgeConfig = {}, registry?: AdapterRegistry) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._registry = registry || defaultRegistry;

    if (this._config.debug) {
      this._registry.setDebug(true);
    }

    // Apply disabled adapters
    if (this._config.disabledAdapters) {
      this._registry.disable(...this._config.disabledAdapters);
    }

    // Apply adapter configs
    if (this._config.adapterConfigs) {
      for (const [id, adapterConfig] of Object.entries(this._config.adapterConfigs)) {
        this._registry.configure(id, adapterConfig);
      }
    }
  }

  // ============================================
  // Public Properties
  // ============================================

  /**
   * Whether the bridge has been initialized.
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Current adapter ID, or undefined if not initialized.
   */
  get adapterId(): string | undefined {
    return this._adapter?.id;
  }

  /**
   * Current adapter capabilities, or undefined if not initialized.
   */
  get capabilities(): AdapterCapabilities | undefined {
    return this._adapter?.capabilities;
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Initialize the bridge.
   * Auto-detects the best adapter for the current platform unless
   * `forceAdapter` is specified in the config.
   *
   * @throws Error if no suitable adapter is found
   */
  async initialize(): Promise<void> {
    // Ensure only one initialization runs at a time
    if (this._initPromise) {
      return this._initPromise;
    }

    if (this._initialized) {
      return;
    }

    this._initPromise = this._doInitialize();
    try {
      await this._initPromise;
    } finally {
      this._initPromise = undefined;
    }
  }

  /**
   * Internal initialization logic.
   */
  private async _doInitialize(): Promise<void> {
    this._log('Initializing FrontMcpBridge...');

    // Select adapter
    if (this._config.forceAdapter) {
      this._adapter = this._registry.get(this._config.forceAdapter);
      if (!this._adapter) {
        throw new Error(`Forced adapter "${this._config.forceAdapter}" not found or disabled`);
      }
      this._log(`Using forced adapter: ${this._config.forceAdapter}`);
    } else {
      this._adapter = this._registry.detect();
      if (!this._adapter) {
        throw new Error('No suitable adapter detected for current environment');
      }
      this._log(`Auto-detected adapter: ${this._adapter.id}`);
    }

    // Initialize adapter with timeout
    try {
      await this._withTimeout(this._adapter.initialize(), this._config.initTimeout || 5000);
      this._initialized = true;
      this._log(`Bridge initialized with adapter: ${this._adapter.id}`);
      this._emitEvent('bridge:ready', { adapter: this._adapter.id });
    } catch (error) {
      this._emitEvent('bridge:error', {
        error: error instanceof Error ? error : new Error(String(error)),
        adapter: this._adapter?.id,
      });
      throw error;
    }
  }

  /**
   * Dispose the bridge and release resources.
   */
  dispose(): void {
    if (this._adapter) {
      this._adapter.dispose();
      this._log(`Disposed adapter: ${this._adapter.id}`);
    }
    this._adapter = undefined;
    this._initialized = false;
  }

  // ============================================
  // Adapter Access
  // ============================================

  /**
   * Get the active adapter instance.
   */
  getAdapter(): PlatformAdapter | undefined {
    return this._adapter;
  }

  /**
   * Check if a specific capability is available.
   * @param cap - Capability key to check
   */
  hasCapability(cap: keyof AdapterCapabilities): boolean {
    return this._adapter?.capabilities[cap] === true;
  }

  // ============================================
  // Data Access (delegate to adapter)
  // ============================================

  /**
   * Get current theme.
   */
  getTheme(): 'light' | 'dark' {
    const adapter = this._ensureInitialized();
    return adapter.getTheme();
  }

  /**
   * Get current display mode.
   */
  getDisplayMode(): DisplayMode {
    const adapter = this._ensureInitialized();
    return adapter.getDisplayMode();
  }

  /**
   * Get tool input arguments.
   */
  getToolInput(): Record<string, unknown> {
    const adapter = this._ensureInitialized();
    return adapter.getToolInput();
  }

  /**
   * Get tool output/result.
   */
  getToolOutput(): unknown {
    const adapter = this._ensureInitialized();
    return adapter.getToolOutput();
  }

  /**
   * Get structured content (parsed output).
   */
  getStructuredContent(): unknown {
    const adapter = this._ensureInitialized();
    return adapter.getStructuredContent();
  }

  /**
   * Get persisted widget state.
   */
  getWidgetState(): Record<string, unknown> {
    const adapter = this._ensureInitialized();
    return adapter.getWidgetState();
  }

  /**
   * Get full host context.
   */
  getHostContext(): HostContext {
    const adapter = this._ensureInitialized();
    return adapter.getHostContext();
  }

  // ============================================
  // Actions (delegate to adapter)
  // ============================================

  /**
   * Call a tool on the MCP server.
   * @param name - Tool name
   * @param args - Tool arguments
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const adapter = this._ensureInitialized();
    if (!this.hasCapability('canCallTools')) {
      throw new Error('Tool calls are not supported by the current adapter');
    }
    return adapter.callTool(name, args);
  }

  /**
   * Send a follow-up message to the conversation.
   * @param content - Message content
   */
  async sendMessage(content: string): Promise<void> {
    const adapter = this._ensureInitialized();
    if (!this.hasCapability('canSendMessages')) {
      throw new Error('Sending messages is not supported by the current adapter');
    }
    return adapter.sendMessage(content);
  }

  /**
   * Open an external link.
   * @param url - URL to open
   */
  async openLink(url: string): Promise<void> {
    const adapter = this._ensureInitialized();
    return adapter.openLink(url);
  }

  /**
   * Request a display mode change.
   * @param mode - Desired display mode
   */
  async requestDisplayMode(mode: DisplayMode): Promise<void> {
    const adapter = this._ensureInitialized();
    return adapter.requestDisplayMode(mode);
  }

  /**
   * Request widget close.
   */
  async requestClose(): Promise<void> {
    const adapter = this._ensureInitialized();
    return adapter.requestClose();
  }

  /**
   * Set widget state (persisted across sessions).
   * @param state - State object to persist
   */
  setWidgetState(state: Record<string, unknown>): void {
    const adapter = this._ensureInitialized();
    adapter.setWidgetState(state);
  }

  // ============================================
  // Events (delegate to adapter)
  // ============================================

  /**
   * Subscribe to host context changes.
   * @param callback - Called when context changes
   * @returns Unsubscribe function
   */
  onContextChange(callback: (changes: Partial<HostContext>) => void): () => void {
    const adapter = this._ensureInitialized();
    return adapter.onContextChange(callback);
  }

  /**
   * Subscribe to tool result updates.
   * @param callback - Called when tool result is received
   * @returns Unsubscribe function
   */
  onToolResult(callback: (result: unknown) => void): () => void {
    const adapter = this._ensureInitialized();
    return adapter.onToolResult(callback);
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Ensure the bridge is initialized before operations.
   * Returns the adapter for type-safe access.
   */
  private _ensureInitialized(): PlatformAdapter {
    if (!this._initialized || !this._adapter) {
      throw new Error('FrontMcpBridge is not initialized. Call initialize() first.');
    }
    return this._adapter;
  }

  /**
   * Wrap a promise with a timeout.
   */
  private _withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${ms}ms`));
      }, ms);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Emit a bridge event via CustomEvent.
   */
  private _emitEvent<T extends BridgeEventType>(type: T, payload: BridgeEventPayloads[T]): void {
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      try {
        const event = new CustomEvent(type, { detail: payload });
        window.dispatchEvent(event);
      } catch {
        // Ignore event dispatch errors
      }
    }
  }

  /**
   * Log debug message if debugging is enabled.
   */
  private _log(message: string): void {
    if (this._config.debug) {
      console.log(`[FrontMcpBridge] ${message}`);
    }
  }
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
export async function createBridge(config?: BridgeConfig, registry?: AdapterRegistry): Promise<FrontMcpBridge> {
  const bridge = new FrontMcpBridge(config, registry);
  await bridge.initialize();
  return bridge;
}

/**
 * Global bridge instance for singleton pattern.
 * Use with caution - prefer creating instances when possible.
 */
let _globalBridge: FrontMcpBridge | undefined;

/**
 * Get or create the global bridge instance.
 * Initializes automatically on first call.
 */
export async function getGlobalBridge(config?: BridgeConfig): Promise<FrontMcpBridge> {
  if (!_globalBridge) {
    _globalBridge = new FrontMcpBridge(config);
    await _globalBridge.initialize();
  }
  return _globalBridge;
}

/**
 * Reset the global bridge instance.
 * Useful for testing or when switching configurations.
 */
export function resetGlobalBridge(): void {
  if (_globalBridge) {
    _globalBridge.dispose();
    _globalBridge = undefined;
  }
}
