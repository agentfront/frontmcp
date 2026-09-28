/**
 * Session-scoped storage used by a caller that has no per-caller identity.
 */

import { MCP_ERROR_CODES, PublicMcpError } from './mcp.error';

/**
 * Thrown when session-scoped storage (`this.secureStore` with `scope: 'session'`) is used by a
 * request that has neither a session the server verified nor a signed-in caller.
 *
 * Such a request has nothing a later request could be matched against: under MCP 2026-07-28 and
 * on the stateless transports its `mcp-session-id` is whatever the client sent, and an anonymous
 * subject is made up for the request. Failing is the point; the alternative is storage keyed by an
 * id any caller can name.
 *
 * Mapped to JSON-RPC -32003 (FORBIDDEN).
 */
export class SessionIdentityRequiredError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.FORBIDDEN;

  constructor(what = 'Session-scoped storage') {
    super(
      `${what} needs a verified session or a signed-in caller. Authenticate the request, or use a ` +
        'session transport (an MCP revision before 2026-07-28).',
      'SESSION_IDENTITY_REQUIRED',
      403,
    );
  }
}
