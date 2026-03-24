/**
 * Tests for the parseInput stage of HandleStreamableHttpFlow.
 *
 * Validates session resolution priority:
 * 1. mcp-session-id header (client reconnect)
 * 2. authorization.session (from auth verification)
 * 3. Create new session (fresh initialize)
 */

import { validateMcpSessionHeader } from '../../../common/schemas/session-header.schema';
import { ServerRequestTokens } from '../../../common';

describe('HandleStreamableHttpFlow - parseInput session resolution', () => {
  /**
   * Simulates the parseInput session resolution logic from
   * handle.streamable-http.flow.ts lines 79-134.
   * This replicates the exact branching logic for isolated testing.
   */
  function resolveSession(params: {
    rawHeader: string | undefined;
    authorizationSession?: { id: string; payload?: Record<string, unknown> };
  }): {
    responded404: boolean;
    session?: { id: string; payload?: Record<string, unknown> };
    createdNew: boolean;
  } {
    const { rawHeader, authorizationSession } = params;

    const rawMcpSessionHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
    const mcpSessionHeader = validateMcpSessionHeader(rawMcpSessionHeader);

    // If client sent header but validation failed → 404
    if (rawHeader !== undefined && !mcpSessionHeader) {
      return { responded404: true, createdNew: false };
    }

    if (mcpSessionHeader) {
      // Client sent session ID
      if (authorizationSession?.id === mcpSessionHeader) {
        // Header matches auth session → use auth session (preserves payload)
        return { session: authorizationSession, createdNew: false, responded404: false };
      } else {
        // Header differs from auth or auth missing → use header ID only
        return { session: { id: mcpSessionHeader }, createdNew: false, responded404: false };
      }
    } else if (authorizationSession) {
      // No header but auth session exists
      return { session: authorizationSession, createdNew: false, responded404: false };
    } else {
      // No session at all → create new (would call createSessionId in real flow)
      return { session: { id: 'new-session-placeholder' }, createdNew: true, responded404: false };
    }
  }

  describe('fresh initialize (no header, no auth session)', () => {
    it('should create new session when neither header nor auth session exist', () => {
      const result = resolveSession({ rawHeader: undefined, authorizationSession: undefined });
      expect(result.createdNew).toBe(true);
      expect(result.responded404).toBe(false);
      expect(result.session).toBeDefined();
    });
  });

  describe('reconnect with mcp-session-id header', () => {
    it('should use auth session when header matches auth session ID', () => {
      const authSession = {
        id: 'session-abc',
        payload: { protocol: 'streamable-http', nodeId: 'n1', authSig: 's1', uuid: 'u1', iat: 123 },
      };
      const result = resolveSession({
        rawHeader: 'session-abc',
        authorizationSession: authSession,
      });
      expect(result.session).toBe(authSession);
      expect(result.session?.payload).toBeDefined();
      expect(result.createdNew).toBe(false);
    });

    it('should use header ID without payload when header differs from auth session', () => {
      const authSession = { id: 'old-session', payload: { protocol: 'streamable-http' } };
      const result = resolveSession({
        rawHeader: 'reconnect-session-xyz',
        authorizationSession: authSession,
      });
      expect(result.session?.id).toBe('reconnect-session-xyz');
      expect(result.session?.payload).toBeUndefined();
      expect(result.createdNew).toBe(false);
    });

    it('should use header ID when auth session is undefined', () => {
      const result = resolveSession({
        rawHeader: 'client-session-id',
        authorizationSession: undefined,
      });
      expect(result.session?.id).toBe('client-session-id');
      expect(result.session?.payload).toBeUndefined();
      expect(result.createdNew).toBe(false);
    });
  });

  describe('auth session without header', () => {
    it('should use auth session when no header is provided', () => {
      const authSession = { id: 'auth-session', payload: { protocol: 'streamable-http' } };
      const result = resolveSession({
        rawHeader: undefined,
        authorizationSession: authSession,
      });
      expect(result.session).toBe(authSession);
      expect(result.createdNew).toBe(false);
    });
  });

  describe('invalid header format', () => {
    it('should respond 404 for header with null byte', () => {
      const result = resolveSession({ rawHeader: 'abc\x00def' });
      expect(result.responded404).toBe(true);
      expect(result.session).toBeUndefined();
    });

    it('should respond 404 for header exceeding max length', () => {
      const result = resolveSession({ rawHeader: 'a'.repeat(2049) });
      expect(result.responded404).toBe(true);
    });

    it('should respond 404 for header with leading whitespace', () => {
      const result = resolveSession({ rawHeader: ' leading-space' });
      expect(result.responded404).toBe(true);
    });

    it('should respond 404 for header with trailing whitespace', () => {
      const result = resolveSession({ rawHeader: 'trailing-space ' });
      expect(result.responded404).toBe(true);
    });

    it('should respond 404 for header with non-ASCII characters', () => {
      const result = resolveSession({ rawHeader: 'session-\u0100-id' });
      expect(result.responded404).toBe(true);
    });

    it('should NOT respond 404 when raw header is undefined (valid - fresh connect)', () => {
      const result = resolveSession({ rawHeader: undefined });
      expect(result.responded404).toBe(false);
    });
  });

  describe('onInitialize session sync', () => {
    /**
     * Tests the critical session sync logic from onInitialize (lines 197-200):
     * After reconnect clears authorization.session, onInitialize must sync
     * the flow session back so ensureAuthInfo gets a valid session.
     */
    function simulateOnInitializeSync(params: {
      authorizationSession: { id: string; payload?: Record<string, unknown> } | undefined;
      flowSession: { id: string; payload?: Record<string, unknown> };
    }) {
      const authorization: { session?: { id: string; payload?: Record<string, unknown> } } = {
        session: params.authorizationSession,
      };

      // Exact logic from onInitialize
      if (!authorization.session) {
        authorization.session = params.flowSession;
      }

      return { finalSession: authorization.session };
    }

    it('should sync flow session when authorization.session is undefined (reconnect)', () => {
      const flowSession = { id: 'new-encrypted-id', payload: { protocol: 'streamable-http' } };
      const result = simulateOnInitializeSync({
        authorizationSession: undefined,
        flowSession,
      });
      expect(result.finalSession).toBe(flowSession);
      expect(result.finalSession.id).toBe('new-encrypted-id');
    });

    it('should not overwrite when authorization.session already exists', () => {
      const existing = { id: 'existing-session' };
      const flowSession = { id: 'flow-session' };
      const result = simulateOnInitializeSync({
        authorizationSession: existing,
        flowSession,
      });
      expect(result.finalSession).toBe(existing);
      expect(result.finalSession.id).toBe('existing-session');
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
