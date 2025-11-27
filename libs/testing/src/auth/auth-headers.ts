/**
 * @file auth-headers.ts
 * @description Helper functions for building authentication headers
 */

/**
 * Helper functions for building authentication headers
 */
export const AuthHeaders = {
  /**
   * Create Authorization header with Bearer token
   */
  bearer(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
    };
  },

  /**
   * Create headers with no authentication
   */
  noAuth(): Record<string, string> {
    return {};
  },

  /**
   * Create full MCP request headers with auth and session
   */
  mcpRequest(token: string, sessionId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };

    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }

    return headers;
  },

  /**
   * Create headers for public mode (no auth required)
   */
  publicMode(sessionId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }

    return headers;
  },

  /**
   * Create headers with custom auth header value
   */
  custom(headerName: string, headerValue: string): Record<string, string> {
    return {
      [headerName]: headerValue,
    };
  },
};
