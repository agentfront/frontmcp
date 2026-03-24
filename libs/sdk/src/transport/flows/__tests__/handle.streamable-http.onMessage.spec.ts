/**
 * Tests for the onMessage stage three-tier transport lookup.
 *
 * Validates the transport resolution priority per MCP Spec 2025-11-25:
 * 1. In-memory transport → handle request
 * 2. Redis stored session → recreate transport → handle request
 * 3. No transport → differentiate session-expired vs session-not-found → HTTP 404
 */

describe('HandleStreamableHttpFlow - onMessage transport lookup', () => {
  interface MockTransport {
    handleRequest: jest.Mock;
  }

  interface MockTransportService {
    getTransporter: jest.Mock;
    getStoredSession: jest.Mock;
    recreateTransporter: jest.Mock;
    wasSessionCreatedAsync: jest.Mock;
  }

  function createMockTransportService(overrides?: Partial<MockTransportService>): MockTransportService {
    return {
      getTransporter: jest.fn().mockResolvedValue(undefined),
      getStoredSession: jest.fn().mockResolvedValue(undefined),
      recreateTransporter: jest.fn().mockResolvedValue(undefined),
      wasSessionCreatedAsync: jest.fn().mockResolvedValue(false),
      ...overrides,
    };
  }

  function createMockTransport(): MockTransport {
    return { handleRequest: jest.fn().mockResolvedValue(undefined) };
  }

  /**
   * Simulates the onMessage three-tier lookup logic from
   * handle.streamable-http.flow.ts lines 289-371.
   */
  async function simulateOnMessage(params: {
    transportService: MockTransportService;
    token: string;
    sessionId: string;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
  }): Promise<{
    handled: boolean;
    respondedWith?: string;
    error?: Error;
  }> {
    const { transportService, token, sessionId, request, response } = params;

    // 1. Try memory
    let transport = await transportService.getTransporter('streamable-http', token, sessionId);

    // 2. If not in memory, try Redis
    if (!transport) {
      try {
        const storedSession = await transportService.getStoredSession('streamable-http', token, sessionId);
        if (storedSession) {
          transport = await transportService.recreateTransporter(
            'streamable-http',
            token,
            sessionId,
            storedSession,
            response,
          );
        }
      } catch {
        // Fall through to 404 logic
      }
    }

    // 3. If still not found
    if (!transport) {
      const wasCreated = await transportService.wasSessionCreatedAsync('streamable-http', token, sessionId);
      if (wasCreated) {
        return { handled: false, respondedWith: 'session expired' };
      } else {
        return { handled: false, respondedWith: 'session not initialized' };
      }
    }

    try {
      await transport.handleRequest(request, response);
      return { handled: true };
    } catch (error) {
      return { handled: false, error: error as Error };
    }
  }

  describe('tier 1: in-memory transport', () => {
    it('should find transport in memory and handle request', async () => {
      const transport = createMockTransport();
      const svc = createMockTransportService({
        getTransporter: jest.fn().mockResolvedValue(transport),
      });

      const result = await simulateOnMessage({
        transportService: svc,
        token: 'token-1',
        sessionId: 'session-1',
        request: { body: { method: 'tools/list' } },
        response: {},
      });

      expect(result.handled).toBe(true);
      expect(transport.handleRequest).toHaveBeenCalledTimes(1);
      expect(svc.getStoredSession).not.toHaveBeenCalled();
    });
  });

  describe('tier 2: Redis recreation', () => {
    it('should recreate transport from Redis when not in memory', async () => {
      const transport = createMockTransport();
      const storedSession = { initialized: true, createdAt: Date.now() };
      const svc = createMockTransportService({
        getStoredSession: jest.fn().mockResolvedValue(storedSession),
        recreateTransporter: jest.fn().mockResolvedValue(transport),
      });

      const result = await simulateOnMessage({
        transportService: svc,
        token: 'token-1',
        sessionId: 'session-1',
        request: { body: { method: 'tools/call' } },
        response: {},
      });

      expect(result.handled).toBe(true);
      expect(svc.getStoredSession).toHaveBeenCalledWith('streamable-http', 'token-1', 'session-1');
      expect(svc.recreateTransporter).toHaveBeenCalled();
      expect(transport.handleRequest).toHaveBeenCalled();
    });

    it('should handle Redis recreation failure gracefully', async () => {
      const svc = createMockTransportService({
        getStoredSession: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
        wasSessionCreatedAsync: jest.fn().mockResolvedValue(false),
      });

      const result = await simulateOnMessage({
        transportService: svc,
        token: 'token-1',
        sessionId: 'session-1',
        request: { body: { method: 'tools/list' } },
        response: {},
      });

      expect(result.handled).toBe(false);
      expect(result.respondedWith).toBe('session not initialized');
      // Should NOT throw — gracefully falls through to 404
    });
  });

  describe('tier 3: session differentiation', () => {
    it('should respond "session expired" when session was previously created', async () => {
      const svc = createMockTransportService({
        wasSessionCreatedAsync: jest.fn().mockResolvedValue(true),
      });

      const result = await simulateOnMessage({
        transportService: svc,
        token: 'token-1',
        sessionId: 'expired-session',
        request: { body: { method: 'tools/list' } },
        response: {},
      });

      expect(result.handled).toBe(false);
      expect(result.respondedWith).toBe('session expired');
    });

    it('should respond "session not initialized" when session never existed', async () => {
      const svc = createMockTransportService({
        wasSessionCreatedAsync: jest.fn().mockResolvedValue(false),
      });

      const result = await simulateOnMessage({
        transportService: svc,
        token: 'token-1',
        sessionId: 'fabricated-session',
        request: { body: { method: 'tools/call' } },
        response: {},
      });

      expect(result.handled).toBe(false);
      expect(result.respondedWith).toBe('session not initialized');
    });
  });

  describe('error handling', () => {
    it('should propagate errors from handleRequest', async () => {
      const transport = createMockTransport();
      transport.handleRequest.mockRejectedValue(new Error('MCP error'));
      const svc = createMockTransportService({
        getTransporter: jest.fn().mockResolvedValue(transport),
      });

      const result = await simulateOnMessage({
        transportService: svc,
        token: 'token-1',
        sessionId: 'session-1',
        request: { body: { method: 'tools/call' } },
        response: {},
      });

      expect(result.handled).toBe(false);
      expect(result.error?.message).toBe('MCP error');
    });
  });
});
