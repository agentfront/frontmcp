// file: libs/browser/src/host/app-child.ts
/**
 * App Child implementation for embedded MCP applications.
 */

import type { AppChild, AppChildOptions, AuthContext, HostMessage, ServerInfo } from './types';
import { AppChildError } from './types';

// =============================================================================
// App Child Implementation
// =============================================================================

class AppChildImpl implements AppChild {
  private _initialData?: unknown;
  private _authContext?: AuthContext;
  private _permissions: string[] = [];
  private _messageHandlers: Set<(type: string, payload: unknown) => void> = new Set();
  private _pendingPermissions: Map<string, { resolve: (granted: boolean) => void }> = new Map();
  private _isReady = false;

  constructor(private readonly options: AppChildOptions, private readonly serverInfo?: ServerInfo) {
    this.setupMessageListener();
  }

  private setupMessageListener(): void {
    window.addEventListener('message', this.handleMessage);
  }

  private handleMessage = (event: MessageEvent): void => {
    // Validate origin if specified
    if (
      this.options.allowedOrigins &&
      this.options.allowedOrigins.length > 0 &&
      !this.options.allowedOrigins.includes(event.origin)
    ) {
      return;
    }

    // Only accept messages from parent window
    if (event.source !== window.parent) {
      return;
    }

    const message = event.data as HostMessage;
    if (!message || typeof message !== 'object' || !message.type) {
      return;
    }

    switch (message.type) {
      case 'app:init':
        this._initialData = message.data;
        this._authContext = message.auth;
        this.options.onInitialData?.(message.data);
        break;

      case 'mcp:request':
        // MCP requests are handled by the transport layer
        break;

      case 'auth:refresh':
        if (message.token) {
          this._authContext = { ...this._authContext, token: message.token };
        }
        break;

      case 'custom':
        this.notifyMessageHandlers('custom', message.payload);
        break;

      case 'app:focus':
        this.notifyMessageHandlers('focus', undefined);
        break;

      case 'app:blur':
        this.notifyMessageHandlers('blur', undefined);
        break;
    }
  };

  private notifyMessageHandlers(type: string, payload: unknown): void {
    for (const handler of this._messageHandlers) {
      try {
        handler(type, payload);
      } catch (error) {
        console.error('[AppChild] Message handler error:', error);
        this.options.onError?.(new AppChildError(String(error)));
      }
    }
  }

  private sendToParent(message: unknown): void {
    if (!window.parent || window.parent === window) {
      console.warn('[AppChild] Not running in iframe, cannot send to parent');
      return;
    }

    const targetOrigin =
      this.options.allowedOrigins && this.options.allowedOrigins.length > 0 ? this.options.allowedOrigins[0] : '*';

    window.parent.postMessage(message, targetOrigin);
  }

  ready(): void {
    if (this._isReady) {
      return;
    }

    this._isReady = true;
    this.sendToParent({
      type: 'app:ready',
      serverInfo: this.serverInfo,
    });
  }

  getInitialData<T>(): T | undefined {
    return this._initialData as T | undefined;
  }

  getAuthContext(): AuthContext | undefined {
    return this._authContext;
  }

  postMessage(type: string, payload: unknown): void {
    this.sendToParent({
      type: 'custom',
      messageType: type,
      payload,
    });
  }

  onMessage(handler: (type: string, payload: unknown) => void): () => void {
    this._messageHandlers.add(handler);
    return () => this._messageHandlers.delete(handler);
  }

  async requestPermission(permission: string): Promise<boolean> {
    return new Promise((resolve) => {
      const id = `perm-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      this._pendingPermissions.set(id, { resolve });

      this.sendToParent({
        type: 'permission:request',
        id,
        permission,
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this._pendingPermissions.has(id)) {
          this._pendingPermissions.delete(id);
          resolve(false);
        }
      }, 30000);
    });
  }

  getPermissions(): string[] {
    return [...this._permissions];
  }

  /**
   * Notify parent of resize
   */
  notifyResize(width: number, height: number): void {
    this.sendToParent({
      type: 'app:resize',
      width,
      height,
    });
  }

  /**
   * Report an error to parent
   */
  reportError(error: string): void {
    this.sendToParent({
      type: 'app:error',
      error,
    });
  }

  /**
   * Send MCP response to parent
   */
  sendMcpResponse(id: string, result?: unknown, error?: unknown): void {
    this.sendToParent({
      type: 'mcp:response',
      id,
      result,
      error,
    });
  }

  /**
   * Send MCP notification to parent
   */
  sendMcpNotification(method: string, params?: unknown): void {
    this.sendToParent({
      type: 'mcp:notification',
      method,
      params,
    });
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    window.removeEventListener('message', this.handleMessage);
    this._messageHandlers.clear();
    this._pendingPermissions.clear();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an app child instance for embedded MCP applications.
 *
 * @example
 * ```typescript
 * import { createAppChild } from '@frontmcp/browser/host';
 *
 * const child = createAppChild({
 *   allowedOrigins: ['https://example.com'],
 *   onInitialData: (data) => console.log('Received:', data),
 * });
 *
 * // Signal that the app is ready
 * child.ready();
 *
 * // Get initial data passed from host
 * const config = child.getInitialData<AppConfig>();
 *
 * // Send messages to host
 * child.postMessage('status', { loaded: true });
 *
 * // Listen for messages from host
 * child.onMessage((type, payload) => {
 *   console.log('Message from host:', type, payload);
 * });
 * ```
 */
export function createAppChild(
  options: AppChildOptions = {},
  serverInfo?: ServerInfo,
): AppChild & {
  getAuthContext(): AuthContext | undefined;
  notifyResize(width: number, height: number): void;
  reportError(error: string): void;
  sendMcpResponse(id: string, result?: unknown, error?: unknown): void;
  sendMcpNotification(method: string, params?: unknown): void;
  destroy(): void;
} {
  return new AppChildImpl(options, serverInfo);
}
