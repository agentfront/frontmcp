// common/types/options/http/interfaces.ts
// Explicit TypeScript interfaces for HTTP configuration

import { type FrontMcpServer } from '../../../interfaces';

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
   * - `undefined` (default): permissive CORS enabled (all origins, no credentials)
   * - `false`: CORS disabled entirely
   * - `CorsOptions`: custom CORS configuration
   */
  cors?: CorsOptions | false;

  /**
   * Security configuration for transport hardening.
   * These options are opt-in — defaults remain backwards-compatible.
   * Set `strict: true` to enable all security features at once.
   */
  security?: SecurityOptions;
}

/**
 * Security options for transport hardening.
 */
export interface SecurityOptions {
  /**
   * Enable strict security defaults.
   * When true: loopback binding (standalone), restrictive CORS, DNS rebinding protection.
   * @default false
   */
  strict?: boolean;

  /**
   * Network bind address override.
   * - `'loopback'`: bind to 127.0.0.1 (local access only)
   * - `'all'`: bind to 0.0.0.0 (all interfaces)
   * - string: specific IP address
   *
   * Default (no strict): '0.0.0.0' (backwards compatible)
   * Default (strict, standalone): '127.0.0.1'
   * Default (strict, distributed): '0.0.0.0'
   */
  bindAddress?: 'loopback' | 'all' | string;

  /**
   * DNS rebinding protection configuration.
   * When enabled, validates Host and Origin headers on incoming requests.
   */
  dnsRebindingProtection?: {
    /** Enable host/origin header validation. @default false */
    enabled?: boolean;
    /** Allowed Host header values (e.g., ['localhost:3001', 'api.example.com']) */
    allowedHosts?: string[];
    /** Allowed Origin header values (e.g., ['https://app.example.com']) */
    allowedOrigins?: string[];
  };
}
