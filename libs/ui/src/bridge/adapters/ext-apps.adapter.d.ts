/**
 * ext-apps (SEP-1865) Platform Adapter
 *
 * Implements the MCP Apps Extension protocol (SEP-1865) for embedded
 * widget communication with AI hosts via JSON-RPC 2.0 over postMessage.
 *
 * @see https://github.com/modelcontextprotocol/ext-apps
 * @packageDocumentation
 */
import type { DisplayMode, AdapterConfig } from '../types';
import { BaseAdapter } from './base-adapter';
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
export declare class ExtAppsAdapter extends BaseAdapter {
  readonly id = 'ext-apps';
  readonly name = 'ext-apps (SEP-1865)';
  readonly priority = 80;
  private _config;
  private _messageListener;
  private _pendingRequests;
  private _requestId;
  private _trustedOrigin;
  private _hostCapabilities;
  constructor(config?: ExtAppsAdapterConfig);
  /**
   * Check if we're in an iframe (potential ext-apps context).
   */
  canHandle(): boolean;
  /**
   * Initialize the ext-apps adapter with protocol handshake.
   */
  initialize(): Promise<void>;
  /**
   * Dispose adapter resources.
   */
  dispose(): void;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  sendMessage(content: string): Promise<void>;
  openLink(url: string): Promise<void>;
  requestDisplayMode(mode: DisplayMode): Promise<void>;
  requestClose(): Promise<void>;
  /**
   * Setup postMessage listener for incoming messages.
   */
  private _setupMessageListener;
  /**
   * Handle incoming postMessage events.
   */
  private _handleMessage;
  /**
   * Handle JSON-RPC response.
   */
  private _handleResponse;
  /**
   * Handle JSON-RPC notification from host.
   */
  private _handleNotification;
  /**
   * Handle tool input notification.
   */
  private _handleToolInput;
  /**
   * Handle partial tool input (streaming).
   */
  private _handleToolInputPartial;
  /**
   * Handle tool result notification.
   */
  private _handleToolResult;
  /**
   * Handle host context change notification.
   */
  private _handleHostContextChange;
  /**
   * Handle cancellation notification.
   */
  private _handleCancelled;
  /**
   * Send a JSON-RPC request to the host.
   */
  private _sendRequest;
  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private _sendNotification;
  /**
   * Post a message to the parent window.
   */
  private _postMessage;
  /**
   * Perform the ui/initialize handshake with the host.
   */
  private _performHandshake;
  /**
   * Check if an origin is trusted.
   * Uses trust-on-first-use if no explicit origins configured.
   */
  private _isOriginTrusted;
  /**
   * Emit a bridge event via CustomEvent.
   */
  private _emitBridgeEvent;
}
/**
 * Factory function for creating ext-apps adapter instances.
 */
export declare function createExtAppsAdapter(config?: ExtAppsAdapterConfig): ExtAppsAdapter;
//# sourceMappingURL=ext-apps.adapter.d.ts.map
