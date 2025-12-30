/**
 * Unit Tests for RecreateableStreamableHTTPServerTransport
 *
 * Tests for session recreation capabilities in serverless and
 * multi-instance environments. Ensures proper handling of:
 * - setInitializationState() for session restoration
 * - Cold start recreation scenarios
 * - Invalid session ID handling
 * - MCP SDK compatibility
 */
import { RecreateableStreamableHTTPServerTransport } from '../streamable-http-transport';

// Mock the MCP SDK StreamableHTTPServerTransport
jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class MockStreamableHTTPServerTransport {
    _webStandardTransport: {
      _initialized: boolean;
      sessionId: string | undefined;
    };

    constructor() {
      this._webStandardTransport = {
        _initialized: false,
        sessionId: undefined,
      };
    }
  },
}));

describe('RecreateableStreamableHTTPServerTransport', () => {
  let transport: RecreateableStreamableHTTPServerTransport;

  beforeEach(() => {
    jest.clearAllMocks();
    transport = new RecreateableStreamableHTTPServerTransport();
  });

  describe('constructor', () => {
    it('should create transport with default options', () => {
      const t = new RecreateableStreamableHTTPServerTransport();
      expect(t).toBeDefined();
      expect(t.isInitialized).toBe(false);
    });

    it('should create transport with custom options', () => {
      const sessionIdGenerator = () => 'test-session';
      const onsessioninitialized = jest.fn();
      const t = new RecreateableStreamableHTTPServerTransport({
        sessionIdGenerator,
        enableJsonResponse: true,
        onsessioninitialized,
      });
      expect(t).toBeDefined();
    });
  });

  describe('isInitialized', () => {
    it('should return false for new transport', () => {
      expect(transport.isInitialized).toBe(false);
    });

    it('should return true after setInitializationState', () => {
      transport.setInitializationState('session-123');
      expect(transport.isInitialized).toBe(true);
    });

    it('should handle missing internal transport gracefully', () => {
      // Access internal property and set to undefined
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = undefined;
      expect(transport.isInitialized).toBe(false);
    });
  });

  describe('setInitializationState', () => {
    it('should mark transport as initialized with session ID', () => {
      transport.setInitializationState('session-123');

      expect(transport.isInitialized).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const webTransport = (transport as any)._webStandardTransport;
      expect(webTransport.sessionId).toBe('session-123');
    });

    it('should allow different session IDs', () => {
      transport.setInitializationState('session-abc');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport as any)._webStandardTransport.sessionId).toBe('session-abc');

      // Create new transport with different session
      const transport2 = new RecreateableStreamableHTTPServerTransport();
      transport2.setInitializationState('session-xyz');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport2 as any)._webStandardTransport.sessionId).toBe('session-xyz');
    });

    it('should not affect other transport instances', () => {
      const transport1 = new RecreateableStreamableHTTPServerTransport();
      const transport2 = new RecreateableStreamableHTTPServerTransport();

      transport1.setInitializationState('session-1');

      expect(transport1.isInitialized).toBe(true);
      expect(transport2.isInitialized).toBe(false);
    });

    it('should throw error for empty session ID', () => {
      expect(() => transport.setInitializationState('')).toThrow(
        '[RecreateableStreamableHTTPServerTransport] sessionId cannot be empty',
      );
    });

    it('should throw error for whitespace-only session ID', () => {
      expect(() => transport.setInitializationState('   ')).toThrow(
        '[RecreateableStreamableHTTPServerTransport] sessionId cannot be empty',
      );
    });

    it('should throw error for non-string session ID', () => {
      // @ts-expect-error Testing invalid input
      expect(() => transport.setInitializationState(null)).toThrow(
        '[RecreateableStreamableHTTPServerTransport] sessionId cannot be empty',
      );
      // @ts-expect-error Testing invalid input
      expect(() => transport.setInitializationState(undefined)).toThrow(
        '[RecreateableStreamableHTTPServerTransport] sessionId cannot be empty',
      );
    });

    it('should store pending state when internal transport is missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = undefined;

      transport.setInitializationState('session-123');

      // State should be pending, not applied
      expect(transport.isInitialized).toBe(false);
      expect(transport.hasPendingInitState).toBe(true);
    });

    it('should throw error when expected fields are missing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = {}; // Missing _initialized and sessionId

      expect(() => transport.setInitializationState('session-123')).toThrow(
        'Expected fields not found on internal transport',
      );
    });
  });

  describe('hasPendingInitState', () => {
    it('should return false when no pending state', () => {
      expect(transport.hasPendingInitState).toBe(false);
    });

    it('should return true when state is pending', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = undefined;
      transport.setInitializationState('session-123');
      expect(transport.hasPendingInitState).toBe(true);
    });

    it('should return false after state is applied', () => {
      transport.setInitializationState('session-123');
      expect(transport.hasPendingInitState).toBe(false);
    });
  });

  describe('deferred initialization (serverless cold start)', () => {
    it('should store initialization state when _webStandardTransport does not exist', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = undefined;

      transport.setInitializationState('deferred-session-id');

      // Should not be initialized yet (no transport to set flags on)
      expect(transport.isInitialized).toBe(false);
      // But should have pending state
      expect(transport.hasPendingInitState).toBe(true);
    });

    it('should apply pending state on handleRequest when transport becomes available', async () => {
      // Start with no internal transport
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = undefined;

      // Set initialization state (will be stored as pending)
      transport.setInitializationState('cold-start-session');

      expect(transport.isInitialized).toBe(false);
      expect(transport.hasPendingInitState).toBe(true);

      // Simulate internal transport being created (happens on first request in MCP SDK)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = {
        _initialized: false,
        sessionId: undefined,
      };

      // Mock handleRequest on parent class
      const mockHandleRequest = jest.fn().mockResolvedValue(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.getPrototypeOf(Object.getPrototypeOf(transport)).handleRequest = mockHandleRequest;

      // Call handleRequest - should apply pending state
      await transport.handleRequest({}, {}, {});

      // Now should be initialized
      expect(transport.isInitialized).toBe(true);
      expect(transport.hasPendingInitState).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport as any)._webStandardTransport.sessionId).toBe('cold-start-session');
    });

    it('should not apply pending state if _webStandardTransport still missing on handleRequest', async () => {
      // Start with no internal transport
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = undefined;

      transport.setInitializationState('pending-session');

      // Mock handleRequest on parent class
      const mockHandleRequest = jest.fn().mockResolvedValue(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.getPrototypeOf(Object.getPrototypeOf(transport)).handleRequest = mockHandleRequest;

      // Call handleRequest without transport being available
      await transport.handleRequest({}, {}, {});

      // Pending state should still exist (waiting for transport)
      expect(transport.hasPendingInitState).toBe(true);
    });

    it('should clear pending state after applying', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = undefined;
      transport.setInitializationState('clear-test-session');

      // Simulate transport becoming available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport = {
        _initialized: false,
        sessionId: undefined,
      };

      const mockHandleRequest = jest.fn().mockResolvedValue(undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.getPrototypeOf(Object.getPrototypeOf(transport)).handleRequest = mockHandleRequest;

      // First request applies pending state
      await transport.handleRequest({}, {}, {});
      expect(transport.hasPendingInitState).toBe(false);

      // Reset initialized for second test
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (transport as any)._webStandardTransport._initialized = false;

      // Second request should not try to apply again
      await transport.handleRequest({}, {}, {});

      // handleRequest should still work without pending state
      expect(mockHandleRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('cold start recreation', () => {
    it('should recreate transport from stored session', () => {
      // Simulate cold start: new transport instance
      const newTransport = new RecreateableStreamableHTTPServerTransport();

      // Verify it starts uninitialized
      expect(newTransport.isInitialized).toBe(false);

      // Recreate from stored session ID
      newTransport.setInitializationState('stored-session-id');

      // Verify recreation succeeded
      expect(newTransport.isInitialized).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((newTransport as any)._webStandardTransport.sessionId).toBe('stored-session-id');
    });

    it('should maintain session metadata after recreation', () => {
      const sessionId = 'persistent-session-123';

      transport.setInitializationState(sessionId);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const webTransport = (transport as any)._webStandardTransport;
      expect(webTransport._initialized).toBe(true);
      expect(webTransport.sessionId).toBe(sessionId);
    });

    it('should handle recreation with UUID-style session IDs', () => {
      const uuidSessionId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
      transport.setInitializationState(uuidSessionId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport as any)._webStandardTransport.sessionId).toBe(uuidSessionId);
    });

    it('should handle recreation with special characters in session ID', () => {
      const specialSessionId = 'session:with-special_chars.and/slashes';
      transport.setInitializationState(specialSessionId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport as any)._webStandardTransport.sessionId).toBe(specialSessionId);
    });
  });

  describe('multi-instance failover simulation', () => {
    it('should allow different instances to recreate same session', () => {
      const sessionId = 'shared-session-123';

      // Instance A (original)
      const instanceA = new RecreateableStreamableHTTPServerTransport();
      instanceA.setInitializationState(sessionId);

      // Instance B (failover)
      const instanceB = new RecreateableStreamableHTTPServerTransport();
      instanceB.setInitializationState(sessionId);

      // Both should have same session ID
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((instanceA as any)._webStandardTransport.sessionId).toBe(sessionId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((instanceB as any)._webStandardTransport.sessionId).toBe(sessionId);
    });

    it('should handle sequential recreation (A fails, B takes over)', () => {
      const sessionId = 'failover-session';

      // Instance A creates session
      const instanceA = new RecreateableStreamableHTTPServerTransport();
      instanceA.setInitializationState(sessionId);
      expect(instanceA.isInitialized).toBe(true);

      // Simulate A going down (reference lost)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let referenceA: RecreateableStreamableHTTPServerTransport | null = instanceA;
      referenceA = null;

      // Instance B recreates from Redis
      const instanceB = new RecreateableStreamableHTTPServerTransport();
      instanceB.setInitializationState(sessionId);
      expect(instanceB.isInitialized).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very long session IDs', () => {
      const longSessionId = 'a'.repeat(1000);
      transport.setInitializationState(longSessionId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport as any)._webStandardTransport.sessionId).toBe(longSessionId);
    });

    it('should handle unicode in session IDs', () => {
      const unicodeSessionId = 'session-\u{1F600}-emoji';
      transport.setInitializationState(unicodeSessionId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport as any)._webStandardTransport.sessionId).toBe(unicodeSessionId);
    });

    it('should be idempotent - multiple calls with same ID', () => {
      transport.setInitializationState('session-123');
      transport.setInitializationState('session-123');
      transport.setInitializationState('session-123');

      expect(transport.isInitialized).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport as any)._webStandardTransport.sessionId).toBe('session-123');
    });

    it('should allow updating session ID (re-recreation)', () => {
      transport.setInitializationState('session-old');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport as any)._webStandardTransport.sessionId).toBe('session-old');

      transport.setInitializationState('session-new');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((transport as any)._webStandardTransport.sessionId).toBe('session-new');
    });
  });
});
