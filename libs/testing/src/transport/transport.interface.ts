/**
 * @file transport.interface.ts
 * @description Interface for MCP transport implementations
 */

// Simplified JSON-RPC types for transport layer
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Interface that all MCP transports must implement
 */
export interface McpTransport {
  /**
   * Connect to the MCP server
   */
  connect(): Promise<void>;

  /**
   * Send a JSON-RPC request and wait for response
   */
  request<T = unknown>(message: JsonRpcRequest): Promise<JsonRpcResponse & { result?: T }>;

  /**
   * Send a notification (no response expected)
   */
  notify(message: JsonRpcRequest): Promise<void>;

  /**
   * Send raw string data (for error testing)
   */
  sendRaw(data: string): Promise<JsonRpcResponse>;

  /**
   * Close the connection
   */
  close(): Promise<void>;

  /**
   * Check if transport is connected
   */
  isConnected(): boolean;

  /**
   * Get current transport state
   */
  getState(): TransportState;

  /**
   * Get the session ID (if applicable)
   */
  getSessionId(): string | undefined;

  /**
   * Set the authentication token
   */
  setAuthToken(token: string): void;

  /**
   * Set the request timeout
   */
  setTimeout(ms: number): void;

  // Optional methods for testing

  /**
   * Get the message endpoint URL (SSE transport)
   */
  getMessageEndpoint?(): string | undefined;

  /**
   * Get number of connections made
   */
  getConnectionCount?(): number;

  /**
   * Get number of reconnections
   */
  getReconnectCount?(): number;

  /**
   * Get the headers from the last request
   */
  getLastRequestHeaders?(): Record<string, string>;

  /**
   * Simulate a disconnect (for testing reconnection)
   */
  simulateDisconnect?(): Promise<void>;

  /**
   * Wait for reconnection to complete
   */
  waitForReconnect?(timeoutMs: number): Promise<void>;

  /**
   * Set interceptor chain for request/response interception
   */
  setInterceptors?(interceptors: import('../interceptor').InterceptorChain): void;

  /**
   * Get the current interceptor chain
   */
  getInterceptors?(): import('../interceptor').InterceptorChain | undefined;
}

/**
 * Configuration for transport implementations
 */
export interface TransportConfig {
  /** Base URL of the MCP server */
  baseUrl: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Authentication configuration */
  auth?: {
    token?: string;
    headers?: Record<string, string>;
  };
  /**
   * Enable public mode - skip authentication entirely.
   * When true, no Authorization header is sent and anonymous token is not requested.
   * Use this for testing public/unauthenticated endpoints in CI/CD pipelines.
   */
  publicMode?: boolean;
  /** Enable debug logging */
  debug?: boolean;
  /** Interceptor chain for request/response interception */
  interceptors?: import('../interceptor').InterceptorChain;
}
