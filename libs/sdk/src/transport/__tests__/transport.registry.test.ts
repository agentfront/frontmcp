/**
 * Transport Registry Tests
 *
 * Tests for the TransportService which manages transport sessions and their lifecycle.
 */
import { createHash } from 'crypto';
import { TransportService } from '../transport.registry';

// Mock dependencies
jest.mock('../transport.local', () => ({
  LocalTransporter: jest.fn().mockImplementation((scope, key, res, onDispose) => ({
    ready: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockImplementation(async (reason?: string) => {
      if (onDispose) onDispose();
      return Promise.resolve();
    }),
    send: jest.fn(),
    markAsInitialized: jest.fn(),
    _onDispose: onDispose,
  })),
}));

jest.mock('../../auth/session/redis-session.store', () => ({
  RedisSessionStore: jest.fn().mockImplementation(() => mockRedisSessionStore),
}));

jest.mock('../../auth/authorization/authorization.class', () => ({
  getMachineId: jest.fn().mockReturnValue('test-machine-id'),
}));

// Mock the flows to prevent them from actually registering
jest.mock('../flows/handle.streamable-http.flow', () => ({}));
jest.mock('../flows/handle.sse.flow', () => ({}));
jest.mock('../flows/handle.stateless-http.flow', () => ({}));

// Mock Redis session store
const mockRedisSessionStore = {
  ping: jest.fn().mockResolvedValue(true),
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
  exists: jest.fn(),
  allocId: jest.fn().mockReturnValue('new-session-id'),
  disconnect: jest.fn().mockResolvedValue(undefined),
};

// Mock scope
const mockScope = {
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  },
  registryFlows: jest.fn().mockResolvedValue(undefined),
};

// Mock response object
const mockResponse = {
  setHeader: jest.fn(),
  write: jest.fn(),
  end: jest.fn(),
};

