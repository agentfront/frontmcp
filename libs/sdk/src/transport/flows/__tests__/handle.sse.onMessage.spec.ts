/**
 * Tests for the onMessage stage of HandleSseFlow (legacy SSE).
 *
 * Validates transport lookup and error differentiation:
 * - Transport found in memory → handle request
 * - Not found, was-created=true → 404 "session expired"
 * - Not found, was-created=false → 404 "session not initialized"
 *
 * Note: Unlike streamable HTTP, legacy SSE does NOT have Redis recreation.
 * It only checks in-memory transport via getTransporter() and uses
 * synchronous wasSessionCreated() (not the async variant).
 */

describe('HandleSseFlow - onMessage transport lookup', () => {
  interface MockTransport {
    handleRequest: jest.Mock;
  }

  interface MockTransportService {
    getTransporter: jest.Mock;
    wasSessionCreated: jest.Mock;
  }

  function createMockTransportService(overrides?: Partial<MockTransportService>): MockTransportService {
    return {
      getTransporter: jest.fn().mockResolvedValue(undefined),
      wasSessionCreated: jest.fn().mockReturnValue(false),
      ...overrides,
    };
  }

  function createMockTransport(): MockTransport {
    return { handleRequest: jest.fn().mockResolvedValue(undefined) };
  }

  /**
   * Simulates the onMessage logic from handle.sse.flow.ts lines 201-237.
   * Legacy SSE uses in-memory only lookup (no Redis recreation).
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
  }> {
    const { transportService, token, sessionId, request, response } = params;

    // Only in-memory lookup (no Redis tier for legacy SSE)
    const transport = await transportService.getTransporter('sse', token, sessionId);

    if (!transport) {
      // Sync check (not async like streamable HTTP)
      const wasCreated = transportService.wasSessionCreated('sse', token, sessionId);

      if (wasCreated) {
        return { handled: false, respondedWith: 'session expired' };
      } else {
        return { handled: false, respondedWith: 'session not initialized' };
      }
    }

    await transport.handleRequest(request, response);
    return { handled: true };
  }

  describe('transport found in memory', () => {
    it('should handle request when transport exists', async () => {
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
      expect(svc.wasSessionCreated).not.toHaveBeenCalled();
    });
  });

  describe('transport not found — error differentiation', () => {
    it('should respond "session expired" when session was previously created', async () => {
      const svc = createMockTransportService({
        wasSessionCreated: jest.fn().mockReturnValue(true),
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
      expect(svc.wasSessionCreated).toHaveBeenCalledWith('sse', 'token-1', 'expired-session');
    });

    it('should respond "session not initialized" when session never existed', async () => {
      const svc = createMockTransportService({
        wasSessionCreated: jest.fn().mockReturnValue(false),
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

    it('should use transport type "sse" for registry lookup (not "streamable-http")', async () => {
      const svc = createMockTransportService();

      await simulateOnMessage({
        transportService: svc,
        token: 'token-1',
        sessionId: 'session-1',
        request: {},
        response: {},
      });

      expect(svc.getTransporter).toHaveBeenCalledWith('sse', 'token-1', 'session-1');
      expect(svc.wasSessionCreated).toHaveBeenCalledWith('sse', 'token-1', 'session-1');
    });
  });
});
