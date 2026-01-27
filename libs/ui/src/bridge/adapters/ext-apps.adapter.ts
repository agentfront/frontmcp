/**
 * ext-apps (SEP-1865) Platform Adapter
 *
 * Implements the MCP Apps Extension protocol (SEP-1865) for embedded
 * widget communication with AI hosts via JSON-RPC 2.0 over postMessage.
 *
 * @see https://github.com/modelcontextprotocol/ext-apps
 * @packageDocumentation
 */

import type {
  DisplayMode,
  HostContext,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  ExtAppsInitializeParams,
  ExtAppsInitializeResult,
  ExtAppsToolInputParams,
  ExtAppsToolResultParams,
  ExtAppsHostContextChangeParams,
  AdapterConfig,
} from '../types';
import { BaseAdapter, DEFAULT_CAPABILITIES } from './base-adapter';

/**
 * Configuration options for ext-apps adapter.
 */
export interface ExtAppsAdapterConfig extends AdapterConfig {
  options?: {
    /** Trusted origins for postMessage security (trust-on-first-use if not specified) */
    trustedOrigins?: string[];
    /** Application name for handshake */
    appName?: string;
    /** Application version for handshake */
    appVersion?: string;
    /** Protocol version (defaults to '2024-11-05') */
    protocolVersion?: string;
    /** Timeout for initialization handshake (ms) */
    initTimeout?: number;
  };
}

/**
 * ext-apps (SEP-1865) adapter.
 *
 * Provides communication between embedded widgets and AI hosts using
 * the standardized JSON-RPC 2.0 over postMessage protocol.
 *
 * @example
 * ```typescript
 * import { ExtAppsAdapter } from '@frontmcp/ui/bridge';
 *
 * const adapter = new ExtAppsAdapter({
 *   options: {
 *     trustedOrigins: ['https://claude.ai'],
 *   }
 * });
 * if (adapter.canHandle()) {
 *   await adapter.initialize();
 * }
 * ```
 */
export class ExtAppsAdapter extends BaseAdapter {
  readonly id = 'ext-apps';
  readonly name = 'ext-apps (SEP-1865)';
  readonly priority = 80; // High priority, but below OpenAI native

  private _config: ExtAppsAdapterConfig;
  private _messageListener: ((event: MessageEvent) => void) | undefined;
  private _pendingRequests: Map<
    string | number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private _requestId = 0;
  private _trustedOrigin: string | undefined;
  private _originTrustPending = false; // Guard against race condition in trust-on-first-use
  private _hostCapabilities: ExtAppsInitializeResult['hostCapabilities'] = {};

  constructor(config?: ExtAppsAdapterConfig) {
    super();
    this._config = config || {};

    // Start with minimal capabilities, updated after handshake
    this._capabilities = {
      ...DEFAULT_CAPABILITIES,
      canPersistState: true,
      hasNetworkAccess: true, // ext-apps usually allows network
      supportsTheme: true,
    };
  }

  /**
   * Check if we're in an iframe with explicit ext-apps context.
   *
   * This adapter requires explicit ext-apps markers to avoid incorrectly
   * matching other iframe-based platforms (e.g., Claude legacy artifacts).
   *
   * Claude MCP Apps (2026+) uses the ext-apps protocol - detected via
   * __mcpAppsEnabled flag, which takes precedence over legacy Claude markers.
   */
  canHandle(): boolean {
    if (typeof window === 'undefined') return false;

    // Check if we're in an iframe
    const inIframe = window.parent !== window;
    if (!inIframe) return false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;

    // Check we're not already detected as OpenAI
    if (win.openai?.canvas) return false;
    if (win.openai && typeof win.openai.callTool === 'function') return false;

    // Explicit ext-apps marker
    if (win.__mcpPlatform === 'ext-apps') return true;

    // ext-apps initialization flag (set by handshake)
    if (win.__extAppsInitialized) return true;

    // Claude MCP Apps mode (2026+) - uses ext-apps protocol
    // See: https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
    if (win.__mcpAppsEnabled) return true;

    // Legacy Claude detection - defer to Claude adapter
    if (win.claude) return false;
    if (win.__claudeArtifact) return false;
    if (win.__mcpPlatform === 'claude') return false;
    if (typeof location !== 'undefined') {
      try {
        const url = new URL(location.href);
        const hostname = url.hostname.toLowerCase();
        const isClaudeHost = hostname === 'claude.ai' || hostname.endsWith('.claude.ai');
        const isAnthropicHost = hostname === 'anthropic.com' || hostname.endsWith('.anthropic.com');
        if (isClaudeHost || isAnthropicHost) return false;
      } catch {
        // If URL parsing fails, fall through to other checks
      }
    }

    // Do NOT default to true for any iframe
    return false;
  }

