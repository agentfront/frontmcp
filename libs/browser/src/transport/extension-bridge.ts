// file: libs/browser/src/transport/extension-bridge.ts
/**
 * Extension Bridge for Message Routing
 *
 * Routes MCP messages between web pages and Chrome extension background scripts.
 * This enables web applications to use MCP tools provided by browser extensions
 * like Claude Desktop's browser extension.
 *
 * @example Page-side setup (inject via content script)
 * ```typescript
 * import { ExtensionBridge } from '@frontmcp/browser';
 *
 * const bridge = new ExtensionBridge({
 *   mode: 'page',
 *   extensionId: 'your-extension-id',
 * });
 *
 * await bridge.connect();
 *
 * // Now page can use MCP tools
 * const result = await bridge.request('tools/call', { name: 'search', arguments: { query: 'test' } });
 * ```
 *
 * @example Content script setup
 * ```typescript
 * import { ExtensionBridge } from '@frontmcp/browser';
 *
 * const bridge = new ExtensionBridge({
 *   mode: 'content-script',
 * });
 *
 * await bridge.connect();
 * // Bridge automatically forwards messages between page and background
 * ```
 */

import { generateUUID } from '@frontmcp/sdk/core';
import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, JSONRPCNotification } from './transport.interface';
import type { PlatformLogger } from '../platform';

/**
 * Bridge mode
 */
export type BridgeMode = 'page' | 'content-script' | 'background';

/**
 * Bridge message type for custom events
 */
export interface BridgeMessage {
  type: 'frontmcp:request' | 'frontmcp:response' | 'frontmcp:notification';
  payload: JSONRPCMessage;
  tabId?: number;
  frameId?: number;
  timestamp: number;
}

/**
 * Extension bridge options
 */
export interface ExtensionBridgeOptions {
  /**
   * Bridge mode:
   * - 'page': Running in web page, communicates via custom events
   * - 'content-script': Running in content script, bridges page <-> background
   * - 'background': Running in background script, receives routed messages
   */
  mode: BridgeMode;

  /**
   * Custom event name prefix
   * @default 'frontmcp'
   */
  eventPrefix?: string;

  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean;

  /**
   * Custom logger
   */
  logger?: PlatformLogger;

  /**
   * Allowed origins for page mode
   * @default ['*'] (all origins in development)
   */
  allowedOrigins?: string[];

  /**
   * Target extension ID for external messaging
   */
  extensionId?: string;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  requestTimeout?: number;
}

/**
 * Default console logger
 */
const defaultLogger: PlatformLogger = {
  debug: (message, ...args) => console.debug(`[ExtensionBridge] ${message}`, ...args),
  info: (message, ...args) => console.info(`[ExtensionBridge] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[ExtensionBridge] ${message}`, ...args),
  error: (message, ...args) => console.error(`[ExtensionBridge] ${message}`, ...args),
  verbose: (message, ...args) => console.debug(`[ExtensionBridge:verbose] ${message}`, ...args),
};

/**
 * Extension Bridge for MCP message routing
 */
export class ExtensionBridge {
  private readonly mode: BridgeMode;
  private readonly eventPrefix: string;
  private readonly debug: boolean;
  private readonly logger: PlatformLogger;
  private readonly allowedOrigins: string[];
  private readonly requestTimeout: number;

  private isConnected = false;
  private requestIdCounter = 1;
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  // Event handlers for cleanup
  private customEventHandler: ((event: Event) => void) | null = null;
  private messageHandlers: Array<(message: JSONRPCMessage) => void | Promise<void>> = [];

  constructor(options: ExtensionBridgeOptions) {
    this.mode = options.mode;
    this.eventPrefix = options.eventPrefix ?? 'frontmcp';
    this.debug = options.debug ?? false;
    this.logger = options.logger ?? defaultLogger;
    this.allowedOrigins = options.allowedOrigins ?? ['*'];
    this.requestTimeout = options.requestTimeout ?? 30000;
  }

  /**
   * Check if bridge is connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get event name for requests
   */
  private get requestEventName(): string {
    return `${this.eventPrefix}:request`;
  }

  /**
   * Get event name for responses
   */
  private get responseEventName(): string {
    return `${this.eventPrefix}:response`;
  }

  /**
   * Get event name for notifications
   */
  private get notificationEventName(): string {
    return `${this.eventPrefix}:notification`;
  }

  /**
   * Connect the bridge
   */
  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    if (this.mode === 'page') {
      await this.connectAsPage();
    } else if (this.mode === 'content-script') {
      await this.connectAsContentScript();
    } else if (this.mode === 'background') {
      await this.connectAsBackground();
    }

    this.isConnected = true;

