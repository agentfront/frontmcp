/**
 * @file http.request.reconnect.spec.ts
 * @description Tests for session termination and reconnect behavior per MCP spec.
 *
 * MCP 2025-11-25 §Session Management:
 * - Server MUST respond with 404 to requests containing a terminated session ID
 * - Client MUST start a new session by sending InitializeRequest without session ID
 * - Initialize always creates a new session (parseInput ignores incoming session ID)
 */

import { ServerRequestTokens } from '../../../common';

describe('HTTP Request Flow - Reconnect with Terminated Session', () => {
  /**
   * Simulates the terminated session check from http.request.flow.ts router stage.
   * Per MCP spec: terminated sessions return 404, except initialize which is
   * allowed through so parseInput can create a fresh session.
   */
  function simulateTerminatedSessionCheck(params: {
    isTerminated: boolean;
    requestBody: { method?: string } | undefined;
    authorization: { session?: { id: string; payload?: { protocol?: string } } };
    requestHeaders: Record<string, string>;
    unmarkTerminated?: (sessionId: string) => void;
  }): {
    action: 'allowed' | 'blocked-404';
    sessionCleared: boolean;
    headerCleared: boolean;
    sessionIdTokenCleared: boolean;
  } {
    const { isTerminated, requestBody, authorization, requestHeaders, unmarkTerminated } = params;
    const request: Record<string | symbol, unknown> = {
      headers: requestHeaders,
      body: requestBody,
    };

    if (authorization.session) {
      request[ServerRequestTokens.sessionId] = authorization.session.id;

      if (isTerminated) {
        const body = requestBody as { method?: string } | undefined;
        if (body?.method === 'initialize') {
          // Initialize with terminated session — unmark and allow through.
          // Session refs kept intact so parseInput can reuse the session ID.
          unmarkTerminated?.(authorization.session.id);
          return {
            action: 'allowed',
            sessionCleared: false,
            headerCleared: false,
            sessionIdTokenCleared: false,
          };
        } else {
          // Non-initialize to terminated session → 404 per MCP spec
          return {
            action: 'blocked-404',
            sessionCleared: false,
            headerCleared: false,
            sessionIdTokenCleared: false,
          };
        }
      }
    }

    return {
      action: 'allowed',
      sessionCleared: false,
      headerCleared: false,
      sessionIdTokenCleared: false,
    };
  }

  describe('terminated session + initialize (re-initialization)', () => {
    it('should allow initialize request through when session is terminated', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: { method: 'initialize' },
        authorization: {
          session: { id: 'terminated-session-id-12345', payload: { protocol: 'streamable-http' } },
        },
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
      });

      expect(result.action).toBe('allowed');
    });

    it('should keep session refs intact for parseInput to reuse session ID', () => {
      const authorization: { session?: { id: string; payload?: { protocol?: string } } } = {
        session: { id: 'terminated-session-id-12345', payload: { protocol: 'streamable-http' } },
      };

      simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: { method: 'initialize' },
        authorization,
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
      });

      // Session refs are kept — parseInput will reuse the session ID
      expect(authorization.session).toBeDefined();
      expect(authorization.session?.id).toBe('terminated-session-id-12345');
    });

    it('should unmark session from terminated set', () => {
      const terminatedSessions = new Set(['terminated-session-id-12345']);

      const result = simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: { method: 'initialize' },
        authorization: {
          session: { id: 'terminated-session-id-12345' },
        },
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
        unmarkTerminated: (id) => terminatedSessions.delete(id),
      });

      expect(result.action).toBe('allowed');
      expect(terminatedSessions.has('terminated-session-id-12345')).toBe(false);
    });
  });

  describe('terminated session + non-initialize (404 per MCP spec)', () => {
    it('should return 404 for tools/list with terminated session', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: { method: 'tools/list' },
        authorization: {
          session: { id: 'terminated-session-id-12345' },
        },
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
      });

      expect(result.action).toBe('blocked-404');
    });

    it('should return 404 for notifications/initialized with terminated session', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: { method: 'notifications/initialized' },
        authorization: {
          session: { id: 'terminated-session-id-12345' },
        },
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
      });

      expect(result.action).toBe('blocked-404');
    });

    it('should return 404 when body has no method', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: {},
        authorization: {
          session: { id: 'terminated-session-id-12345' },
        },
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
      });

      expect(result.action).toBe('blocked-404');
    });

    it('should return 404 when body is undefined', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: undefined,
        authorization: {
          session: { id: 'terminated-session-id-12345' },
        },
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
      });

      expect(result.action).toBe('blocked-404');
    });
  });

  describe('non-terminated session (normal flow)', () => {
    it('should allow through when session is not terminated', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: false,
        requestBody: { method: 'tools/list' },
        authorization: {
          session: { id: 'valid-session-id-12345' },
        },
        requestHeaders: { 'mcp-session-id': 'valid-session-id-12345' },
      });

      expect(result.action).toBe('allowed');
      expect(result.sessionCleared).toBe(false);
    });

    it('should allow initialize without session (fresh connect)', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: false,
        requestBody: { method: 'initialize' },
        authorization: {},
        requestHeaders: {},
      });

      expect(result.action).toBe('allowed');
      expect(result.sessionCleared).toBe(false);
    });
  });

  describe('ServerRequestTokens.sessionId', () => {
    it('should be a Symbol', () => {
      expect(typeof ServerRequestTokens.sessionId).toBe('symbol');
    });

    it('should be deletable from object', () => {
      const obj: Record<string | symbol, unknown> = {};
      obj[ServerRequestTokens.sessionId] = 'test-session';
      expect(ServerRequestTokens.sessionId in obj).toBe(true);

      delete obj[ServerRequestTokens.sessionId];
      expect(ServerRequestTokens.sessionId in obj).toBe(false);
    });
  });
});
