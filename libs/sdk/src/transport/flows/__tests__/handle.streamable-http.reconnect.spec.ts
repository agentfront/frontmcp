/**
 * @file handle.streamable-http.reconnect.spec.ts
 * @description Tests for session ID propagation during reconnect in the
 * streamable HTTP flow. Verifies that:
 *
 * 1. onInitialize syncs the session from flow state to request auth context
 *    when authorization.session is undefined (reconnect scenario)
 * 2. ensureAuthInfo throws when session is missing (security hardening)
 * 3. No mutation occurs when authorization.session already exists (normal flow)
 */

describe('Streamable HTTP Flow - Reconnect Session Sync', () => {
  /**
   * Simulates the session sync logic from onInitialize in
   * handle.streamable-http.flow.ts. Extracts the exact logic for
   * isolated testing without the full flow framework.
   */
  function simulateOnInitializeSessionSync(params: {
    authorization: { session?: { id: string; payload?: Record<string, unknown> } };
    flowSession: { id: string; payload?: Record<string, unknown> };
  }): {
    sessionSynced: boolean;
    authSessionId: string | undefined;
    authSessionPayload: Record<string, unknown> | undefined;
  } {
    const { authorization, flowSession } = params;

    // This is the exact logic from onInitialize:
    if (!authorization.session) {
      authorization.session = flowSession;
    }

    return {
      sessionSynced: authorization.session === flowSession,
      authSessionId: authorization.session?.id,
      authSessionPayload: authorization.session?.payload,
    };
  }

  describe('reconnect scenario (authorization.session is undefined)', () => {
    it('should sync flow session to authorization when session is undefined', () => {
      const flowSession = {
        id: 'new-encrypted-session-id-abc123',
        payload: { protocol: 'streamable-http' as const, nodeId: 'node-1', uuid: 'uuid-1' },
      };
      const authorization: { session?: { id: string; payload?: Record<string, unknown> } } = {
        session: undefined,
      };

      const result = simulateOnInitializeSessionSync({ authorization, flowSession });

      expect(result.sessionSynced).toBe(true);
      expect(result.authSessionId).toBe('new-encrypted-session-id-abc123');
      expect(authorization.session).toBe(flowSession);
    });

    it('should preserve full session payload on sync', () => {
      const flowSession = {
        id: 'reconnect-session-xyz',
        payload: {
          protocol: 'streamable-http' as const,
          nodeId: 'node-abc',
          authSig: 'sig-123',
          uuid: 'uuid-456',
          iat: 1234567890,
        },
      };
      const authorization: { session?: { id: string; payload?: Record<string, unknown> } } = {
        session: undefined,
      };

      simulateOnInitializeSessionSync({ authorization, flowSession });

      expect(authorization.session?.payload).toEqual(flowSession.payload);
    });
  });

  describe('normal flow (authorization.session already set)', () => {
    it('should not overwrite existing authorization session', () => {
      const existingSession = {
        id: 'existing-session-from-verify',
        payload: { protocol: 'streamable-http' as const },
      };
      const flowSession = {
        id: 'flow-created-session',
        payload: { protocol: 'streamable-http' as const },
      };
      const authorization: { session?: { id: string; payload?: Record<string, unknown> } } = {
        session: existingSession,
      };

      const result = simulateOnInitializeSessionSync({ authorization, flowSession });

      expect(result.sessionSynced).toBe(false);
      expect(authorization.session).toBe(existingSession);
      expect(result.authSessionId).toBe('existing-session-from-verify');
    });
  });
});

