/**
 * Redis Session Store Tests
 *
 * Tests for the Redis-backed session storage implementation.
 * Uses mocked RedisStorageAdapter from @frontmcp/utils.
 */
import { RedisSessionStore } from '../session/redis-session.store';
import type { StoredSession, TransportSession } from '../session/transport-session.types';
import { SessionIdEmptyError } from '../errors';

// Mock the RedisStorageAdapter from @frontmcp/utils
const mockStorageAdapter = {
  connect: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(true),
  exists: jest.fn().mockResolvedValue(false),
  expire: jest.fn().mockResolvedValue(true),
  getClient: jest.fn().mockReturnValue(null),
};

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  RedisStorageAdapter: jest.fn().mockImplementation(() => mockStorageAdapter),
}));

// Mock Redis client for direct GETEX calls
const mockRedisClient = {
  getex: jest.fn(),
};

describe('RedisSessionStore', () => {
  let store: RedisSessionStore;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset all mock implementations to defaults
    mockStorageAdapter.connect.mockResolvedValue(undefined);
    mockStorageAdapter.disconnect.mockResolvedValue(undefined);
    mockStorageAdapter.ping.mockResolvedValue(true);
    mockStorageAdapter.get.mockResolvedValue(null);
    mockStorageAdapter.set.mockResolvedValue(undefined);
    mockStorageAdapter.delete.mockResolvedValue(true);
    mockStorageAdapter.exists.mockResolvedValue(false);
    mockStorageAdapter.expire.mockResolvedValue(true);
    mockStorageAdapter.getClient.mockReturnValue(mockRedisClient);
    mockRedisClient.getex.mockResolvedValue(null);

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
      const mockRedis = {} as never;
      const newStore = new RedisSessionStore({
        redis: mockRedis,
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
      mockRedisClient.getex.mockResolvedValue(null);

      const result = await store.get('nonexistent-session');
      expect(result).toBeNull();
    });

    it('should return session for valid data', async () => {
      const storedSession = createValidStoredSession();
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');

      expect(result).not.toBeNull();
      expect(result?.session.id).toBe(storedSession.session.id);
    });

    it('should use GETEX to atomically extend TTL', async () => {
      const storedSession = createValidStoredSession();
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

      await store.get('test-session-id');

      expect(mockRedisClient.getex).toHaveBeenCalledWith(
        'mcp:session:test-session-id',
        'EX',
        3600, // default TTL in seconds
      );
    });

    it('should fallback to storage.get() when getex() fails', async () => {
      const storedSession = createValidStoredSession();
      mockRedisClient.getex.mockRejectedValue(new Error('GETEX not supported'));
      mockStorageAdapter.get.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');

      expect(result).not.toBeNull();
      expect(mockStorageAdapter.get).toHaveBeenCalledWith('test-session-id');
      expect(mockStorageAdapter.expire).toHaveBeenCalledWith('test-session-id', 3600);
    });

    it('should return null and delete corrupted JSON', async () => {
      mockRedisClient.getex.mockResolvedValue('not valid json {{{');

      const result = await store.get('test-session-id');
      expect(result).toBeNull();
      // Corrupted data should be deleted to prevent repeated failures (poison pill prevention)
      // Wait for fire-and-forget delete to complete
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockStorageAdapter.delete).toHaveBeenCalledWith('test-session-id');
    });

    it('should return null for invalid schema', async () => {
      // Missing required fields
      mockRedisClient.getex.mockResolvedValue(JSON.stringify({ invalid: true }));

      const result = await store.get('test-session-id');
      expect(result).toBeNull();
    });

    it('should delete and return null for logically expired session', async () => {
      const storedSession = createValidStoredSession();
      storedSession.session.expiresAt = Date.now() - 1000; // Expired 1 second ago
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');

      expect(result).toBeNull();
      expect(mockStorageAdapter.delete).toHaveBeenCalledWith('test-session-id');
    });

    it('should update lastAccessedAt timestamp', async () => {
      const storedSession = createValidStoredSession();
      const originalLastAccessed = storedSession.lastAccessedAt;
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');

      expect(result).not.toBeNull();
      expect(result!.lastAccessedAt).toBeGreaterThanOrEqual(originalLastAccessed);
    });

    it('should use custom key prefix', async () => {
      const customStore = new RedisSessionStore({
        host: 'localhost',
        keyPrefix: 'custom:',
      });
      const storedSession = createValidStoredSession();
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

      await customStore.get('test-session-id');

      expect(mockRedisClient.getex).toHaveBeenCalledWith('custom:test-session-id', 'EX', expect.any(Number));
    });

    it('should handle session with no expiresAt', async () => {
      const storedSession = createValidStoredSession();
      delete storedSession.session.expiresAt;
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

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

      expect(mockStorageAdapter.set).toHaveBeenCalledWith('test-session-id', expect.any(String), { ttlSeconds: 60 });
    });

    it('should use session expiresAt when no TTL provided', async () => {
      const storedSession = createValidStoredSession();
      const futureExpiry = Date.now() + 3600000; // 1 hour
      storedSession.session.expiresAt = futureExpiry;

      await store.set('test-session-id', storedSession);

      expect(mockStorageAdapter.set).toHaveBeenCalledWith('test-session-id', expect.any(String), {
        ttlSeconds: expect.any(Number),
      });
    });

    it('should set session without TTL when no expiry', async () => {
      const storedSession = createValidStoredSession();
      delete storedSession.session.expiresAt;

      await store.set('test-session-id', storedSession);

      expect(mockStorageAdapter.set).toHaveBeenCalledWith('test-session-id', expect.any(String));
    });

    it('should store already expired session (cleaned on next access)', async () => {
      const storedSession = createValidStoredSession();
      storedSession.session.expiresAt = Date.now() - 1000; // Already expired

      await store.set('test-session-id', storedSession);

      expect(mockStorageAdapter.set).toHaveBeenCalled();
    });

    it('should serialize session as JSON', async () => {
      const storedSession = createValidStoredSession();

      await store.set('test-session-id', storedSession, 60000);

      const callArgs = mockStorageAdapter.set.mock.calls[0];
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

      expect(mockStorageAdapter.delete).toHaveBeenCalledWith('test-session-id');
    });

    it('should use custom key prefix (handled by adapter)', async () => {
      const customStore = new RedisSessionStore({
        host: 'localhost',
        keyPrefix: 'custom:',
      });

      await customStore.delete('test-session-id');

      // Key prefix is handled by the adapter, so we just pass the session ID
      expect(mockStorageAdapter.delete).toHaveBeenCalledWith('test-session-id');
    });
  });

  // ============================================
  // exists() Tests
  // ============================================

  describe('exists', () => {
    it('should return true when session exists', async () => {
      mockStorageAdapter.exists.mockResolvedValue(true);

      const result = await store.exists('test-session-id');
      expect(result).toBe(true);
    });

    it('should return false when session does not exist', async () => {
      mockStorageAdapter.exists.mockResolvedValue(false);

      const result = await store.exists('test-session-id');
      expect(result).toBe(false);
    });

    it('should use correct key format', async () => {
      await store.exists('test-session-id');

      expect(mockStorageAdapter.exists).toHaveBeenCalledWith('test-session-id');
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
      mockStorageAdapter.ping.mockResolvedValue(true);

      const result = await store.ping();
      expect(result).toBe(true);
    });

    it('should return false when Redis is unhealthy', async () => {
      mockStorageAdapter.ping.mockResolvedValue(false);

      const result = await store.ping();
      expect(result).toBe(false);
    });

    it('should return false when Redis throws error', async () => {
      mockStorageAdapter.connect.mockRejectedValue(new Error('Connection refused'));

      const result = await store.ping();
      expect(result).toBe(false);
    });

    it('should log error when connection fails', async () => {
      const mockLogger = {
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
        child: jest.fn(),
      };

      const storeWithLogger = new RedisSessionStore({ host: 'localhost', port: 6379 }, mockLogger as never);

      mockStorageAdapter.connect.mockRejectedValue(new Error('Connection refused'));

      const result = await storeWithLogger.ping();

      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledWith('[RedisSessionStore] Connection failed', {
        error: 'Connection refused',
      });
    });
  });

  // ============================================
  // disconnect() Tests
  // ============================================

  describe('disconnect', () => {
    it('should call disconnect on owned connection', async () => {
      await store.disconnect();

      expect(mockStorageAdapter.disconnect).toHaveBeenCalled();
    });

    it('should not call disconnect on external connection', async () => {
      const mockRedis = {} as never;
      const externalStore = new RedisSessionStore({
        redis: mockRedis,
      });

      await externalStore.disconnect();

      // disconnect should not be called for external instance
      expect(mockStorageAdapter.disconnect).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // getRedisClient() Tests
  // ============================================

  describe('getRedisClient', () => {
    it('should return the Redis client from adapter', () => {
      mockStorageAdapter.getClient.mockReturnValue(mockRedisClient);
      const client = store.getRedisClient();
      expect(client).toBe(mockRedisClient);
    });

    it('should return undefined when adapter has no client', () => {
      mockStorageAdapter.getClient.mockReturnValue(undefined);
      const client = store.getRedisClient();
      expect(client).toBeUndefined();
    });
  });

  // ============================================
  // Edge Cases Tests
  // ============================================

  describe('Edge Cases', () => {
    it('should handle sessionId with colons', async () => {
      const storedSession = createValidStoredSession();
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

      await store.get('session:with:colons');

      expect(mockRedisClient.getex).toHaveBeenCalledWith('mcp:session:session:with:colons', 'EX', expect.any(Number));
    });

    it('should reject empty sessionId', async () => {
      await expect(store.get('')).rejects.toThrow(SessionIdEmptyError);
      await expect(store.set('', createValidStoredSession())).rejects.toThrow(SessionIdEmptyError);
      await expect(store.delete('')).rejects.toThrow(SessionIdEmptyError);
      await expect(store.exists('')).rejects.toThrow(SessionIdEmptyError);
    });

    it('should handle very long sessionId', async () => {
      const longId = 'x'.repeat(1000);
      const storedSession = createValidStoredSession();
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

      await store.get(longId);

      expect(mockRedisClient.getex).toHaveBeenCalledWith(`mcp:session:${longId}`, 'EX', expect.any(Number));
    });

    it('should handle session with large meta field', async () => {
      const storedSession = createValidStoredSession();
      // Add large metadata
      (storedSession as unknown as Record<string, unknown>)['meta'] = {
        largeField: 'x'.repeat(10000),
      };
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

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
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

      const result = await store.get('test-session-id');
      expect(result).not.toBeNull();
      expect(result?.tokens).toBeDefined();
    });

    it('should handle concurrent get requests', async () => {
      const storedSession = createValidStoredSession();
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(storedSession));

      const results = await Promise.all([store.get('session1'), store.get('session2'), store.get('session3')]);

      expect(results.every((r) => r !== null)).toBe(true);
      expect(mockRedisClient.getex).toHaveBeenCalledTimes(3);
    });

    it('should handle concurrent set requests', async () => {
      const sessions = [createValidStoredSession(), createValidStoredSession(), createValidStoredSession()];

      await Promise.all([
        store.set('session1', sessions[0]),
        store.set('session2', sessions[1]),
        store.set('session3', sessions[2]),
      ]);

      expect(mockStorageAdapter.set).toHaveBeenCalledTimes(3);
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
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(invalid));

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
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(invalid));

      const result = await store.get('test-session-id');
      expect(result).toBeNull();
    });

    it('should accept session with all valid fields', async () => {
      const valid = createValidStoredSession();
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(valid));

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
      mockRedisClient.getex.mockResolvedValue(JSON.stringify(valid));

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
