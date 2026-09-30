/**
 * Tests for the parseInput stage of HandleSseFlow (legacy SSE).
 *
 * Validates session resolution priority:
 * 1. mcp-session-id header (client reconnect)
 * 2. sessionId query param (legacy SSE /message?sessionId=xxx)
 * 3. authorization.session (from auth verification)
 * 4. Create new session (fresh initialize)
 *
 * A presented id (header or query) is honored only when `session:verify`
 * verified that exact id; anything else is answered 404 so the client
 * reconnects. The raw id is never used as a transport key.
 */

import { getQuerySessionId, resolveLegacySseSession } from '../handle.sse.flow';

describe('HandleSseFlow - parseInput session resolution', () => {
  const NEW_SESSION = { id: 'new-sse-session-placeholder' };

  function resolveSession(params: {
    rawHeader: string | undefined;
    url?: string;
    authorizationSession?: { id: string; payload?: { nodeId: string; authSig: string; uuid: string; iat: number } };
  }) {
    return resolveLegacySseSession({
      rawHeader: params.rawHeader,
      requestUrl: params.url,
      authorizationSession: params.authorizationSession,
      createSession: () => NEW_SESSION,
    });
  }

  describe('fresh initialize (no header, no query param, no auth session)', () => {
    it('should create new session', () => {
      const result = resolveSession({ rawHeader: undefined });
      expect(result.createdNew).toBe(true);
      expect(result.responded404).toBe(false);
      expect(result.session).toBe(NEW_SESSION);
    });
  });

  describe('mcp-session-id header resolution', () => {
    it('should use auth session when header matches auth session ID', () => {
      const authSession = {
        id: 'session-abc',
        payload: { nodeId: 'n1', authSig: 's1', uuid: '11111111-1111-1111-1111-111111111111', iat: 123 },
      };
      const result = resolveSession({
        rawHeader: 'session-abc',
        authorizationSession: authSession,
      });
      expect(result.session).toBe(authSession);
      expect(result.session?.payload).toBeDefined();
    });

    it('should respond 404 when the header differs from the verified session', () => {
      const result = resolveSession({
        rawHeader: 'minted-under-another-secret',
        authorizationSession: { id: 'freshly-minted' },
      });
      expect(result.responded404).toBe(true);
      expect(result.session).toBeUndefined();
    });

    it('should respond 404 when a header was sent but no session was verified', () => {
      const result = resolveSession({ rawHeader: 'client-session', authorizationSession: undefined });
      expect(result.responded404).toBe(true);
      expect(result.session).toBeUndefined();
    });
  });

  describe('query param session ID (legacy SSE /message endpoint)', () => {
    it('should use the verified session named by the query param when no header', () => {
      const authSession = { id: 'query-session-123' };
      const result = resolveSession({
        rawHeader: undefined,
        url: '/message?sessionId=query-session-123',
        authorizationSession: authSession,
      });
      expect(result.session).toBe(authSession);
      expect(result.createdNew).toBe(false);
    });

    it('should respond 404 for a query param session id nothing verified', () => {
      const result = resolveSession({
        rawHeader: undefined,
        url: '/message?sessionId=forged-session',
        authorizationSession: { id: 'freshly-minted' },
      });
      expect(result.responded404).toBe(true);
      expect(result.session).toBeUndefined();
    });

    it('should prefer header over query param when both present', () => {
      const authSession = { id: 'header-session' };
      const result = resolveSession({
        rawHeader: 'header-session',
        url: '/message?sessionId=query-session',
        authorizationSession: authSession,
      });
      expect(result.session).toBe(authSession);
    });

    it('should respond 404 for invalid query param format', () => {
      const result = resolveSession({
        rawHeader: undefined,
        url: '/message?sessionId=' + 'a'.repeat(2049),
      });
      expect(result.responded404).toBe(true);
    });
  });

  describe('auth session without header or query param', () => {
    it('should use auth session when no header and no query param', () => {
      const authSession = { id: 'auth-session' };
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
    });

    it('should respond 404 for header exceeding max length', () => {
      const result = resolveSession({ rawHeader: 'a'.repeat(2049) });
      expect(result.responded404).toBe(true);
    });

    it('should respond 404 for header with leading whitespace', () => {
      const result = resolveSession({ rawHeader: ' leading-space' });
      expect(result.responded404).toBe(true);
    });

    it('should NOT respond 404 when raw header is undefined', () => {
      const result = resolveSession({ rawHeader: undefined });
      expect(result.responded404).toBe(false);
    });
  });

  describe('getQuerySessionId helper', () => {
    it('should extract sessionId from query string', () => {
      expect(getQuerySessionId('/message?sessionId=abc123')).toBe('abc123');
    });

    it('should return undefined for missing sessionId param', () => {
      expect(getQuerySessionId('/message?other=value')).toBeUndefined();
    });

    it('should return undefined for undefined url', () => {
      expect(getQuerySessionId(undefined)).toBeUndefined();
    });

    it('should return undefined for malformed URL', () => {
      expect(getQuerySessionId('')).toBeUndefined();
    });
  });
});