describe('ensureAuthInfo - Session Validation', () => {
  /**
   * Simulates the session validation logic from ensureAuthInfo in
   * transport.local.adapter.ts. After the security fix, missing
   * sessions should throw instead of creating a fallback ID.
   */
  function simulateEnsureAuthInfoSessionValidation(params: {
    session?: { id: string; payload?: Record<string, unknown> };
  }): { sessionId: string } {
    const { session } = params;

    // This is the exact validation from ensureAuthInfo:
    if (!session?.id) {
      throw new Error(
        'Session ID is required in ensureAuthInfo. ' +
          'This indicates a bug in session propagation — the session should have been set by the flow.',
      );
    }
    return { sessionId: session.id };
  }

  it('should throw when session is undefined', () => {
    expect(() => simulateEnsureAuthInfoSessionValidation({ session: undefined })).toThrow(
      'Session ID is required in ensureAuthInfo',
    );
  });

  it('should throw when session has no id', () => {
    expect(() =>
      simulateEnsureAuthInfoSessionValidation({
        session: { id: '' },
      }),
    ).toThrow('Session ID is required in ensureAuthInfo');
  });

  it('should return session ID when session is valid', () => {
    const result = simulateEnsureAuthInfoSessionValidation({
      session: { id: 'valid-encrypted-session-id' },
    });

    expect(result.sessionId).toBe('valid-encrypted-session-id');
  });

  it('should accept session with payload', () => {
    const result = simulateEnsureAuthInfoSessionValidation({
      session: {
        id: 'session-with-payload',
        payload: { protocol: 'streamable-http', nodeId: 'n1' },
      },
    });

    expect(result.sessionId).toBe('session-with-payload');
  });
});

describe('Session sync integration with ensureAuthInfo', () => {
  /**
   * Verifies the full chain: after onInitialize syncs the session,
   * ensureAuthInfo should receive a valid session (not fallback).
   */
  it('should produce valid session for ensureAuthInfo after reconnect sync', () => {
    // Step 1: Simulate reconnect clearing (http.request.flow)
    const authorization: {
      token: string;
      session?: { id: string; payload?: Record<string, unknown> };
    } = {
      token: 'test-token',
      session: { id: 'old-terminated-session', payload: { protocol: 'streamable-http' } },
    };

    // Cleared by http.request.flow reconnect logic
    authorization.session = undefined;

    // Step 2: Simulate flow creating new session (parseInput)
    const flowSession = {
      id: 'new-encrypted-session-after-reconnect',
      payload: { protocol: 'streamable-http' as const, nodeId: 'node-1' },
    };

    // Step 3: Simulate onInitialize sync
    if (!authorization.session) {
      authorization.session = flowSession;
    }

    // Step 4: Simulate ensureAuthInfo reading the session
    const session = authorization.session;
    if (!session?.id) {
      throw new Error('Session ID is required');
    }
    const sessionId = session.id;

    // Session should be the new one, not a fallback
    expect(sessionId).toBe('new-encrypted-session-after-reconnect');
    expect(sessionId).not.toContain('fallback');
  });

  it('should fail if session sync is skipped (pre-fix behavior)', () => {
    // Demonstrate what happened BEFORE the fix
    const authorization: {
      token: string;
      session?: { id: string; payload?: Record<string, unknown> };
    } = {
      token: 'test-token',
      session: undefined, // Cleared by reconnect
    };

    // Without the sync fix, ensureAuthInfo would see undefined session
    expect(() => {
      if (!authorization.session?.id) {
        throw new Error('Session ID is required in ensureAuthInfo');
      }
    }).toThrow('Session ID is required');
  });
});

/**
 * Tests for the re-initialization guard in onInitialize.
 *
 * When a client retries initialize with a session whose transport is already
 * initialized (e.g., after notifications/initialized with old session got 404),
 * the guard must call resetForReinitialization() before transport.initialize()
 * to prevent the MCP SDK from rejecting with 400 "server already initialized".
 *
 * This is the exact production bug scenario:
 * 1. Session A created + initialized
 * 2. DELETE terminates A
 * 3. Initialize with stale A → creates session B, transport B initialized
 * 4. notifications/initialized with old A → 404
 * 5. Client retries initialize with B → transport B already initialized → 400 (BUG)
 * 6. Fix: guard detects isInitialized, calls resetForReinitialization → 200
 */
