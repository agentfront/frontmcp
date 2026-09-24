// common/types/options/outbound-fetch/interfaces.ts
// Explicit TypeScript interfaces for outbound `this.fetch()` configuration

/**
 * Controls what `this.fetch()` adds to requests a tool, resource or prompt sends upstream.
 *
 * The MCP authorization spec forbids passing the token a client sent to this server on to
 * other services, so the caller's token and its `x-frontmcp-*` headers are only sent to
 * the origins listed here.
 */
export interface OutboundFetchOptionsInterface {
  /**
   * Origins (for example `https://api.internal.example`) that may receive the caller's
   * MCP access token as `Authorization: Bearer …`. List only services that accept this
   * server's own tokens. Use `credentials: { provider }` for any other upstream.
   * @default []
   */
  forwardCallerTokenTo?: string[];

  /**
   * Origins that may receive the incoming request's `x-frontmcp-*` headers.
   * @default []
   */
  forwardCustomHeadersTo?: string[];

  /**
   * Add `traceparent` and `x-request-id` to outgoing requests.
   * @default true
   */
  autoInjectTracingHeaders?: boolean;

  /**
   * Timeout in milliseconds for requests that do not pass their own `signal`.
   * @default 30000
   */
  requestTimeout?: number;
}
