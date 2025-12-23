// file: libs/sdk/src/transport/adapters/transport.base.adapter.ts
/**
 * Base class for all transport adapters.
 *
 * This abstract class defines the common interface for transport adapters
 * that can be used in both Node.js (HTTP/SSE) and browser (EventEmitter/postMessage)
 * environments.
 *
 * HTTP transports extend LocalTransportAdapter (which builds on this pattern).
 * Browser transports extend this class directly with EventEmitter or postMessage.
 */

import { FrontMcpLogger } from '../../common';
import { Scope } from '../../scope';
import { generateUUID } from '../../utils/platform-crypto';

/**
 * JSON-RPC message types for MCP communication
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

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
 * Handler for incoming messages
 */
export type MessageHandler = (message: JSONRPCMessage) => void;

/**
 * Connection state for transport adapters
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Options for transport adapter base
 */
export interface TransportAdapterBaseOptions {
  /** Session ID for this transport connection */
  sessionId?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Base class for transport adapters.
 *
 * Provides common functionality for all transport types:
 * - Connection state management
 * - Logging infrastructure
 * - Request/response correlation
 * - Session management
 *
 * @example Extending for browser EventEmitter transport
 * ```typescript
 * class EventTransportAdapter extends TransportAdapterBase {
 *   constructor(scope: Scope, private emitter: EventEmitter) {
 *     super(scope);
 *   }
 *
 *   async connect(): Promise<void> {
 *     this.emitter.on('mcp:request', this.handleMessage.bind(this));
 *     await this.onConnect();
 *   }
 *
 *   async send(message: JSONRPCMessage): Promise<void> {
 *     this.emitter.emit('mcp:response', message);
 *   }
 *
 *   async destroy(reason?: string): Promise<void> {
 *     this.emitter.removeAllListeners('mcp:request');
 *     await this.onDestroy(reason);
 *   }
 * }
 * ```
 */
export abstract class TransportAdapterBase {
  protected readonly logger: FrontMcpLogger;
  protected readonly sessionId: string;
  protected connectionState: ConnectionState = 'disconnected';
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

  constructor(protected readonly scope: Scope, options: TransportAdapterBaseOptions = {}) {
    this.sessionId = options.sessionId ?? generateUUID();
    this.debug = options.debug ?? false;
    this.logger = scope.logger.child('TransportAdapterBase');
  }

  /**
   * Get connection state
   */
  get state(): ConnectionState {
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
  protected handleRequest(request: JSONRPCRequest): void {
    // Default implementation - subclasses can override
    if (this.debug) {
      this.logger.debug('Received request', { method: request.method, id: request.id });
    }
  }

  /**
   * Handle JSON-RPC notification.
   * Override in subclass to process incoming notifications.
   */
  protected handleNotification(notification: JSONRPCNotification): void {
    // Default implementation - subclasses can override
    if (this.debug) {
      this.logger.debug('Received notification', { method: notification.method });
    }
  }

  /**
   * Send a request and wait for response.
   *
   * @param method - JSON-RPC method name
   * @param params - Method parameters
   * @param timeoutMs - Request timeout in milliseconds (default: 30000)
   * @returns Promise resolving to response result
   */
  async request<T = unknown>(method: string, params?: unknown, timeoutMs = 30000): Promise<T> {
    if (!this.isConnected) {
      throw new Error('Transport not connected');
    }

    const id = this.getNextRequestId();
    const message: JSONRPCRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });

      this.send(message).catch((err) => {
        clearTimeout(timeout);
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
}