    if (this.debug) {
      this.logger.debug('Bridge connected', { mode: this.mode });
    }
  }

  /**
   * Connect in page mode
   */
  private async connectAsPage(): Promise<void> {
    // Listen for responses from content script
    this.customEventHandler = (event: Event) => {
      const customEvent = event as CustomEvent<BridgeMessage>;
      const data = customEvent.detail;

      if (!this.isValidBridgeMessage(data)) {
        return;
      }

      if (data.type === 'frontmcp:response') {
        this.handleResponse(data.payload as JSONRPCResponse);
      } else if (data.type === 'frontmcp:notification') {
        this.handleNotification(data.payload as JSONRPCNotification);
      }
    };

    window.addEventListener(this.responseEventName, this.customEventHandler);
    window.addEventListener(this.notificationEventName, this.customEventHandler);
  }

  /**
   * Connect in content script mode
   */
  private async connectAsContentScript(): Promise<void> {
    // Listen for requests from page
    this.customEventHandler = (event: Event) => {
      const customEvent = event as CustomEvent<BridgeMessage>;
      const data = customEvent.detail;

      if (!this.isValidBridgeMessage(data)) {
        return;
      }

      // Forward to message handlers (which should route to background)
      if (data.type === 'frontmcp:request') {
        for (const handler of this.messageHandlers) {
          try {
            handler(data.payload);
          } catch (err) {
            this.logger.error('Message handler error', err);
          }
        }
      }
    };

    window.addEventListener(this.requestEventName, this.customEventHandler);
  }

  /**
   * Connect in background mode
   */
  private async connectAsBackground(): Promise<void> {
    // Background mode doesn't need event listeners
    // Messages come through ExtensionServerTransport
  }

  /**
   * Validate bridge message
   */
  private isValidBridgeMessage(data: unknown): data is BridgeMessage {
    if (!data || typeof data !== 'object') {
      return false;
    }
    const msg = data as Record<string, unknown>;
    return (
      typeof msg['type'] === 'string' &&
      msg['type'].startsWith('frontmcp:') &&
      msg['payload'] !== undefined &&
      typeof msg['timestamp'] === 'number'
    );
  }

  /**
   * Handle incoming response
   */
  private handleResponse(response: JSONRPCResponse): void {
    const pending = this.pendingRequests.get(response.id!);
    if (!pending) {
      if (this.debug) {
        this.logger.warn('Received response for unknown request', { id: response.id });
      }
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id!);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Handle incoming notification
   */
  private handleNotification(notification: JSONRPCNotification): void {
    for (const handler of this.messageHandlers) {
      try {
        handler(notification);
      } catch (err) {
        this.logger.error('Notification handler error', err);
      }
    }
  }

  /**
   * Send a request and wait for response
   */
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.isConnected) {
      throw new Error('Bridge not connected');
    }

    const id = this.requestIdCounter++;
    const message: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.requestTimeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout: timeoutHandle,
      });

      this.dispatchMessage('request', message);
    });
  }

  /**
   * Send a notification (no response expected)
   */
  notify(method: string, params?: unknown): void {
    if (!this.isConnected) {
      throw new Error('Bridge not connected');
    }

    const message: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    this.dispatchMessage('notification', message);
  }

  /**
   * Dispatch message to appropriate target
   */
  private dispatchMessage(type: 'request' | 'response' | 'notification', payload: JSONRPCMessage): void {
    const bridgeMessage: BridgeMessage = {
      type: `frontmcp:${type}`,
      payload,
      timestamp: Date.now(),
    };

    if (this.mode === 'page') {
      // Dispatch custom event to content script
      const eventName = type === 'request' ? this.requestEventName : this.notificationEventName;
      const event = new CustomEvent(eventName, {
        detail: bridgeMessage,
        bubbles: false,
        cancelable: false,
      });
      window.dispatchEvent(event);
    } else if (this.mode === 'content-script') {
      // Dispatch custom event to page
      const eventName = type === 'response' ? this.responseEventName : this.notificationEventName;
      const event = new CustomEvent(eventName, {
        detail: bridgeMessage,
        bubbles: false,
        cancelable: false,
      });
      window.dispatchEvent(event);
    }
  }

  /**
   * Send response back (for content-script/background modes)
   */
  respond(request: JSONRPCRequest, result: unknown): void {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: request.id,
      result,
    };

    this.dispatchMessage('response', response);
  }

  /**
   * Send error response back
   */
  respondError(request: JSONRPCRequest, code: number, message: string, data?: unknown): void {
    const response: JSONRPCResponse = {
      jsonrpc: '2.0',
      id: request.id,
      error: { code, message, data },
    };

    this.dispatchMessage('response', response);
  }

  /**
   * Register a message handler
   */
  onMessage(handler: (message: JSONRPCMessage) => void | Promise<void>): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index >= 0) {
        this.messageHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Disconnect the bridge
   */
  disconnect(): void {
    // Remove event listeners
    if (this.customEventHandler) {
      if (this.mode === 'page') {
        window.removeEventListener(this.responseEventName, this.customEventHandler);
        window.removeEventListener(this.notificationEventName, this.customEventHandler);
      } else if (this.mode === 'content-script') {
        window.removeEventListener(this.requestEventName, this.customEventHandler);
      }
      this.customEventHandler = null;
    }

    // Reject pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Bridge disconnected'));
      this.pendingRequests.delete(id);
    }

    this.messageHandlers = [];
    this.isConnected = false;

    if (this.debug) {
      this.logger.debug('Bridge disconnected');
    }
  }
}

/**
 * Create a bridge instance for the current context
 */
export function createExtensionBridge(options: ExtensionBridgeOptions): ExtensionBridge {
  return new ExtensionBridge(options);
}

/**
 * Detect the current context and create appropriate bridge
 */
export function detectAndCreateBridge(options: Omit<ExtensionBridgeOptions, 'mode'> = {}): ExtensionBridge {
  let mode: BridgeMode;

  // Detect context
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    // In extension context
    if (typeof window !== 'undefined' && window === window.top) {
      // Background script (service worker or background page)
      mode = 'background';
    } else {
      // Content script
      mode = 'content-script';
    }
  } else {
    // Regular web page
    mode = 'page';
  }

  return new ExtensionBridge({ ...options, mode });
}

// Chrome types for detection
declare const chrome: {
  runtime?: {
    id?: string;
  };
};
