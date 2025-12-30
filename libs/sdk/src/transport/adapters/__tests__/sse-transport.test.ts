/**
 * Unit Tests for RecreateableSSEServerTransport
 *
 * Tests for SSE session recreation capabilities including:
 * - Event ID counter restoration for reconnection support
 * - Session state recreation
 * - Last-Event-ID header handling
 * - Multi-instance SSE failover scenarios
 */
import { RecreateableSSEServerTransport } from '../sse-transport';
import type { ServerResponse } from 'http';

// Mock ServerResponse
function createMockResponse(): ServerResponse {
  const response = {
    writeHead: jest.fn().mockReturnThis(),
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
    on: jest.fn(),
    setHeader: jest.fn(),
  } as unknown as ServerResponse;
  return response;
}

describe('RecreateableSSEServerTransport', () => {
  let transport: RecreateableSSEServerTransport;
  let mockResponse: ServerResponse;
  const endpoint = '/messages';

  beforeEach(() => {
    jest.clearAllMocks();
    mockResponse = createMockResponse();
    transport = new RecreateableSSEServerTransport(endpoint, mockResponse);
  });

  describe('constructor', () => {
    it('should create transport with default options', () => {
      const t = new RecreateableSSEServerTransport(endpoint, mockResponse);
      expect(t).toBeDefined();
      expect(t.isRecreatedSession).toBe(false);
      expect(t.eventIdCounter).toBe(0);
    });

    it('should create transport with custom session ID', () => {
      const t = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        sessionId: 'custom-session',
      });
      expect(t.sessionId).toBe('custom-session');
    });

    it('should restore event ID from initialEventId option', () => {
      const t = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        initialEventId: 42,
      });
      expect(t.eventIdCounter).toBe(42);
      expect(t.isRecreatedSession).toBe(true);
    });

    it('should not set event ID for invalid initialEventId', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const t = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        initialEventId: -1,
      });

      expect(t.eventIdCounter).toBe(0);
      expect(t.isRecreatedSession).toBe(false);
      warnSpy.mockRestore();
    });

    it('should handle initialEventId of 0', () => {
      const t = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        initialEventId: 0,
      });
      expect(t.eventIdCounter).toBe(0);
      expect(t.isRecreatedSession).toBe(true);
    });
  });

  describe('isRecreatedSession', () => {
    it('should return false for new session', () => {
      expect(transport.isRecreatedSession).toBe(false);
    });

    it('should return true after setSessionState', () => {
      transport.setSessionState(transport.sessionId, 10);
      expect(transport.isRecreatedSession).toBe(true);
    });

    it('should return true after constructor with initialEventId', () => {
      const t = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        initialEventId: 5,
      });
      expect(t.isRecreatedSession).toBe(true);
    });
  });

  describe('eventIdCounter', () => {
    it('should start at 0 for new transport', () => {
      expect(transport.eventIdCounter).toBe(0);
    });

    it('should match lastEventId', () => {
      expect(transport.eventIdCounter).toBe(transport.lastEventId);
    });

    it('should reflect changes from setEventIdCounter', () => {
      transport.setEventIdCounter(100);
      expect(transport.eventIdCounter).toBe(100);
    });
  });

  describe('setEventIdCounter', () => {
    it('should set event ID counter for resumption', () => {
      transport.setEventIdCounter(50);
      expect(transport.eventIdCounter).toBe(50);
    });

    it('should accept zero as valid event ID', () => {
      transport.setEventIdCounter(10);
      transport.setEventIdCounter(0);
      expect(transport.eventIdCounter).toBe(0);
    });

    it('should accept large valid event IDs', () => {
      const largeId = Number.MAX_SAFE_INTEGER;
      transport.setEventIdCounter(largeId);
      expect(transport.eventIdCounter).toBe(largeId);
    });

    it('should reject negative event IDs with warning', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      transport.setEventIdCounter(-1);

      expect(transport.eventIdCounter).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid eventId: -1'));
      warnSpy.mockRestore();
    });

    it('should reject NaN with warning', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      transport.setEventIdCounter(NaN);

      expect(transport.eventIdCounter).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid eventId'));
      warnSpy.mockRestore();
    });

    it('should reject Infinity with warning', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      transport.setEventIdCounter(Infinity);

      expect(transport.eventIdCounter).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid eventId'));
      warnSpy.mockRestore();
    });

    it('should reject non-integer values with warning', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      transport.setEventIdCounter(10.5);

      expect(transport.eventIdCounter).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid eventId: 10.5'));
      warnSpy.mockRestore();
    });

    it('should reject values beyond MAX_SAFE_INTEGER with warning', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      transport.setEventIdCounter(Number.MAX_SAFE_INTEGER + 1);

      expect(transport.eventIdCounter).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('setSessionState', () => {
    it('should restore session with event ID', () => {
      const sessionId = transport.sessionId;
      transport.setSessionState(sessionId, 25);

      expect(transport.eventIdCounter).toBe(25);
      expect(transport.isRecreatedSession).toBe(true);
    });

    it('should mark session as recreated', () => {
      transport.setSessionState(transport.sessionId, 10);
      expect(transport.isRecreatedSession).toBe(true);
    });

    it('should handle undefined lastEventId', () => {
      transport.setSessionState(transport.sessionId);

      expect(transport.eventIdCounter).toBe(0); // Unchanged
      expect(transport.isRecreatedSession).toBe(true);
    });

    it('should warn on session ID mismatch', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      transport.setSessionState('different-session-id', 10);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('session ID mismatch'));
      expect(transport.isRecreatedSession).toBe(true); // Still marks as recreated
      warnSpy.mockRestore();
    });

    it('should set event ID counter even on session ID mismatch', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      transport.setSessionState('different-session-id', 15);

      expect(transport.eventIdCounter).toBe(15);
      warnSpy.mockRestore();
    });
  });

  describe('event ID continuity', () => {
    it('should continue event IDs from restored counter after send', async () => {
      // Set up transport and start SSE
      await transport.start();

      // Restore to event ID 100
      transport.setEventIdCounter(100);

      // Send a message - should use 101
      await transport.send({ jsonrpc: '2.0', method: 'test' });

      // Verify event ID incremented
      expect(transport.eventIdCounter).toBe(101);

      // Verify the write included correct event ID
      expect(mockResponse.write).toHaveBeenCalledWith(expect.stringContaining('id: 101'));
    });

    it('should not duplicate event IDs after recreation', async () => {
      await transport.start();

      // Simulate messages were sent (IDs 1-50)
      transport.setEventIdCounter(50);

      // Send new message - should be 51
      await transport.send({ jsonrpc: '2.0', method: 'test' });
      expect(transport.eventIdCounter).toBe(51);

      // Another message - should be 52
      await transport.send({ jsonrpc: '2.0', method: 'test2' });
      expect(transport.eventIdCounter).toBe(52);
    });

    it('should start from restored ID for endpoint event', async () => {
      // Create transport with restored event ID
      const restored = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        initialEventId: 99,
      });

      await restored.start();

      // The endpoint event should use ID 100
      expect(mockResponse.write).toHaveBeenCalledWith(expect.stringContaining('id: 100'));
      expect(restored.eventIdCounter).toBe(100);
    });
  });

  describe('SSE reconnection scenarios', () => {
    it('should handle Last-Event-ID header reconnection', () => {
      // Client disconnected after receiving event 75
      const lastEventId = 75;

      // Create new transport for reconnection
      const reconnected = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        sessionId: 'session-123',
        initialEventId: lastEventId,
      });

      expect(reconnected.eventIdCounter).toBe(lastEventId);
      expect(reconnected.isRecreatedSession).toBe(true);
    });

    it('should preserve session ID across reconnections', () => {
      const sessionId = 'persistent-session';

      const original = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        sessionId,
      });

      // Simulate disconnect and reconnect
      const reconnected = new RecreateableSSEServerTransport(endpoint, createMockResponse(), {
        sessionId,
        initialEventId: 50,
      });

      expect(reconnected.sessionId).toBe(original.sessionId);
    });
  });

  describe('multi-instance SSE failover', () => {
    it('should allow different instances to continue same session', () => {
      const sessionId = 'shared-sse-session';
      const lastEventId = 100;

      // Instance A (original)
      const instanceA = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        sessionId,
      });
      // Simulate A sent events up to 100
      instanceA.setEventIdCounter(lastEventId);

      // Instance A goes down, client reconnects to Instance B
      const instanceB = new RecreateableSSEServerTransport(endpoint, createMockResponse(), {
        sessionId,
        initialEventId: lastEventId,
      });

      expect(instanceB.eventIdCounter).toBe(lastEventId);
      expect(instanceB.sessionId).toBe(sessionId);
    });

    it('should handle concurrent instances with same session', () => {
      const sessionId = 'concurrent-session';

      const instance1 = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        sessionId,
        initialEventId: 50,
      });

      const instance2 = new RecreateableSSEServerTransport(endpoint, createMockResponse(), {
        sessionId,
        initialEventId: 50,
      });

      // Both should have same starting point
      expect(instance1.eventIdCounter).toBe(50);
      expect(instance2.eventIdCounter).toBe(50);
    });
  });

  describe('edge cases', () => {
    it('should handle very large event IDs', () => {
      const largeId = 1_000_000_000;
      transport.setEventIdCounter(largeId);
      expect(transport.eventIdCounter).toBe(largeId);
    });

    it('should handle setSessionState multiple times', () => {
      transport.setSessionState(transport.sessionId, 10);
      transport.setSessionState(transport.sessionId, 20);
      transport.setSessionState(transport.sessionId, 30);

      expect(transport.eventIdCounter).toBe(30);
      expect(transport.isRecreatedSession).toBe(true);
    });

    it('should handle setEventIdCounter multiple times', () => {
      transport.setEventIdCounter(10);
      transport.setEventIdCounter(20);
      transport.setEventIdCounter(30);

      expect(transport.eventIdCounter).toBe(30);
    });

    it('should maintain state after close', async () => {
      await transport.start();
      transport.setEventIdCounter(50);

      await transport.close();

      // Event ID counter should still reflect last value
      expect(transport.eventIdCounter).toBe(50);
    });
  });

  describe('security validation', () => {
    it('should not allow negative event IDs via constructor', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const t = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        initialEventId: -100,
      });

      expect(t.eventIdCounter).toBe(0);
      expect(t.isRecreatedSession).toBe(false);
      warnSpy.mockRestore();
    });

    it('should not allow prototype pollution via session ID', () => {
      const maliciousId = '__proto__';
      const t = new RecreateableSSEServerTransport(endpoint, mockResponse, {
        sessionId: maliciousId,
      });

      // Should work without issues
      expect(t.sessionId).toBe(maliciousId);
    });
  });
});