describe('TransportService', () => {
  let service: TransportService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedisSessionStore.ping.mockResolvedValue(true);
    mockRedisSessionStore.get.mockResolvedValue(null);
    mockRedisSessionStore.exists.mockResolvedValue(false);
  });

  afterEach(async () => {
    if (service) {
      await service.destroy();
    }
  });

  // ============================================
  // Constructor Tests
  // ============================================

  describe('constructor', () => {
    it('should create service without Redis config', async () => {
      service = new TransportService(mockScope as never);
      await service.ready;
      expect(service).toBeDefined();
    });

    it('should create service with Redis config', async () => {
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost', port: 6379 },
      });
      await service.ready;
      expect(service).toBeDefined();
    });

    it('should validate Redis connection on startup', async () => {
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost' },
      });
      await service.ready;
      expect(mockRedisSessionStore.ping).toHaveBeenCalled();
    });

    it('should disable session store when Redis ping fails', async () => {
      mockRedisSessionStore.ping.mockResolvedValue(false);
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost' },
      });
      await service.ready;
      expect(mockScope.logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to connect to redis'));
    });

    it('should use custom key prefix', async () => {
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost', keyPrefix: 'custom:prefix:' },
      });
      await service.ready;
      expect(service).toBeDefined();
    });

    it('should use custom defaultTtlMs', async () => {
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost' },
        defaultTtlMs: 7200000,
      });
      await service.ready;
      expect(service).toBeDefined();
    });
  });

  // ============================================
  // createTransporter Tests
  // ============================================

  describe('createTransporter', () => {
    beforeEach(async () => {
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost' },
      });
      await service.ready;
    });

    it('should create new transporter', async () => {
      const transport = await service.createTransporter(
        'streamable-http',
        'test-token',
        'session-123',
        mockResponse as never,
      );
      expect(transport).toBeDefined();
    });

    it('should return existing transporter for same key', async () => {
      const transport1 = await service.createTransporter(
        'streamable-http',
        'test-token',
        'session-123',
        mockResponse as never,
      );
      const transport2 = await service.createTransporter(
        'streamable-http',
        'test-token',
        'session-123',
        mockResponse as never,
      );
      expect(transport1).toBe(transport2);
    });

    it('should create different transporters for different sessions', async () => {
      const transport1 = await service.createTransporter(
        'streamable-http',
        'test-token',
        'session-1',
        mockResponse as never,
      );
      const transport2 = await service.createTransporter(
        'streamable-http',
        'test-token',
        'session-2',
        mockResponse as never,
      );
      expect(transport1).not.toBe(transport2);
    });

    it('should create different transporters for different tokens', async () => {
      const transport1 = await service.createTransporter(
        'streamable-http',
        'token-1',
        'session-123',
        mockResponse as never,
      );
      const transport2 = await service.createTransporter(
        'streamable-http',
        'token-2',
        'session-123',
        mockResponse as never,
      );
      expect(transport1).not.toBe(transport2);
    });

    it('should persist session to Redis for streamable-http', async () => {
      await service.createTransporter('streamable-http', 'test-token', 'session-123', mockResponse as never);
      expect(mockRedisSessionStore.set).toHaveBeenCalled();
    });

    it('should handle concurrent creation with mutex', async () => {
      // Start two concurrent creations
      const [transport1, transport2] = await Promise.all([
        service.createTransporter('streamable-http', 'test-token', 'session-mutex', mockResponse as never),
        service.createTransporter('streamable-http', 'test-token', 'session-mutex', mockResponse as never),
      ]);

      // Both should return the same instance
      expect(transport1).toBe(transport2);
    });
  });

  // ============================================
  // getTransporter Tests
  // ============================================

  describe('getTransporter', () => {
    beforeEach(async () => {
      service = new TransportService(mockScope as never);
      await service.ready;
    });

    it('should return undefined for non-existent session', async () => {
      const transport = await service.getTransporter('streamable-http', 'test-token', 'nonexistent');
      expect(transport).toBeUndefined();
    });

    it('should return existing transporter', async () => {
      await service.createTransporter('streamable-http', 'test-token', 'session-123', mockResponse as never);
      const transport = await service.getTransporter('streamable-http', 'test-token', 'session-123');
      expect(transport).toBeDefined();
    });
  });

  // ============================================
  // getStoredSession Tests
  // ============================================

  describe('getStoredSession', () => {
    beforeEach(async () => {
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost' },
      });
      await service.ready;
    });

    it('should return undefined when session not found', async () => {
      mockRedisSessionStore.get.mockResolvedValue(null);
      const session = await service.getStoredSession('streamable-http', 'test-token', 'nonexistent');
      expect(session).toBeUndefined();
    });

    it('should return session when token matches', async () => {
      const tokenHash = createHash('sha256').update('test-token', 'utf8').digest('hex');
      const storedSession = {
        session: { id: 'session-123', protocol: 'streamable-http' },
        authorizationId: tokenHash,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      mockRedisSessionStore.get.mockResolvedValue(storedSession);

      const session = await service.getStoredSession('streamable-http', 'test-token', 'session-123');
      expect(session).toBeDefined();
      expect(session?.session.id).toBe('session-123');
    });

    it('should return undefined when token hash does not match', async () => {
      const storedSession = {
        session: { id: 'session-123', protocol: 'streamable-http' },
        authorizationId: 'different-hash',
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };
      mockRedisSessionStore.get.mockResolvedValue(storedSession);

      const session = await service.getStoredSession('streamable-http', 'test-token', 'session-123');
      expect(session).toBeUndefined();
      expect(mockScope.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Session token mismatch'),
        expect.any(Object),
      );
    });

    it('should return undefined for non-streamable-http types', async () => {
      const session = await service.getStoredSession('sse', 'test-token', 'session-123');
      expect(session).toBeUndefined();
      expect(mockRedisSessionStore.get).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // recreateTransporter Tests
  // ============================================

  describe('recreateTransporter', () => {
    beforeEach(async () => {
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost' },
      });
      await service.ready;
    });

    it('should recreate transporter from stored session', async () => {
      const tokenHash = createHash('sha256').update('test-token', 'utf8').digest('hex');
      const storedSession = {
        session: {
          id: 'session-123',
          authorizationId: tokenHash,
          protocol: 'streamable-http',
          createdAt: Date.now(),
          nodeId: 'node-1',
        },
        authorizationId: tokenHash,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };

      const transport = await service.recreateTransporter(
        'streamable-http',
        'test-token',
        'session-123',
        storedSession as never,
        mockResponse as never,
      );
      expect(transport).toBeDefined();
    });

    it('should return existing transport if already recreated', async () => {
      const tokenHash = createHash('sha256').update('test-token', 'utf8').digest('hex');
      const storedSession = {
        session: {
          id: 'session-123',
          authorizationId: tokenHash,
          protocol: 'streamable-http',
          createdAt: Date.now(),
          nodeId: 'node-1',
        },
        authorizationId: tokenHash,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };

      const transport1 = await service.recreateTransporter(
        'streamable-http',
        'test-token',
        'session-123',
        storedSession as never,
        mockResponse as never,
      );
      const transport2 = await service.recreateTransporter(
        'streamable-http',
        'test-token',
        'session-123',
        storedSession as never,
        mockResponse as never,
      );
      expect(transport1).toBe(transport2);
    });

    it('should handle concurrent recreation with mutex', async () => {
      const tokenHash = createHash('sha256').update('test-token', 'utf8').digest('hex');
      const storedSession = {
        session: {
          id: 'session-mutex',
          authorizationId: tokenHash,
          protocol: 'streamable-http',
          createdAt: Date.now(),
          nodeId: 'node-1',
        },
        authorizationId: tokenHash,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };

      const [transport1, transport2] = await Promise.all([
        service.recreateTransporter(
          'streamable-http',
          'test-token',
          'session-mutex',
          storedSession as never,
          mockResponse as never,
        ),
        service.recreateTransporter(
          'streamable-http',
          'test-token',
          'session-mutex',
          storedSession as never,
          mockResponse as never,
        ),
      ]);

      expect(transport1).toBe(transport2);
    });
  });

  // ============================================
  // destroyTransporter Tests
  // ============================================

  describe('destroyTransporter', () => {
    beforeEach(async () => {
      service = new TransportService(mockScope as never);
      await service.ready;
    });

    it('should destroy existing transporter', async () => {
      await service.createTransporter('streamable-http', 'test-token', 'session-123', mockResponse as never);
      await expect(service.destroyTransporter('streamable-http', 'test-token', 'session-123')).resolves.not.toThrow();
    });

    it('should throw for non-existent transporter', async () => {
      await expect(service.destroyTransporter('streamable-http', 'test-token', 'nonexistent')).rejects.toThrow(
        'Invalid session',
      );
    });

    it('should remove transporter from cache after destroy', async () => {
      await service.createTransporter('streamable-http', 'test-token', 'session-destroy', mockResponse as never);
      await service.destroyTransporter('streamable-http', 'test-token', 'session-destroy');

      const transport = await service.getTransporter('streamable-http', 'test-token', 'session-destroy');
      expect(transport).toBeUndefined();
    });
  });

  // ============================================
  // wasSessionCreated Tests
  // ============================================

  describe('wasSessionCreated', () => {
    beforeEach(async () => {
      service = new TransportService(mockScope as never);
      await service.ready;
    });

    it('should return false for never-created session', () => {
      const result = service.wasSessionCreated('streamable-http', 'test-token', 'never-created');
      expect(result).toBe(false);
    });

    it('should return true for created session', async () => {
      await service.createTransporter('streamable-http', 'test-token', 'created-session', mockResponse as never);
      const result = service.wasSessionCreated('streamable-http', 'test-token', 'created-session');
      expect(result).toBe(true);
    });

    it('should return true for destroyed session', async () => {
      await service.createTransporter('streamable-http', 'test-token', 'to-destroy', mockResponse as never);
      await service.destroyTransporter('streamable-http', 'test-token', 'to-destroy');

      const result = service.wasSessionCreated('streamable-http', 'test-token', 'to-destroy');
      expect(result).toBe(true);
    });
  });

  // ============================================
  // wasSessionCreatedAsync Tests
  // ============================================

  describe('wasSessionCreatedAsync', () => {
    beforeEach(async () => {
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost' },
      });
      await service.ready;
    });

    it('should return true for locally created session', async () => {
      await service.createTransporter('streamable-http', 'test-token', 'local-session', mockResponse as never);
      const result = await service.wasSessionCreatedAsync('streamable-http', 'test-token', 'local-session');
      expect(result).toBe(true);
    });

    it('should check Redis when not in local history', async () => {
      // wasSessionCreatedAsync now uses getStoredSession() to verify token hash (security fix)
      const tokenHash = createHash('sha256').update('test-token', 'utf8').digest('hex');
      mockRedisSessionStore.get.mockResolvedValue({
        authorizationId: tokenHash,
        session: { id: 'redis-session', createdAt: Date.now() },
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      });
      const result = await service.wasSessionCreatedAsync('streamable-http', 'test-token', 'redis-session');
      expect(result).toBe(true);
      expect(mockRedisSessionStore.get).toHaveBeenCalledWith('redis-session');
    });

    it('should return false when not in local history or Redis', async () => {
      mockRedisSessionStore.get.mockResolvedValue(null);
      const result = await service.wasSessionCreatedAsync('streamable-http', 'test-token', 'nonexistent');
      expect(result).toBe(false);
    });

    it('should not check Redis for non-streamable-http types', async () => {
      mockRedisSessionStore.exists.mockResolvedValue(true);
      const result = await service.wasSessionCreatedAsync('sse', 'test-token', 'sse-session');
      expect(result).toBe(false);
      expect(mockRedisSessionStore.exists).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // Session History Tests
  // ============================================

  describe('Session History', () => {
    beforeEach(async () => {
      service = new TransportService(mockScope as never);
      await service.ready;
    });

    it('should handle sessionId with colons', async () => {
      await service.createTransporter('streamable-http', 'test-token', 'session:with:colons', mockResponse as never);
      const result = service.wasSessionCreated('streamable-http', 'test-token', 'session:with:colons');
      expect(result).toBe(true);
    });

    it('should handle sessionId with special characters', async () => {
      const specialId = 'session-with-"quotes"-and-{braces}';
      await service.createTransporter('streamable-http', 'test-token', specialId, mockResponse as never);
      const result = service.wasSessionCreated('streamable-http', 'test-token', specialId);
      expect(result).toBe(true);
    });

    it('should differentiate by type', async () => {
      await service.createTransporter('streamable-http', 'test-token', 'session-123', mockResponse as never);

      expect(service.wasSessionCreated('streamable-http', 'test-token', 'session-123')).toBe(true);
      expect(service.wasSessionCreated('sse', 'test-token', 'session-123')).toBe(false);
    });

    it('should differentiate by token', async () => {
      await service.createTransporter('streamable-http', 'token-1', 'session-123', mockResponse as never);

      expect(service.wasSessionCreated('streamable-http', 'token-1', 'session-123')).toBe(true);
      expect(service.wasSessionCreated('streamable-http', 'token-2', 'session-123')).toBe(false);
    });
  });

  // ============================================
  // Stateless Transport Tests
  // ============================================

  describe('Stateless Transports', () => {
    beforeEach(async () => {
      service = new TransportService(mockScope as never);
      await service.ready;
    });

    it('should create anonymous stateless transport', async () => {
      const transport = await service.getOrCreateAnonymousStatelessTransport('stateless-http', mockResponse as never);
      expect(transport).toBeDefined();
    });

    it('should return same transport for multiple anonymous calls', async () => {
      const transport1 = await service.getOrCreateAnonymousStatelessTransport('stateless-http', mockResponse as never);
      const transport2 = await service.getOrCreateAnonymousStatelessTransport('stateless-http', mockResponse as never);
      expect(transport1).toBe(transport2);
    });

    it('should create authenticated stateless transport', async () => {
      const transport = await service.getOrCreateAuthenticatedStatelessTransport(
        'stateless-http',
        'test-token',
        mockResponse as never,
      );
      expect(transport).toBeDefined();
    });

    it('should return same transport for same authenticated token', async () => {
      const transport1 = await service.getOrCreateAuthenticatedStatelessTransport(
        'stateless-http',
        'test-token',
        mockResponse as never,
      );
      const transport2 = await service.getOrCreateAuthenticatedStatelessTransport(
        'stateless-http',
        'test-token',
        mockResponse as never,
      );
      expect(transport1).toBe(transport2);
    });

    it('should create different transports for different tokens', async () => {
      const transport1 = await service.getOrCreateAuthenticatedStatelessTransport(
        'stateless-http',
        'token-1',
        mockResponse as never,
      );
      const transport2 = await service.getOrCreateAuthenticatedStatelessTransport(
        'stateless-http',
        'token-2',
        mockResponse as never,
      );
      expect(transport1).not.toBe(transport2);
    });
  });

  // ============================================
  // Cleanup Tests
  // ============================================

  describe('Cleanup', () => {
    it('should disconnect Redis on destroy', async () => {
      service = new TransportService(mockScope as never, {
        enabled: true,
        redis: { host: 'localhost' },
      });
      await service.ready;
      await service.destroy();
      expect(mockRedisSessionStore.disconnect).toHaveBeenCalled();
    });
  });
});
