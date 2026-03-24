/**
 * Tests for the parseInput stage helpers of HandleStreamableHttpFlow.
 *
 * Validates session resolution priority:
 * 1. mcp-session-id header (client reconnect)
 * 2. authorization.session (from auth verification)
 * 3. Create new session (fresh initialize)
 */

import { ServerRequestTokens } from '../../../common';
import { resolveStreamableHttpSession, syncStreamableHttpAuthorizationSession } from '../handle.streamable-http.flow';

describe('HandleStreamableHttpFlow - parseInput session resolution', () => {
  describe('fresh initialize (no header, no auth session)', () => {
    it('should create new session when neither header nor auth session exist', () => {
      const result = resolveStreamableHttpSession({
        rawHeader: undefined,
        authorizationSession: undefined,
        createSession: () => ({ id: 'new-session-placeholder' }),
      });

      expect(result.createdNew).toBe(true);
      expect(result.responded404).toBe(false);
      expect(result.session).toEqual({ id: 'new-session-placeholder' });
    });
  });

  describe('reconnect with mcp-session-id header', () => {
    it('should use auth session when header matches auth session ID', () => {
      const authSession = {
        id: 'session-abc',
        payload: {
          protocol: 'streamable-http' as const,
          nodeId: 'n1',
          authSig: 's1',
          uuid: '11111111-1111-1111-1111-111111111111',
          iat: 123,
        },
      };

      const result = resolveStreamableHttpSession({
        rawHeader: 'session-abc',
        authorizationSession: authSession,
        createSession: () => ({ id: 'unused' }),
      });

      expect(result.session).toBe(authSession);
      expect(result.session?.payload).toBeDefined();
      expect(result.createdNew).toBe(false);
    });

    it('should use header ID without payload when header differs from auth session', () => {
      const authSession = { id: 'old-session', payload: { protocol: 'streamable-http' as const } };

      const result = resolveStreamableHttpSession({
        rawHeader: 'reconnect-session-xyz',
        authorizationSession: authSession,
        createSession: () => ({ id: 'unused' }),
      });

      expect(result.session?.id).toBe('reconnect-session-xyz');
      expect(result.session?.payload).toBeUndefined();
      expect(result.createdNew).toBe(false);
    });

    it('should use header ID when auth session is undefined', () => {
      const result = resolveStreamableHttpSession({
        rawHeader: 'client-session-id',
        authorizationSession: undefined,
        createSession: () => ({ id: 'unused' }),
      });

      expect(result.session?.id).toBe('client-session-id');
      expect(result.session?.payload).toBeUndefined();
      expect(result.createdNew).toBe(false);
    });
  });

  describe('auth session without header', () => {
    it('should use auth session when no header is provided', () => {
      const authSession = { id: 'auth-session', payload: { protocol: 'streamable-http' as const } };

      const result = resolveStreamableHttpSession({
        rawHeader: undefined,
        authorizationSession: authSession,
        createSession: () => ({ id: 'unused' }),
      });

      expect(result.session).toBe(authSession);
      expect(result.createdNew).toBe(false);
    });
  });

  describe('invalid header format', () => {
    const createSession = () => ({ id: 'unused' });

    it('should respond 404 for header with null byte', () => {
      const result = resolveStreamableHttpSession({ rawHeader: 'abc\x00def', createSession });
      expect(result.responded404).toBe(true);
      expect(result.session).toBeUndefined();
    });

    it('should respond 404 for header exceeding max length', () => {
      const result = resolveStreamableHttpSession({ rawHeader: 'a'.repeat(2049), createSession });
      expect(result.responded404).toBe(true);
    });

    it('should respond 404 for header with leading whitespace', () => {
      const result = resolveStreamableHttpSession({ rawHeader: ' leading-space', createSession });
      expect(result.responded404).toBe(true);
    });

    it('should respond 404 for header with trailing whitespace', () => {
      const result = resolveStreamableHttpSession({ rawHeader: 'trailing-space ', createSession });
      expect(result.responded404).toBe(true);
    });

    it('should respond 404 for header with non-ASCII characters', () => {
      const result = resolveStreamableHttpSession({ rawHeader: 'session-\u0100-id', createSession });
      expect(result.responded404).toBe(true);
    });

    it('should NOT respond 404 when raw header is undefined (valid - fresh connect)', () => {
      const result = resolveStreamableHttpSession({ rawHeader: undefined, createSession });
      expect(result.responded404).toBe(false);
    });
  });

  describe('onInitialize session sync', () => {
    it('should sync flow session when authorization.session is undefined (reconnect)', () => {
      const flowSession = { id: 'new-encrypted-id', payload: { protocol: 'streamable-http' as const } };
      const authorization: { session?: typeof flowSession } = {};

      syncStreamableHttpAuthorizationSession(authorization, flowSession);

      expect(authorization.session).toBe(flowSession);
      expect(authorization.session?.id).toBe('new-encrypted-id');
    });

    it('should not overwrite when authorization.session already exists', () => {
      const existing = { id: 'existing-session' };
      const flowSession = { id: 'flow-session' };
      const authorization: { session?: typeof flowSession } = { session: existing };

      syncStreamableHttpAuthorizationSession(authorization, flowSession);

      expect(authorization.session).toBe(existing);
      expect(authorization.session?.id).toBe('existing-session');
    });
  });

  describe('ServerRequestTokens.auth integration', () => {
    it('should be accessible as a Symbol on request objects', () => {
      expect(typeof ServerRequestTokens.auth).toBe('symbol');
      const req: Record<symbol, unknown> = {};
      req[ServerRequestTokens.auth] = { token: 'test', session: { id: 's1' } };
      expect((req[ServerRequestTokens.auth] as { token: string }).token).toBe('test');
    });
  });
});
