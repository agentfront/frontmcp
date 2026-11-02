import { InternalMcpError, MCP_ERROR_CODES, PublicMcpError } from './mcp.error';

/** Thrown at boot for a route the server cannot serve: a bad path, a duplicate, or people auth that is not set up. */
export class InvalidHttpRouteError extends InternalMcpError {
  constructor(method: string, path: string, reason: string) {
    super(`HTTP route ${method} ${path}: ${reason}`, 'INVALID_HTTP_ROUTE');
  }
}

/** A route with people auth was called without a signed-in session. */
export class PersonNotSignedInError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.UNAUTHORIZED;

  constructor() {
    super(
      'Please sign in: open the one-time sign-in link the server gives you (POST /_frontmcp/people/code with its token).',
      'PERSON_NOT_SIGNED_IN',
      401,
    );
  }
}

/** A POST, PUT, PATCH or DELETE came from a page of another origin. */
export class CrossOriginRequestError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.FORBIDDEN;

  constructor() {
    super('Cross-origin requests may not change anything here.', 'CROSS_ORIGIN_REQUEST', 403);
  }
}

/** A wrong, used or expired sign-in token or code. */
export class SignInRefusedError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.UNAUTHORIZED;

  constructor() {
    super('The sign-in token or code is not valid; codes work once and expire.', 'SIGN_IN_REFUSED', 401);
  }
}

/** Too many wrong sign-in tokens or codes from one client. */
export class SignInLockedError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.FORBIDDEN;

  constructor() {
    super('Too many failed sign-in attempts; wait a minute and try again.', 'SIGN_IN_LOCKED', 429);
  }
}
