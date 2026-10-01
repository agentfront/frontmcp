/**
 * Types for API client integration.
 */

/** Where an operation parameter goes in the request (the OpenAPI `in` field). */
export type ApiParameterLocation = 'path' | 'query' | 'header' | 'cookie';

/** An operation parameter: the argument `name` and where the request carries it. */
export interface ApiParameter {
  /** Argument name, as it appears in `inputSchema.properties`. */
  name: string;
  /**
   * `'query'` arguments are sent in the query string (an array repeats its key) and `'header'`
   * arguments as request headers. `'path'` arguments fill the `{name}` placeholders of `path`
   * (as every placeholder is filled); `'cookie'` arguments are not sent.
   */
  in: ApiParameterLocation;
}

export interface ApiOperation {
  /** Unique operation identifier (becomes part of the tool name). */
  operationId: string;
  /** Human-readable description for agents. */
  description: string;
  /** HTTP method (GET, POST, PUT, DELETE, PATCH). */
  method: string;
  /** URL path (may contain {param} placeholders). */
  path: string;
  /** JSON Schema for the operation's input. */
  inputSchema: Record<string, unknown>;
  /**
   * Where each argument goes. `parseOpenApiSpec` fills this from the spec's `parameters`. An
   * argument without an entry here is sent only when it is a `{param}` of `path` or the `body`.
   */
  parameters?: ApiParameter[];
}

/** Configuration for a single HTTP request. */
export interface HttpRequestConfig {
  /** HTTP method (GET, POST, PUT, DELETE, PATCH, etc.). */
  method: string;
  /** Fully resolved URL. */
  url: string;
  /** Request headers. */
  headers: Record<string, string>;
  /** Request body (will be serialized by the client). */
  body?: unknown;
}

/** Normalized HTTP response returned by an HttpClient. */
export interface HttpResponse {
  /** HTTP status code. */
  status: number;
  /** HTTP status text (optional). */
  statusText?: string;
  /** Parsed response data. */
  data: unknown;
}

/**
 * Generic HTTP client interface.
 *
 * Implement this to inject any HTTP library (axios, ky, got, custom wrappers
 * with token refresh, auth headers, interceptors, etc.).
 */
export interface HttpClient {
  request(config: HttpRequestConfig): Promise<HttpResponse>;
}

export interface ApiClientOptions {
  /** Base URL for all API requests. */
  baseUrl: string;
  /** Operations to register as MCP tools. */
  operations: ApiOperation[];
  /** Static headers or header factory function. */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Tool name prefix (default: 'api'). */
  prefix?: string;
  /** Inject any HTTP client (axios, ky, custom). Takes precedence over `fetch`. */
  client?: HttpClient;
  /** @deprecated Use `client` instead. Raw fetch fallback. */
  fetch?: typeof globalThis.fetch;
  /** Target a specific named server. */
  server?: string;
}