  /**
   * Initialize the ext-apps adapter with protocol handshake.
   */
  override async initialize(): Promise<void> {
    if (this._initialized) return;

    // Setup message listener
    this._setupMessageListener();

    try {
      // Call base initialization
      await super.initialize();

      // Perform ui/initialize handshake
      await this._performHandshake();

      this._initialized = true;
    } catch (error) {
      // Clean up message listener on failure to prevent memory leak
      if (this._messageListener && typeof window !== 'undefined') {
        window.removeEventListener('message', this._messageListener);
        this._messageListener = undefined;
      }
      throw error;
    }
  }

  /**
   * Dispose adapter resources.
   */
  override dispose(): void {
    // Remove message listener
    if (this._messageListener && typeof window !== 'undefined') {
      window.removeEventListener('message', this._messageListener);
      this._messageListener = undefined;
    }

    // Reject all pending requests
    for (const [_id, pending] of this._pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Adapter disposed'));
    }
    this._pendingRequests.clear();

    super.dispose();
  }

  // ============================================
  // Actions (via JSON-RPC)
  // ============================================

  override async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this._hostCapabilities.serverToolProxy) {
      throw new ExtAppsNotSupportedError('Server tool proxy not supported by host');
    }

    return this._sendRequest('ui/callServerTool', {
      name,
      arguments: args,
    });
  }

  override async sendMessage(content: string): Promise<void> {
    await this._sendRequest('ui/message', { content });
  }

  override async openLink(url: string): Promise<void> {
    if (!this._hostCapabilities.openLink) {
      // Fallback to window.open
      return super.openLink(url);
    }

    await this._sendRequest('ui/openLink', { url });
  }

  override async requestDisplayMode(mode: DisplayMode): Promise<void> {
    await this._sendRequest('ui/setDisplayMode', { mode });
    this._hostContext = { ...this._hostContext, displayMode: mode };
  }

  override async requestClose(): Promise<void> {
    await this._sendRequest('ui/close', {});
  }

  // ============================================
  // Extended ext-apps Methods (Full Specification)
  // ============================================

  /**
   * Update the model context with widget state.
   *
   * This allows the widget to pass contextual information to the model,
   * which can be used to inform subsequent interactions.
   *
   * @param context - The context data to update
   * @param merge - Whether to merge with existing context (default: true)
   */
  async updateModelContext(context: unknown, merge = true): Promise<void> {
    if (!this._hostCapabilities.modelContextUpdate) {
      throw new ExtAppsNotSupportedError('Model context update not supported by host');
    }

    await this._sendRequest('ui/updateModelContext', { context, merge });
  }

  /**
   * Send a log message to the host.
   *
   * Allows the widget to forward log messages to the host for debugging
   * or monitoring purposes.
   *
   * @param level - Log level (debug, info, warn, error)
   * @param message - Log message
   * @param data - Optional additional data
   */
  async log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): Promise<void> {
    if (!this._hostCapabilities.logging) {
      // Fallback to console logging if host doesn't support it
      const logFn = console[level] || console.log;
      logFn(`[Widget] ${message}`, data);
      return;
    }

    await this._sendRequest('ui/log', { level, message, data });
  }

  /**
   * Register a widget-defined tool.
   *
   * Allows the widget to dynamically register tools that can be
   * invoked by the model or user.
   *
   * @param name - Tool name
   * @param description - Tool description
   * @param inputSchema - Tool input schema (JSON Schema format)
   */
  async registerTool(name: string, description: string, inputSchema: Record<string, unknown>): Promise<void> {
    if (!this._hostCapabilities.widgetTools) {
      throw new ExtAppsNotSupportedError('Widget tool registration not supported by host');
    }

    await this._sendRequest('ui/registerTool', { name, description, inputSchema });
  }

  /**
   * Unregister a widget-defined tool.
   *
   * Removes a previously registered tool.
   *
   * @param name - Tool name to unregister
   */
  async unregisterTool(name: string): Promise<void> {
    if (!this._hostCapabilities.widgetTools) {
      throw new ExtAppsNotSupportedError('Widget tool unregistration not supported by host');
    }

    await this._sendRequest('ui/unregisterTool', { name });
  }

  // ============================================
  // Private: Message Handling
  // ============================================

  /**
   * Setup postMessage listener for incoming messages.
   */
  private _setupMessageListener(): void {
    if (typeof window === 'undefined') return;

    this._messageListener = (event: MessageEvent) => {
      this._handleMessage(event);
    };

    window.addEventListener('message', this._messageListener);
  }

  /**
   * Handle incoming postMessage events.
   */
  private _handleMessage(event: MessageEvent): void {
    // Validate origin
    if (!this._isOriginTrusted(event.origin)) {
      return;
    }

    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.jsonrpc !== '2.0') return;

    // Handle response to our request
    if ('id' in data && (data.result !== undefined || data.error !== undefined)) {
      this._handleResponse(data as JsonRpcResponse);
      return;
    }

    // Handle notification from host
    if ('method' in data && !('id' in data)) {
      this._handleNotification(data as JsonRpcNotification);
      return;
    }
  }

  /**
   * Handle JSON-RPC response.
   */
  private _handleResponse(response: JsonRpcResponse): void {
    const pending = this._pendingRequests.get(response.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this._pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(`${response.error.message} (code: ${response.error.code})`));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Handle JSON-RPC notification from host.
   */
  private _handleNotification(notification: JsonRpcNotification): void {
    switch (notification.method) {
      case 'ui/notifications/tool-input':
        this._handleToolInput(notification.params as ExtAppsToolInputParams);
        break;

      case 'ui/notifications/tool-input-partial':
        this._handleToolInputPartial(notification.params as ExtAppsToolInputParams);
        break;

      case 'ui/notifications/tool-result':
        this._handleToolResult(notification.params as ExtAppsToolResultParams);
        break;

      case 'ui/notifications/host-context-changed':
        this._handleHostContextChange(notification.params as ExtAppsHostContextChangeParams);
        break;

      case 'ui/notifications/initialized':
        // Host confirms initialization complete
        break;

      case 'ui/notifications/cancelled':
        this._handleCancelled(notification.params);
        break;
    }
  }

  /**
   * Handle tool input notification.
   */
  private _handleToolInput(params: ExtAppsToolInputParams): void {
    this._toolInput = params.arguments || {};

    // Emit tool:input event
    this._emitBridgeEvent('tool:input', { arguments: this._toolInput });
  }

  /**
   * Handle partial tool input (streaming).
   */
  private _handleToolInputPartial(params: ExtAppsToolInputParams): void {
    this._toolInput = { ...this._toolInput, ...(params.arguments || {}) };

    // Emit tool:input-partial event
    this._emitBridgeEvent('tool:input-partial', { arguments: this._toolInput });
  }

  /**
   * Handle tool result notification.
   */
  private _handleToolResult(params: ExtAppsToolResultParams): void {
    this._toolOutput = params.content;
    this._structuredContent = params.structuredContent;

    // Notify listeners
    this._notifyToolResult(params.content);

    // Emit tool:result event
    this._emitBridgeEvent('tool:result', {
      content: params.content,
      structuredContent: params.structuredContent,
    });
  }

  /**
   * Handle host context change notification.
   */
  private _handleHostContextChange(params: ExtAppsHostContextChangeParams): void {
    const changes: Partial<HostContext> = {};

    if (params.theme !== undefined) {
      changes.theme = params.theme;
    }
    if (params.displayMode !== undefined) {
      changes.displayMode = params.displayMode;
    }
    if (params.viewport !== undefined) {
      changes.viewport = params.viewport;
    }
    if (params.locale !== undefined) {
      changes.locale = params.locale;
    }
    if (params.timezone !== undefined) {
      changes.timezone = params.timezone;
    }

    this._notifyContextChange(changes);
  }

  /**
   * Handle cancellation notification.
   */
  private _handleCancelled(params: unknown): void {
    const reason = (params as { reason?: string })?.reason;
    this._emitBridgeEvent('tool:cancelled', { reason });
  }

  // ============================================
  // Private: JSON-RPC Transport
  // ============================================

  /**
   * Send a JSON-RPC request to the host.
   */
  private _sendRequest(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this._requestId;
      const timeout = this._config.options?.initTimeout || 10000;

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timeoutHandle = setTimeout(() => {
        this._pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeout}ms`));
      }, timeout);

      this._pendingRequests.set(id, {
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      this._postMessage(request);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private _sendNotification(method: string, params?: unknown): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this._postMessage(notification);
  }

  /**
   * Post a message to the parent window.
   */
  private _postMessage(message: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification): void {
    if (typeof window === 'undefined') return;

    const targetOrigin = this._trustedOrigin || '*';
    window.parent.postMessage(message, targetOrigin);
  }

  // ============================================
  // Private: Handshake
  // ============================================

  /**
   * Validate that the handshake response has the expected structure.
   */
  private _isValidInitializeResult(result: unknown): result is ExtAppsInitializeResult {
    if (!result || typeof result !== 'object') return false;

    const r = result as Record<string, unknown>;

    // hostCapabilities is optional but must be an object if present
    if (
      r['hostCapabilities'] !== undefined &&
      (typeof r['hostCapabilities'] !== 'object' || r['hostCapabilities'] === null)
    ) {
      return false;
    }

    // hostContext is optional but must be an object if present
    if (r['hostContext'] !== undefined && (typeof r['hostContext'] !== 'object' || r['hostContext'] === null)) {
      return false;
    }

    return true;
  }

  /**
   * Perform the ui/initialize handshake with the host.
   */
  private async _performHandshake(): Promise<void> {
    const params: ExtAppsInitializeParams = {
      appInfo: {
        name: this._config.options?.appName || 'FrontMCP Widget',
        version: this._config.options?.appVersion || '1.0.0',
      },
      appCapabilities: {
        tools: {
          listChanged: false,
        },
      },
      protocolVersion: this._config.options?.protocolVersion || '2024-11-05',
    };

    try {
      const rawResult = await this._sendRequest('ui/initialize', params);

      // Validate response structure
      if (!this._isValidInitializeResult(rawResult)) {
        throw new Error('Invalid ui/initialize response structure');
      }

      const result = rawResult;

      // Store host capabilities
      this._hostCapabilities = result.hostCapabilities || {};

      // Update adapter capabilities based on host
      this._capabilities = {
        ...this._capabilities,
        canCallTools: Boolean(this._hostCapabilities.serverToolProxy),
        canSendMessages: true,
        canOpenLinks: Boolean(this._hostCapabilities.openLink),
        supportsDisplayModes: true,
      };

      // Update host context
      if (result.hostContext) {
        this._hostContext = {
          ...this._hostContext,
          ...result.hostContext,
        };
      }

      // Trust the origin that successfully completed handshake
      // (trust-on-first-use if no explicit trusted origins)
      if (!this._config.options?.trustedOrigins?.length) {
        // Origin is already set from first successful message
      }
    } catch (error) {
      throw new Error(`ext-apps handshake failed: ${error}`);
    }
  }

  // ============================================
  // Private: Origin Security
  // ============================================

  /**
   * Check if an origin is trusted.
   * Uses trust-on-first-use if no explicit origins configured.
   *
   * Security note: Trust-on-first-use has inherent risks. For production,
   * always configure explicit trustedOrigins in adapter config.
   */
  private _isOriginTrusted(origin: string): boolean {
    // Explicit trusted origins from config (preferred for security)
    const trustedOrigins = this._config.options?.trustedOrigins;
    if (trustedOrigins && trustedOrigins.length > 0) {
      return trustedOrigins.includes(origin);
    }

    // Trust-on-first-use: trust the first origin we receive from
    // Use a guard flag to prevent race condition where multiple
    // messages arrive simultaneously before _trustedOrigin is set
    if (!this._trustedOrigin) {
      // Check if another message is already establishing trust
      if (this._originTrustPending) {
        // Another message is in the process of establishing trust
        // Reject this message to prevent race condition
        return false;
      }

      // Mark that we're establishing trust
      this._originTrustPending = true;
      this._trustedOrigin = origin;
      this._originTrustPending = false; // Reset after successful trust establishment
      return true;
    }

    return this._trustedOrigin === origin;
  }

  // ============================================
  // Private: Events
  // ============================================

  /**
   * Emit a bridge event via CustomEvent.
   */
  private _emitBridgeEvent(type: string, detail: unknown): void {
    if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
      try {
        const event = new CustomEvent(type, { detail });
        window.dispatchEvent(event);
      } catch {
        // Ignore event dispatch errors
      }
    }
  }
}

/**
 * Factory function for creating ext-apps adapter instances.
 */
export function createExtAppsAdapter(config?: ExtAppsAdapterConfig): ExtAppsAdapter {
  return new ExtAppsAdapter(config);
}

/**
 * Error thrown when a feature is not supported by the host.
 */
export class ExtAppsNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtAppsNotSupportedError';
  }
}