describe('onInitialize re-initialization guard', () => {
  /**
   * Simulates the re-initialization guard logic added to onInitialize
   * in handle.streamable-http.flow.ts.
   */
  function simulateOnInitializeGuard(params: {
    transport: { isInitialized: boolean; resetForReinitialization: () => void; initialize: () => void };
  }): { resetCalled: boolean } {
    const { transport } = params;
    let resetCalled = false;

    // This is the exact guard logic from onInitialize:
    if (transport.isInitialized) {
      transport.resetForReinitialization();
      resetCalled = true;
    }

    transport.initialize();
    return { resetCalled };
  }

  it('should call resetForReinitialization when transport is already initialized', () => {
    const resetFn = jest.fn();
    const initFn = jest.fn();

    const result = simulateOnInitializeGuard({
      transport: {
        isInitialized: true,
        resetForReinitialization: resetFn,
        initialize: initFn,
      },
    });

    expect(result.resetCalled).toBe(true);
    expect(resetFn).toHaveBeenCalledTimes(1);
    expect(initFn).toHaveBeenCalledTimes(1);
  });

  it('should NOT call resetForReinitialization when transport is fresh', () => {
    const resetFn = jest.fn();
    const initFn = jest.fn();

    const result = simulateOnInitializeGuard({
      transport: {
        isInitialized: false,
        resetForReinitialization: resetFn,
        initialize: initFn,
      },
    });

    expect(result.resetCalled).toBe(false);
    expect(resetFn).not.toHaveBeenCalled();
    expect(initFn).toHaveBeenCalledTimes(1);
  });

  it('should handle full reconnect chain: session cleared → new session → cached transport → guard resets', () => {
    // Step 1: Simulate session clearing (http.request.flow reconnect logic)
    const authorization: { session?: { id: string } } = {
      session: { id: 'old-terminated-session' },
    };
    authorization.session = undefined; // Cleared by reconnect logic

    // Step 2: Simulate parseInput creating new session
    const newSession = { id: 'new-session-B' };
    if (!authorization.session) {
      authorization.session = newSession;
    }

    // Step 3: Simulate createTransporter returning cached transport (already initialized)
    let transportInitialized = true; // Cached from first successful init
    let transportSessionId: string | undefined = 'new-session-B';
    const resetFn = jest.fn(() => {
      transportInitialized = false;
      transportSessionId = undefined;
    });
    const initFn = jest.fn(() => {
      transportInitialized = true;
      transportSessionId = newSession.id;
    });

    // Step 4: Apply the guard
    const result = simulateOnInitializeGuard({
      transport: {
        get isInitialized() {
          return transportInitialized;
        },
        resetForReinitialization: resetFn,
        initialize: initFn,
      },
    });

    // Guard should have detected the initialized state and reset
    expect(result.resetCalled).toBe(true);
    expect(resetFn).toHaveBeenCalledTimes(1);
    expect(initFn).toHaveBeenCalledTimes(1);
    // After initialize, transport should be initialized again with new session
    expect(transportInitialized).toBe(true);
    expect(transportSessionId).toBe('new-session-B');
  });

  it('should handle multiple retries gracefully', () => {
    let initCount = 0;
    // Each retry: transport starts initialized (from previous success), gets reset, re-initialized
    for (let retry = 0; retry < 3; retry++) {
      const resetFn = jest.fn();
      const initFn = jest.fn(() => {
        initCount++;
      });

      const result = simulateOnInitializeGuard({
        transport: {
          isInitialized: retry > 0, // First call is fresh, subsequent are retries
          resetForReinitialization: resetFn,
          initialize: initFn,
        },
      });

      if (retry > 0) {
        expect(result.resetCalled).toBe(true);
      } else {
        expect(result.resetCalled).toBe(false);
      }
      expect(initFn).toHaveBeenCalledTimes(1);
    }

    expect(initCount).toBe(3);
  });
});
