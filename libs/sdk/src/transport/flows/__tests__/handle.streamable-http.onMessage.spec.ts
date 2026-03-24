/**
 * Tests for the production streamable HTTP transport lookup helper.
 *
 * Validates the three-tier resolution priority:
 * 1. In-memory transport
 * 2. Redis stored session recreation
 * 3. Session-expired vs session-not-found differentiation
 */

import type { StoredSession } from '@frontmcp/auth';
import { lookupStreamableHttpTransport } from '../handle.streamable-http.flow';

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

  describe('tier 1: in-memory transport', () => {
    it('should find transport in memory and return it', async () => {
      const transport = createMockTransport();
      const svc = createMockTransportService({
        getTransporter: jest.fn().mockResolvedValue(transport),
      });

      const result = await lookupStreamableHttpTransport({
        transportService: svc,
        token: 'token-1',
        sessionId: 'session-1',
        response: {} as never,
      });

      expect(result).toMatchObject({ kind: 'transport', source: 'memory' });
      expect(svc.getStoredSession).not.toHaveBeenCalled();

      if (result.kind !== 'transport') {
        throw new Error(`Expected transport result, received ${result.kind}`);
      }

      await result.transport.handleRequest({ body: { method: 'tools/list' } }, {});
      expect(transport.handleRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('tier 2: Redis recreation', () => {
    it('should recreate transport from Redis when not in memory', async () => {
      const transport = createMockTransport();
      const storedSession = { initialized: true, createdAt: Date.now() } as StoredSession;
      const svc = createMockTransportService({
        getStoredSession: jest.fn().mockResolvedValue(storedSession),
        recreateTransporter: jest.fn().mockResolvedValue(transport),
      });

      const result = await lookupStreamableHttpTransport({
        transportService: svc,
        token: 'token-1',
        sessionId: 'session-1',
        response: {} as never,
      });

      expect(result).toMatchObject({ kind: 'transport', source: 'redis' });
      expect(svc.getStoredSession).toHaveBeenCalledWith('streamable-http', 'token-1', 'session-1');
      expect(svc.recreateTransporter).toHaveBeenCalled();

      if (result.kind !== 'transport') {
        throw new Error(`Expected transport result, received ${result.kind}`);
      }

      await result.transport.handleRequest({ body: { method: 'tools/call' } }, {});
      expect(transport.handleRequest).toHaveBeenCalled();
    });

    it('should handle Redis recreation failure gracefully', async () => {
      const svc = createMockTransportService({
        getStoredSession: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
        wasSessionCreatedAsync: jest.fn().mockResolvedValue(false),
      });

      const result = await lookupStreamableHttpTransport({
        transportService: svc,
        token: 'token-1',
        sessionId: 'session-1',
        response: {} as never,
      });

      expect(result.kind).toBe('session-not-initialized');
      if (result.kind === 'transport') {
        throw new Error('Expected lookup to fail after Redis recreation error');
      }
      expect(result.recreationError).toBeInstanceOf(Error);
    });
  });

  describe('tier 3: session differentiation', () => {
    it('should respond "session expired" when session was previously created', async () => {
      const svc = createMockTransportService({
        wasSessionCreatedAsync: jest.fn().mockResolvedValue(true),
      });

      const result = await lookupStreamableHttpTransport({
        transportService: svc,
        token: 'token-1',
        sessionId: 'expired-session',
        response: {} as never,
      });

      expect(result.kind).toBe('session-expired');
    });

    it('should respond "session not initialized" when session never existed', async () => {
      const svc = createMockTransportService({
        wasSessionCreatedAsync: jest.fn().mockResolvedValue(false),
      });

      const result = await lookupStreamableHttpTransport({
        transportService: svc,
        token: 'token-1',
        sessionId: 'fabricated-session',
        response: {} as never,
      });

      expect(result.kind).toBe('session-not-initialized');
    });
  });

  describe('error handling', () => {
    it('should surface transport handleRequest errors from the resolved transport', async () => {
      const transport = createMockTransport();
      transport.handleRequest.mockRejectedValue(new Error('MCP error'));
      const svc = createMockTransportService({
        getTransporter: jest.fn().mockResolvedValue(transport),
      });

      const result = await lookupStreamableHttpTransport({
        transportService: svc,
        token: 'token-1',
        sessionId: 'session-1',
        response: {} as never,
      });

      if (result.kind !== 'transport') {
        throw new Error(`Expected transport result, received ${result.kind}`);
      }

      await expect(result.transport.handleRequest({ body: { method: 'tools/call' } }, {})).rejects.toThrow('MCP error');
    });
  });
});
