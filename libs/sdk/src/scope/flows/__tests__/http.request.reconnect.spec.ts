/**
 * @file http.request.reconnect.spec.ts
 * @description Tests for the reconnect behavior when a client sends
 * an initialize request with a terminated session ID (issue #280).
 *
 * These tests verify that:
 * - Non-initialize requests with terminated sessions still get 404
 * - Initialize requests with terminated sessions are allowed through
 *   with session references cleared so a fresh session is created
 */

import { ServerRequestTokens } from '../../../common';

describe('HTTP Request Flow - Reconnect with Terminated Session', () => {
  /**
   * Simulates the reconnect logic from http.request.flow.ts router stage.
   * This extracts the exact branching logic for isolated testing without
   * requiring the full flow framework infrastructure.
   */
  function simulateTerminatedSessionCheck(params: {
    isTerminated: boolean;
    requestBody: { method?: string } | undefined;
    authorization: { session?: { id: string; payload?: { protocol?: string } } };
    requestHeaders: Record<string, string>;
  }): {
    action: 'allowed' | 'blocked-404';
    sessionCleared: boolean;
    headerCleared: boolean;
    sessionIdTokenCleared: boolean;
  } {
    const { isTerminated, requestBody, authorization, requestHeaders } = params;
    const request: Record<string | symbol, unknown> = {
      headers: requestHeaders,
      body: requestBody,
    };

    if (authorization.session) {
      request[ServerRequestTokens.sessionId] = authorization.session.id;

      if (isTerminated) {
        const body = requestBody as { method?: string } | undefined;
        if (body?.method === 'initialize') {
          // Reconnect path: clear session references
          authorization.session = undefined;
          delete request[ServerRequestTokens.sessionId];
          delete (request['headers'] as Record<string, string>)['mcp-session-id'];
          return {
            action: 'allowed',
            sessionCleared: authorization.session === undefined,
            headerCleared: !('mcp-session-id' in (request['headers'] as Record<string, string>)),
            sessionIdTokenCleared: !(ServerRequestTokens.sessionId in request),
          };
        } else {
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

  describe('terminated session + initialize (reconnect)', () => {
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

    it('should clear authorization.session on reconnect', () => {
      const authorization: { session?: { id: string; payload?: { protocol?: string } } } = {
        session: { id: 'terminated-session-id-12345', payload: { protocol: 'streamable-http' } },
      };

      simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: { method: 'initialize' },
        authorization,
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
      });

      expect(authorization.session).toBeUndefined();
    });

    it('should clear mcp-session-id header on reconnect', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: { method: 'initialize' },
        authorization: {
          session: { id: 'terminated-session-id-12345' },
        },
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
      });

      expect(result.headerCleared).toBe(true);
    });

    it('should clear ServerRequestTokens.sessionId on reconnect', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: { method: 'initialize' },
        authorization: {
          session: { id: 'terminated-session-id-12345' },
        },
        requestHeaders: { 'mcp-session-id': 'terminated-session-id-12345' },
      });

      expect(result.sessionIdTokenCleared).toBe(true);
    });
  });

  describe('terminated session + non-initialize (blocked)', () => {
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

    it('should return 404 for tools/call with terminated session', () => {
      const result = simulateTerminatedSessionCheck({
        isTerminated: true,
        requestBody: { method: 'tools/call' },
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
