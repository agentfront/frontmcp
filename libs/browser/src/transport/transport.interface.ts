// file: libs/browser/src/transport/transport.interface.ts
/**
 * Browser transport interfaces.
 *
 * These interfaces define the contracts for browser-specific transport
 * implementations that extend the SDK's TransportAdapterBase.
 */

import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, JSONRPCNotification } from '@frontmcp/sdk/core';

// Re-export JSON-RPC types for convenience
export type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, JSONRPCNotification };

/**
 * Minimal EventEmitter interface for browser environments.
 *
 * This is a subset of Node.js EventEmitter that can be implemented
 * in browsers without any Node.js dependencies.
 */
export interface MinimalEventEmitter {
  /**
   * Register an event listener.
   *
   * @param event - The event name
   * @param listener - The listener function
   * @returns The emitter for chaining
   */
  on(event: string, listener: (...args: unknown[]) => void): this;

  /**
   * Remove an event listener.
   *
   * @param event - The event name
   * @param listener - The listener function to remove
   * @returns The emitter for chaining
   */
  off(event: string, listener: (...args: unknown[]) => void): this;

  /**
   * Emit an event.
   *
   * @param event - The event name
   * @param args - Arguments to pass to listeners
   * @returns True if listeners were called
   */
  emit(event: string, ...args: unknown[]): boolean;

  /**
   * Register a one-time event listener.
   *
   * @param event - The event name
   * @param listener - The listener function
   * @returns The emitter for chaining
   */
  once?(event: string, listener: (...args: unknown[]) => void): this;

  /**
   * Remove all listeners for an event.
   *
   * @param event - The event name (optional)
   * @returns The emitter for chaining
   */
  removeAllListeners?(event?: string): this;
}

/**
 * Handler function type for processing incoming messages.
 */
export type BrowserMessageHandler = (message: JSONRPCMessage) => Promise<JSONRPCResponse | void>;

/**
 * Transport connection state.
 */
export type BrowserConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Browser transport interface.
 *
 * This extends the SDK's TransportAdapterBase pattern for browser-specific
 * implementations like EventEmitter and postMessage transports.
 */
export interface BrowserTransport {
  /**
   * Current connection state.
   */
  readonly connectionState: BrowserConnectionState;

  /**
   * Connect the transport.
   *
   * @returns Promise that resolves when connected
   */
  connect(): Promise<void>;

  /**
   * Send a JSON-RPC message.
   *
   * @param message - The message to send
   * @returns Promise that resolves when sent
   */
  send(message: JSONRPCMessage): Promise<void>;

  /**
   * Destroy the transport and clean up resources.
   *
   * @param reason - Optional reason for destruction
   */
  destroy(reason?: string): void;

  /**
   * Register a message handler.
   *
   * @param handler - The handler function
   * @returns Unsubscribe function
   */
  onMessage(handler: BrowserMessageHandler): () => void;

  /**
   * Register an error handler.
   *
   * @param handler - The error handler function
   * @returns Unsubscribe function
   */
  onError(handler: (error: Error) => void): () => void;

  /**
   * Register a close handler.
   *
   * @param handler - The close handler function
   * @returns Unsubscribe function
   */
  onClose(handler: (reason?: string) => void): () => void;
}

/**
 * Request transport for making RPC calls.
 *
 * This is used by client-side code to make requests to an MCP server.
 */
export interface RequestTransport {
  /**
   * Send a request and wait for a response.
   *
   * @param request - The JSON-RPC request
   * @param timeout - Optional timeout in milliseconds
   * @returns Promise resolving to the response
   */
  request<R = unknown>(request: JSONRPCRequest, timeout?: number): Promise<JSONRPCResponse & { result?: R }>;

  /**
   * Send a notification (no response expected).
   *
   * @param notification - The JSON-RPC notification
   */
  notify(notification: JSONRPCNotification): Promise<void>;
}

/**
 * PostMessage transport options.
 */
export interface PostMessageTransportOptions {
  /**
   * Allowed origin patterns for incoming messages.
   * Use '*' to allow any origin (not recommended for production).
   */
  allowedOrigins?: (string | RegExp)[];

  /**
   * Custom message type for filtering.
   * Default: 'mcp:message'
   */
  messageType?: string;

  /**
   * Target origin for outgoing messages.
   * Default: '*' (any origin)
   */
  targetOrigin?: string;
}

/**
 * Event transport options.
 */
export interface EventTransportOptions {
  /**
   * Event name for sending messages.
   * Default: 'mcp:response'
   */
  sendEvent?: string;

  /**
   * Event name for receiving messages.
   * Default: 'mcp:request'
   */
  receiveEvent?: string;
}

/**
 * PostMessage target types.
 */
export type PostMessageTarget = Window | Worker | MessagePort | ServiceWorker;

/**
 * Helper type for distinguishing Worker types.
 */
export interface WorkerLike {
  postMessage(message: unknown, options?: StructuredSerializeOptions): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
