/**
 * @file http-mock.types.ts
 * @description Types for HTTP request mocking (fetch/XHR interception)
 *
 * This module allows mocking HTTP requests made by tools during MCP server testing,
 * enabling fully offline testing of MCP servers.
 */

/**
 * HTTP method types
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Request matcher - defines which requests to intercept
 */
export interface HttpRequestMatcher {
  /** URL pattern - string for exact match, RegExp for pattern, or function for custom */
  url: string | RegExp | ((url: string) => boolean);
  /** HTTP method(s) to match (default: all methods) */
  method?: HttpMethod | HttpMethod[];
  /** Headers that must be present (partial match) */
  headers?: Record<string, string | RegExp>;
  /** Body matcher for POST/PUT/PATCH */
  body?: string | RegExp | Record<string, unknown> | ((body: unknown) => boolean);
}

/**
 * Mocked HTTP response
 */
export interface HttpMockResponse {
  /** HTTP status code (default: 200) */
  status?: number;
  /** Status text (default: 'OK') */
  statusText?: string;
  /** Response headers */
  headers?: Record<string, string>;
  /** Response body - string, object (will be JSON.stringify'd), or Buffer */
  body?: string | Record<string, unknown> | Buffer | ArrayBuffer;
  /** Delay before responding in ms */
  delay?: number;
}

/**
 * HTTP mock definition
 */
export interface HttpMockDefinition {
  /** Request matcher */
  match: HttpRequestMatcher;
  /** Response to return */
  response: HttpMockResponse | ((request: HttpRequestInfo) => HttpMockResponse | Promise<HttpMockResponse>);
  /** Number of times to use this mock (default: Infinity) */
  times?: number;
  /** Name for debugging/tracking */
  name?: string;
}

/**
 * Information about an intercepted HTTP request
 */
export interface HttpRequestInfo {
  /** Full URL */
  url: string;
  /** HTTP method */
  method: HttpMethod;
  /** Request headers */
  headers: Record<string, string>;
  /** Request body (parsed if JSON) */
  body?: unknown;
  /** Raw body string */
  rawBody?: string;
}

/**
 * Handle returned when adding an HTTP mock
 */
export interface HttpMockHandle {
  /** Remove this mock */
  remove(): void;
  /** Get call count */
  callCount(): number;
  /** Get all intercepted requests */
  calls(): HttpRequestInfo[];
  /** Wait for a specific number of calls */
  waitForCalls(count: number, timeoutMs?: number): Promise<HttpRequestInfo[]>;
}

/**
 * HTTP interceptor - controls when mocks are active
 */
export interface HttpInterceptor {
  /** Add an HTTP mock */
  mock(definition: HttpMockDefinition): HttpMockHandle;

  /** Convenience: mock a GET request */
  get(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle;

  /** Convenience: mock a POST request */
  post(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle;

  /** Convenience: mock a PUT request */
  put(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle;

  /** Convenience: mock a DELETE request */
  delete(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle;

  /** Convenience: mock any method */
  any(url: string | RegExp, response: HttpMockResponse | Record<string, unknown>): HttpMockHandle;

  /** Clear all mocks in this scope */
  clear(): void;

  /** Get all pending (unused) mocks */
  pending(): HttpMockDefinition[];

  /** Check if all mocks were used */
  isDone(): boolean;

  /** Assert all mocks were used (throws if not) */
  assertDone(): void;

  /** Enable passthrough for unmatched requests (default: false, throws error) */
  allowPassthrough(allow: boolean): void;

  /** Restore original fetch/XHR */
  restore(): void;
}

/**
 * Global HTTP mock manager
 */
export interface HttpMockManager {
  /** Create a new HTTP interceptor */
  interceptor(): HttpInterceptor;

  /** Enable HTTP mocking globally */
  enable(): void;

  /** Disable HTTP mocking and restore originals */
  disable(): void;

  /** Check if mocking is enabled */
  isEnabled(): boolean;

  /** Clear all scopes and mocks */
  clearAll(): void;
}
