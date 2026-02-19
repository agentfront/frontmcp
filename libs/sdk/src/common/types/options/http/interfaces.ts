// common/types/options/http/interfaces.ts
// Explicit TypeScript interfaces for HTTP configuration

import { FrontMcpServer } from '../../../interfaces';

/**
 * Framework-agnostic CORS configuration options.
 */
export interface CorsOptions {
  /**
   * Allowed origins. Can be:
   * - `true` to reflect the request origin (allows all origins with credentials)
   * - A string for a single origin
   * - An array of strings for multiple origins
   * - A function that dynamically determines if an origin is allowed
   */
  origin?:
    | boolean
    | string
    | string[]
    | ((origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void);

  /**
   * Whether to allow credentials (cookies, authorization headers).
   * @default false
   */
  credentials?: boolean;

  /**
   * How long preflight results can be cached (in seconds).
   */
  maxAge?: number;
}

/**
 * HTTP server configuration options.
 */
export interface HttpOptionsInterface {
  /**
   * Port number to listen on.
   * @default 3001
   */
  port?: number;

  /**
   * MCP JSON-RPC entry path ('' or '/mcp').
   * MUST match PRM resourcePath returned in well-known.
   * @default ''
   */
  entryPath?: string;

  /**
   * Custom host factory to provide HTTP server implementation.
   * Can be a FrontMcpServer instance or a factory function.
   */
  hostFactory?: FrontMcpServer | ((config: HttpOptionsInterface) => FrontMcpServer);

  /**
   * Unix socket path for local-only server mode.
   * When set, the server listens on a Unix socket instead of a TCP port.
   * The entire HTTP feature set (streamable HTTP, SSE, elicitation, sessions)
   * works unchanged over Unix sockets.
   */
  socketPath?: string;

  /**
   * CORS configuration.
   * - `undefined` (default): permissive CORS enabled (all origins, credentials allowed)
   * - `false`: CORS disabled entirely
   * - `CorsOptions`: custom CORS configuration
   */
  cors?: CorsOptions | false;
}
