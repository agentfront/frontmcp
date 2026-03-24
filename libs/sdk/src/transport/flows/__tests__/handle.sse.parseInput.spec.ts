/**
 * Tests for the parseInput stage of HandleSseFlow (legacy SSE).
 *
 * Validates session resolution priority:
 * 1. mcp-session-id header (client reconnect)
 * 2. sessionId query param (legacy SSE /message?sessionId=xxx)
 * 3. authorization.session (from auth verification)
 * 4. Create new session (fresh initialize)
 */

import { validateMcpSessionHeader } from '../../../common/schemas/session-header.schema';

describe('HandleSseFlow - parseInput session resolution', () => {
  /**
   * Extracts sessionId from query string, mirroring getQuerySessionId()
   * in handle.sse.flow.ts lines 68-76.
   */
  function getQuerySessionId(urlPath?: string): string | undefined {
    if (!urlPath) return undefined;
    try {
      const u = new URL(String(urlPath), 'http://local');
      return u.searchParams.get('sessionId') ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Simulates the parseInput session resolution logic from
   * handle.sse.flow.ts lines 87-153 with SSE-specific query param support.
   */
  function resolveSession(params: {
    rawHeader: string | undefined;
    url?: string;
    authorizationSession?: { id: string; payload?: Record<string, unknown> };
  }): {
    responded404: boolean;
    responded404Reason?: string;
    session?: { id: string; payload?: Record<string, unknown> };
    createdNew: boolean;
  } {
    const { rawHeader, url, authorizationSession } = params;

    const rawMcpSessionHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
    const mcpSessionHeader = validateMcpSessionHeader(rawMcpSessionHeader);

    const querySessionId = getQuerySessionId(url);
    const validatedQuerySessionId = querySessionId ? validateMcpSessionHeader(querySessionId) : undefined;

    // Invalid header → 404
    if (rawHeader !== undefined && !mcpSessionHeader) {
      return { responded404: true, responded404Reason: 'invalid header', createdNew: false };
    }

    // Invalid query param → 404
    if (querySessionId !== undefined && !validatedQuerySessionId) {
      return { responded404: true, responded404Reason: 'invalid query param', createdNew: false };
    }

    // Header takes priority over query param
    const effectiveSessionId = mcpSessionHeader ?? validatedQuerySessionId;

    if (effectiveSessionId) {
      if (authorizationSession?.id === effectiveSessionId) {
        return { session: authorizationSession, createdNew: false, responded404: false };
      } else {
        return { session: { id: effectiveSessionId }, createdNew: false, responded404: false };
      }
    } else if (authorizationSession) {
      return { session: authorizationSession, createdNew: false, responded404: false };
    } else {
      return { session: { id: 'new-sse-session-placeholder' }, createdNew: true, responded404: false };
    }
  }

  describe('fresh initialize (no header, no query param, no auth session)', () => {
    it('should create new session', () => {
      const result = resolveSession({ rawHeader: undefined });
      expect(result.createdNew).toBe(true);
      expect(result.responded404).toBe(false);
      expect(result.session).toBeDefined();
    });
  });

  describe('mcp-session-id header resolution', () => {
    it('should use auth session when header matches auth session ID', () => {
      const authSession = {
        id: 'session-abc',
        payload: { protocol: 'legacy-sse', nodeId: 'n1', authSig: 's1', uuid: 'u1', iat: 123 },
      };
      const result = resolveSession({
        rawHeader: 'session-abc',
        authorizationSession: authSession,
      });
      expect(result.session).toBe(authSession);
      expect(result.session?.payload).toBeDefined();
    });

    it('should use header ID without payload when header differs from auth session', () => {
      const result = resolveSession({
        rawHeader: 'new-session-id',
        authorizationSession: { id: 'old-session' },
      });
      expect(result.session?.id).toBe('new-session-id');
      expect(result.session?.payload).toBeUndefined();
    });

    it('should use header ID when auth session is undefined', () => {
      const result = resolveSession({ rawHeader: 'client-session', authorizationSession: undefined });
      expect(result.session?.id).toBe('client-session');
    });
  });

  describe('query param session ID (legacy SSE /message endpoint)', () => {
    it('should use query param session ID when no header', () => {
      const result = resolveSession({
        rawHeader: undefined,
        url: '/message?sessionId=query-session-123',
      });
      expect(result.session?.id).toBe('query-session-123');
      expect(result.createdNew).toBe(false);
    });

    it('should prefer header over query param when both present', () => {
      const result = resolveSession({
        rawHeader: 'header-session',
        url: '/message?sessionId=query-session',
      });
      expect(result.session?.id).toBe('header-session');
    });

    it('should respond 404 for invalid query param format', () => {
      const result = resolveSession({
        rawHeader: undefined,
        url: '/message?sessionId=' + 'a'.repeat(2049),
      });
      expect(result.responded404).toBe(true);
      expect(result.responded404Reason).toBe('invalid query param');
    });
  });

  describe('auth session without header or query param', () => {
    it('should use auth session when no header and no query param', () => {
      const authSession = { id: 'auth-session', payload: { protocol: 'legacy-sse' } };
      const result = resolveSession({
        rawHeader: undefined,
        authorizationSession: authSession,
      });
      expect(result.session).toBe(authSession);
    });
  });

  describe('invalid header format', () => {
    it('should respond 404 for header with null byte', () => {
      const result = resolveSession({ rawHeader: 'abc\x00def' });
      expect(result.responded404).toBe(true);
      expect(result.responded404Reason).toBe('invalid header');
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
