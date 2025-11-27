/**
 * @file interceptor.types.ts
 * @description Types for request/response interception and mocking
 */

import type { JsonRpcRequest, JsonRpcResponse } from '../transport/transport.interface';

/**
 * Interceptor context passed to handler functions
 */
export interface InterceptorContext {
  /** The original request */
  request: JsonRpcRequest;
  /** Request metadata */
  meta: {
    /** Timestamp when request was made */
    timestamp: Date;
    /** Transport type being used */
    transport: string;
    /** Session ID if available */
    sessionId?: string;
  };
}

/**
 * Result of an interceptor - can modify, mock, or pass through
 */
export type InterceptorResult =
  | { action: 'passthrough' }
  | { action: 'modify'; request: JsonRpcRequest }
  | { action: 'mock'; response: JsonRpcResponse }
  | { action: 'error'; error: Error };

/**
 * Function signature for request interceptors
 */
export type RequestInterceptor = (ctx: InterceptorContext) => InterceptorResult | Promise<InterceptorResult>;

/**
 * Response interceptor context
 */
export interface ResponseInterceptorContext {
  /** The original request */
  request: JsonRpcRequest;
  /** The response from the server */
  response: JsonRpcResponse;
  /** Duration of the request in ms */
  durationMs: number;
}

/**
 * Response interceptor result
 */
export type ResponseInterceptorResult = { action: 'passthrough' } | { action: 'modify'; response: JsonRpcResponse };

/**
 * Function signature for response interceptors
 */
export type ResponseInterceptor = (
  ctx: ResponseInterceptorContext,
) => ResponseInterceptorResult | Promise<ResponseInterceptorResult>;

/**
 * Mock definition for a specific method
 */
export interface MockDefinition {
  /** Method name to mock (e.g., 'tools/call', 'resources/read') */
  method: string;
  /** Optional matcher for params - if provided, only matches when params match */
  params?: Record<string, unknown> | ((params: Record<string, unknown>) => boolean);
  /** The mock response to return */
  response: JsonRpcResponse | ((request: JsonRpcRequest) => JsonRpcResponse | Promise<JsonRpcResponse>);
  /** Number of times this mock should be used (default: Infinity) */
  times?: number;
  /** Delay in ms before returning the response (simulates latency) */
  delay?: number;
}

/**
 * Mock registry for managing active mocks
 */
export interface MockRegistry {
  /** Add a mock */
  add(mock: MockDefinition): MockHandle;
  /** Remove all mocks */
  clear(): void;
  /** Get all active mocks */
  getAll(): MockDefinition[];
  /** Check if a request matches any mock */
  match(request: JsonRpcRequest): MockDefinition | undefined;
}

/**
 * Handle returned when adding a mock - allows removal
 */
export interface MockHandle {
  /** Remove this specific mock */
  remove(): void;
  /** Check how many times this mock was called */
  callCount(): number;
  /** Get all calls made to this mock */
  calls(): JsonRpcRequest[];
}

/**
 * Interceptor chain configuration
 */
export interface InterceptorChain {
  /** Request interceptors (run before request) */
  request: RequestInterceptor[];
  /** Response interceptors (run after response) */
  response: ResponseInterceptor[];
  /** Mock registry */
  mocks: MockRegistry;

  /**
   * Process a request through the interceptor chain
   */
  processRequest(
    request: JsonRpcRequest,
    meta: InterceptorContext['meta'],
  ): Promise<
    | { type: 'continue'; request: JsonRpcRequest }
    | { type: 'mock'; response: JsonRpcResponse }
    | { type: 'error'; error: Error }
  >;

  /**
   * Process a response through the interceptor chain
   */
  processResponse(request: JsonRpcRequest, response: JsonRpcResponse, durationMs: number): Promise<JsonRpcResponse>;
}
