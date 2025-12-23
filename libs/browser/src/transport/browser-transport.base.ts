// file: libs/browser/src/transport/browser-transport.base.ts
/**
 * Browser-compatible transport adapter base class.
 *
 * This provides similar functionality to the SDK's TransportAdapterBase
 * but without requiring the full Scope dependency (which has Node.js dependencies).
 *
 * Browser transports can extend this class to get:
 * - Connection state management
 * - Request/response correlation
 * - Session management
 * - Pending request handling
 */

import { generateUUID } from '@frontmcp/sdk/core';
import type {
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCNotification,
  BrowserConnectionState,
} from './transport.interface';
import type { PlatformLogger } from '../platform';

/**
 * Options for browser transport adapter
 */
export interface BrowserTransportBaseOptions {
  /** Session ID for this transport connection */
  sessionId?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom logger (uses console by default) */
  logger?: PlatformLogger;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
}

/**
 * Type guard for JSON-RPC request
 */
export function isJSONRPCRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return 'method' in message && 'id' in message;
}

/**
 * Type guard for JSON-RPC response
 */
export function isJSONRPCResponse(message: JSONRPCMessage): message is JSONRPCResponse {
  return ('result' in message || 'error' in message) && 'id' in message && !('method' in message);
}

/**
 * Type guard for JSON-RPC notification
 */
export function isJSONRPCNotification(message: JSONRPCMessage): message is JSONRPCNotification {
  return 'method' in message && !('id' in message);
}

/**
 * Console-based logger for browser
 */
const consoleLogger: PlatformLogger = {
  debug: (message, ...args) => console.debug(`[BrowserTransport] ${message}`, ...args),
  info: (message, ...args) => console.info(`[BrowserTransport] ${message}`, ...args),
  warn: (message, ...args) => console.warn(`[BrowserTransport] ${message}`, ...args),
  error: (message, ...args) => console.error(`[BrowserTransport] ${message}`, ...args),
  verbose: (message, ...args) => console.debug(`[BrowserTransport:verbose] ${message}`, ...args),
};

/**
 * Browser-compatible transport adapter base class.
 *
 * @example Creating a custom browser transport
 * ```typescript
 * class MyTransport extends BrowserTransportAdapterBase {
 *   async connect(): Promise<void> {
 *     // Connect to your transport
 *     await this.onConnect();
 *   }
 *
 *   async send(message: JSONRPCMessage): Promise<void> {
 *     // Send message
 *   }
 *
 *   async destroy(reason?: string): Promise<void> {
 *     // Cleanup
 *     await this.onDestroy(reason);
 *   }
 * }
 * ```
 */
export abstract class BrowserTransportAdapterBase {
  protected readonly logger: PlatformLogger;
  protected readonly sessionId: string;
  protected connectionState: BrowserConnectionState = 'disconnected';
  protected readonly requestTimeout: number;
  protected pendingRequests = new Map<
    string | number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  private requestIdCounter = 1;
  private readonly debug: boolean;

  constructor(options: BrowserTransportBaseOptions = {}) {
    this.sessionId = options.sessionId ?? generateUUID();
    this.debug = options.debug ?? false;
    this.logger = options.logger ?? consoleLogger;
    this.requestTimeout = options.requestTimeout ?? 30000;
  }

  /**
   * Get connection state
   */
  get state(): BrowserConnectionState {
    return this.connectionState;
  }

  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.connectionState === 'connected';
  }

  /**
   * Get session ID for this transport
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Generate a new request ID
   */
  protected getNextRequestId(): number {
    return this.requestIdCounter++;
  }

  /**
   * Connect the transport.
   * Subclasses must implement connection logic.
   */
  abstract connect(): Promise<void>;

  /**
   * Send a message through the transport.
   * Subclasses must implement the actual send mechanism.
   */
  abstract send(message: JSONRPCMessage): Promise<void>;

  /**
   * Destroy the transport and clean up resources.
   * Subclasses must implement cleanup logic.
   */
  abstract destroy(reason?: string): Promise<void>;

  /**
   * Called when connection is established.
   * Subclasses can override to add connection setup.
   */
  protected async onConnect(): Promise<void> {
    this.connectionState = 'connected';
    if (this.debug) {
      this.logger.debug('Transport connected', { sessionId: this.sessionId });
    }
  }

  /**
   * Called when transport is being destroyed.
   * Rejects all pending requests and cleans up state.
   */
  protected async onDestroy(reason?: string): Promise<void> {
    this.connectionState = 'disconnected';

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason ?? 'Transport closed'));
      this.pendingRequests.delete(id);
    }

    if (this.debug) {
      this.logger.debug('Transport destroyed', { sessionId: this.sessionId, reason });
    }
  }

  /**
   * Handle incoming message from transport.
   * Routes to appropriate handler based on message type.
   */
  protected handleMessage(message: JSONRPCMessage): void {
    if (isJSONRPCResponse(message)) {
      this.handleResponse(message);
    } else if (isJSONRPCRequest(message)) {
      this.handleRequest(message);
    } else if (isJSONRPCNotification(message)) {
      this.handleNotification(message);
    }
  }

  /**
   * Handle JSON-RPC response (correlate with pending request)
   */
  protected handleResponse(response: JSONRPCResponse): void {
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
   * Handle JSON-RPC request.
   * Override in subclass to process incoming requests.
   */
  protected handleRequest(_request: JSONRPCRequest): void {
    // Default implementation - subclasses can override
    if (this.debug) {
      this.logger.debug('Received request', { method: _request.method, id: _request.id });
    }
  }

  /**
   * Handle JSON-RPC notification.
   * Override in subclass to process incoming notifications.
   */
  protected handleNotification(_notification: JSONRPCNotification): void {
    // Default implementation - subclasses can override
    if (this.debug) {
      this.logger.debug('Received notification', { method: _notification.method });
    }
  }

  /**
   * Send a request and wait for response.
   *
   * @param method - JSON-RPC method name
   * @param params - Method parameters
   * @param timeoutMs - Request timeout in milliseconds (uses default if not specified)
   * @returns Promise resolving to response result
   */
  async request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.isConnected) {
      throw new Error('Transport not connected');
    }

    const timeout = timeoutMs ?? this.requestTimeout;
    const id = this.getNextRequestId();
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
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout: timeoutHandle,
      });

      this.send(message).catch((err) => {
        clearTimeout(timeoutHandle);
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  /**
   * Send a notification (no response expected)
   *
   * @param method - JSON-RPC method name
   * @param params - Method parameters
   */
  async notify(method: string, params?: unknown): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Transport not connected');
    }

    const message: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    await this.send(message);
  }

  /**
   * Ping the transport to check connection health.
   *
   * @param timeoutMs - Ping timeout in milliseconds (default: 10000)
   * @returns true if ping successful, false otherwise
   */
  async ping(timeoutMs = 10000): Promise<boolean> {
    try {
      await this.request('ping', undefined, timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get pending request count (useful for debugging)
   */
  get pendingRequestCount(): number {
    return this.pendingRequests.size;
  }
}
