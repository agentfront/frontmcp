/**
 * Redis Session Store Tests
 *
 * Tests for the Redis-backed session storage implementation.
 */
import { RedisSessionStore } from '../redis-session.store';
import { StoredSession, TransportSession } from '../transport-session.types';

// Mock ioredis
jest.mock('ioredis', () => {
  return {
    default: jest.fn().mockImplementation(() => mockRedisInstance),
    __esModule: true,
  };
});

// Mock Redis instance with all methods
const mockRedisInstance = {
  get: jest.fn(),
  getex: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  ping: jest.fn(),
  quit: jest.fn(),
  pexpire: jest.fn(),
};

describe('RedisSessionStore', () => {
  let store: RedisSessionStore;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset all mock implementations to defaults
    mockRedisInstance.get.mockResolvedValue(null);
    mockRedisInstance.getex.mockResolvedValue(null);
    mockRedisInstance.set.mockResolvedValue('OK');
    mockRedisInstance.del.mockResolvedValue(1);
    mockRedisInstance.exists.mockResolvedValue(0);
    mockRedisInstance.ping.mockResolvedValue('PONG');
    mockRedisInstance.quit.mockResolvedValue('OK');
    mockRedisInstance.pexpire.mockResolvedValue(1);

    store = new RedisSessionStore({
      host: 'localhost',
      port: 6379,
    });
  });

  // ============================================
  // Constructor Tests
  // ============================================

  describe('constructor', () => {
    it('should create store with default config', () => {
      const newStore = new RedisSessionStore({
        host: 'localhost',
      });
      expect(newStore).toBeDefined();
    });

    it('should create store with custom port', () => {
      const newStore = new RedisSessionStore({
        host: 'localhost',
        port: 6380,
      });
      expect(newStore).toBeDefined();
    });

    it('should create store with password', () => {
      const newStore = new RedisSessionStore({
        host: 'localhost',
        password: 'secret',
      });
      expect(newStore).toBeDefined();
    });

    it('should create store with database number', () => {
      const newStore = new RedisSessionStore({
        host: 'localhost',
        db: 1,
      });
      expect(newStore).toBeDefined();
    });

    it('should create store with TLS enabled', () => {
      const newStore = new RedisSessionStore({
        host: 'localhost',
        tls: true,
      });
      expect(newStore).toBeDefined();
    });

    it('should create store with custom key prefix', () => {
      const newStore = new RedisSessionStore({
        host: 'localhost',
        keyPrefix: 'custom:prefix:',
      });
      expect(newStore).toBeDefined();
    });

    it('should create store with custom defaultTtlMs', () => {
      const newStore = new RedisSessionStore({
        host: 'localhost',
        defaultTtlMs: 7200000,
      });
      expect(newStore).toBeDefined();
    });

    it('should accept external Redis instance', () => {
      const newStore = new RedisSessionStore({
        redis: mockRedisInstance as never,
        keyPrefix: 'ext:',
      });
      expect(newStore).toBeDefined();
    });
  });

  // ============================================
  // get() Tests
  // ============================================

  describe('get', () => {
    it('should return null for non-existent session', async () => {
      mockRedisInstance.getex.mockResolvedValue(null);

      const result = await store.get('nonexistent-session');
      expect(result).toBeNull();
    });

    it('should return session for valid data', async () => {
      const storedSession = createValidStoredSession();
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');

      expect(result).not.toBeNull();
      expect(result?.session.id).toBe(storedSession.session.id);
    });

    it('should use GETEX to atomically extend TTL', async () => {
      const storedSession = createValidStoredSession();
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      await store.get('test-session-id');

      expect(mockRedisInstance.getex).toHaveBeenCalledWith(
        'mcp:session:test-session-id',
        'PX',
        3600000, // default TTL
      );
    });

    it('should fallback to get() when getex() fails', async () => {
      const storedSession = createValidStoredSession();
      mockRedisInstance.getex.mockRejectedValue(new Error('GETEX not supported'));
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');

      expect(result).not.toBeNull();
      expect(mockRedisInstance.get).toHaveBeenCalled();
    });

    it('should return null and delete corrupted JSON', async () => {
      mockRedisInstance.getex.mockResolvedValue('not valid json {{{');

      const result = await store.get('test-session-id');
      expect(result).toBeNull();
      // Corrupted data should be deleted to prevent repeated failures (poison pill prevention)
      expect(mockRedisInstance.del).toHaveBeenCalledWith('mcp:session:test-session-id');
    });

    it('should return null for invalid schema', async () => {
      // Missing required fields
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify({ invalid: true }));

      const result = await store.get('test-session-id');
      expect(result).toBeNull();
    });

    it('should delete and return null for logically expired session', async () => {
      const storedSession = createValidStoredSession();
      storedSession.session.expiresAt = Date.now() - 1000; // Expired 1 second ago
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');

      expect(result).toBeNull();
      expect(mockRedisInstance.del).toHaveBeenCalledWith('mcp:session:test-session-id');
    });

    it('should update lastAccessedAt timestamp', async () => {
      const storedSession = createValidStoredSession();
      const originalLastAccessed = storedSession.lastAccessedAt;
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');

      expect(result).not.toBeNull();
      expect(result!.lastAccessedAt).toBeGreaterThanOrEqual(originalLastAccessed);
    });

    it('should use custom key prefix', async () => {
      const customStore = new RedisSessionStore({
        redis: mockRedisInstance as never,
        keyPrefix: 'custom:',
      });
      const storedSession = createValidStoredSession();
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      await customStore.get('test-session-id');

      expect(mockRedisInstance.getex).toHaveBeenCalledWith('custom:test-session-id', 'PX', expect.any(Number));
    });

    it('should handle session with no expiresAt', async () => {
      const storedSession = createValidStoredSession();
      delete storedSession.session.expiresAt;
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');
      expect(result).not.toBeNull();
    });
  });

  // ============================================
  // set() Tests
  // ============================================

  describe('set', () => {
    it('should set session with TTL', async () => {
      const storedSession = createValidStoredSession();

      await store.set('test-session-id', storedSession, 60000);

      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        'mcp:session:test-session-id',
        expect.any(String),
        'PX',
        60000,
      );
    });

    it('should use session expiresAt when no TTL provided', async () => {
      const storedSession = createValidStoredSession();
      const futureExpiry = Date.now() + 3600000; // 1 hour
      storedSession.session.expiresAt = futureExpiry;

      await store.set('test-session-id', storedSession);

      expect(mockRedisInstance.set).toHaveBeenCalledWith(
        'mcp:session:test-session-id',
        expect.any(String),
        'PX',
        expect.any(Number), // TTL calculated from expiresAt
      );
    });

    it('should set session without TTL when no expiry', async () => {
      const storedSession = createValidStoredSession();
      delete storedSession.session.expiresAt;

      await store.set('test-session-id', storedSession);

      expect(mockRedisInstance.set).toHaveBeenCalledWith('mcp:session:test-session-id', expect.any(String));
    });

    it('should store already expired session (cleaned on next access)', async () => {
      const storedSession = createValidStoredSession();
      storedSession.session.expiresAt = Date.now() - 1000; // Already expired

      await store.set('test-session-id', storedSession);

      expect(mockRedisInstance.set).toHaveBeenCalled();
    });

    it('should serialize session as JSON', async () => {
      const storedSession = createValidStoredSession();

      await store.set('test-session-id', storedSession, 60000);

      const callArgs = mockRedisInstance.set.mock.calls[0];
      const storedValue = callArgs[1];
      expect(() => JSON.parse(storedValue)).not.toThrow();

      const parsed = JSON.parse(storedValue);
      expect(parsed.session.id).toBe(storedSession.session.id);
    });
  });

  // ============================================
  // delete() Tests
  // ============================================

  describe('delete', () => {
    it('should delete session by ID', async () => {
      await store.delete('test-session-id');

      expect(mockRedisInstance.del).toHaveBeenCalledWith('mcp:session:test-session-id');
    });

    it('should use custom key prefix', async () => {
      const customStore = new RedisSessionStore({
        redis: mockRedisInstance as never,
        keyPrefix: 'custom:',
      });

      await customStore.delete('test-session-id');

      expect(mockRedisInstance.del).toHaveBeenCalledWith('custom:test-session-id');
    });
  });

  // ============================================
  // exists() Tests
  // ============================================

  describe('exists', () => {
    it('should return true when session exists', async () => {
      mockRedisInstance.exists.mockResolvedValue(1);

      const result = await store.exists('test-session-id');
      expect(result).toBe(true);
    });

    it('should return false when session does not exist', async () => {
      mockRedisInstance.exists.mockResolvedValue(0);

      const result = await store.exists('test-session-id');
      expect(result).toBe(false);
    });

    it('should use correct key format', async () => {
      await store.exists('test-session-id');

      expect(mockRedisInstance.exists).toHaveBeenCalledWith('mcp:session:test-session-id');
    });
  });

  // ============================================
  // allocId() Tests
  // ============================================

  describe('allocId', () => {
    it('should return a UUID', () => {
      const id = store.allocId();

      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should return unique IDs on each call', () => {
      const id1 = store.allocId();
      const id2 = store.allocId();

      expect(id1).not.toBe(id2);
    });
  });

  // ============================================
  // ping() Tests
  // ============================================

  describe('ping', () => {
    it('should return true when Redis is healthy', async () => {
      mockRedisInstance.ping.mockResolvedValue('PONG');

      const result = await store.ping();
      expect(result).toBe(true);
    });

    it('should return false when Redis responds with wrong value', async () => {
      mockRedisInstance.ping.mockResolvedValue('WRONG');

      const result = await store.ping();
      expect(result).toBe(false);
    });

    it('should return false when Redis throws error', async () => {
      mockRedisInstance.ping.mockRejectedValue(new Error('Connection refused'));

      const result = await store.ping();
      expect(result).toBe(false);
    });
  });

  // ============================================
  // disconnect() Tests
  // ============================================

  describe('disconnect', () => {
    it('should call quit on owned connection', async () => {
      await store.disconnect();

      expect(mockRedisInstance.quit).toHaveBeenCalled();
    });

    it('should not call quit on external connection', async () => {
      const externalStore = new RedisSessionStore({
        redis: mockRedisInstance as never,
      });

      await externalStore.disconnect();

      // quit should not be called for external instance
      expect(mockRedisInstance.quit).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // getRedisClient() Tests
  // ============================================

  describe('getRedisClient', () => {
    it('should return the Redis client', () => {
      const client = store.getRedisClient();
      expect(client).toBeDefined();
    });
  });

  // ============================================
  // Edge Cases Tests
  // ============================================

  describe('Edge Cases', () => {
    it('should handle sessionId with colons', async () => {
      const storedSession = createValidStoredSession();
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      await store.get('session:with:colons');

      expect(mockRedisInstance.getex).toHaveBeenCalledWith('mcp:session:session:with:colons', 'PX', expect.any(Number));
    });

    it('should reject empty sessionId', async () => {
      await expect(store.get('')).rejects.toThrow('[RedisSessionStore] sessionId cannot be empty');
      await expect(store.set('', createValidStoredSession())).rejects.toThrow(
        '[RedisSessionStore] sessionId cannot be empty',
      );
      await expect(store.delete('')).rejects.toThrow('[RedisSessionStore] sessionId cannot be empty');
      await expect(store.exists('')).rejects.toThrow('[RedisSessionStore] sessionId cannot be empty');
    });

    it('should handle very long sessionId', async () => {
      const longId = 'x'.repeat(1000);
      const storedSession = createValidStoredSession();
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      await store.get(longId);

      expect(mockRedisInstance.getex).toHaveBeenCalledWith(`mcp:session:${longId}`, 'PX', expect.any(Number));
    });

    it('should handle session with large meta field', async () => {
      const storedSession = createValidStoredSession();
      // Add large metadata
      (storedSession as unknown as Record<string, unknown>)['meta'] = {
        largeField: 'x'.repeat(10000),
      };
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');
      expect(result).not.toBeNull();
    });

    it('should handle session with tokens', async () => {
      const storedSession = createValidStoredSession();
      storedSession.tokens = {
        slack: {
          alg: 'A256GCM',
          iv: 'base64iv',
          tag: 'base64tag',
          data: 'encryptedData',
        },
      };
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');
      expect(result).not.toBeNull();
      expect(result?.tokens).toBeDefined();
    });

    it('should handle concurrent get requests', async () => {
      const storedSession = createValidStoredSession();
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(storedSession));

      const results = await Promise.all([store.get('session1'), store.get('session2'), store.get('session3')]);

      expect(results.every((r) => r !== null)).toBe(true);
      expect(mockRedisInstance.getex).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent set requests', async () => {
      const sessions = [createValidStoredSession(), createValidStoredSession(), createValidStoredSession()];

      await Promise.all([
        store.set('session1', sessions[0]),
        store.set('session2', sessions[1]),
        store.set('session3', sessions[2]),
      ]);

      expect(mockRedisInstance.set).toHaveBeenCalledTimes(3);
    });
  });

  // ============================================
  // Schema Validation Tests
  // ============================================

  describe('Schema Validation', () => {
    it('should reject session missing required session field', async () => {
      const invalid = {
        authorizationId: 'auth-123',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(invalid));

      const result = await store.get('test-session-id');
      expect(result).toBeNull();
    });

    it('should reject session missing authorizationId', async () => {
      const invalid = {
        session: {
          id: 'session-123',
          authorizationId: 'auth-123',
          protocol: 'streamable-http',
          createdAt: Date.now(),
          nodeId: 'node-1',
        },
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(invalid));

      const result = await store.get('test-session-id');
      expect(result).toBeNull();
    });

    it('should accept session with all valid fields', async () => {
      const valid = createValidStoredSession();
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(valid));

      const result = await store.get('test-session-id');
      expect(result).not.toBeNull();
    });

    it('should accept session with transportState', async () => {
      const valid = createValidStoredSession();
      valid.session.transportState = {
        type: 'streamable-http',
        requestSeq: 1,
        activeStreamId: 'stream-1',
      };
      mockRedisInstance.getex.mockResolvedValue(JSON.stringify(valid));

      const result = await store.get('test-session-id');
      expect(result).not.toBeNull();
      expect(result?.session.transportState?.type).toBe('streamable-http');
    });
  });
});

// ============================================
// Test Helpers
// ============================================

function createValidStoredSession(): StoredSession {
  const now = Date.now();
  const session: TransportSession = {
    id: 'session-' + now,
    authorizationId: 'auth-' + now,
    protocol: 'streamable-http',
    createdAt: now,
    expiresAt: now + 3600000,
    nodeId: 'node-1',
  };

  return {
    session,
    authorizationId: session.authorizationId,
    createdAt: now,
    lastAccessedAt: now,
  };
}
