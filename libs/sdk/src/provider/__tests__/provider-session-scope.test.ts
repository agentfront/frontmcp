/**
 * Unit tests for ProviderRegistry - Session Scope Management
 *
 * Tests cover:
 * - acquireSessionLock behavior
 * - releaseSessionLock with generation counter
 * - buildViews session handling
 * - Session isolation
 * - LRU eviction
 * - TTL cleanup
 * - Error rollback
 */

import 'reflect-metadata';
import ProviderRegistry from '../provider.registry';
import { ProviderScope } from '../../common/metadata';
import { SessionKey } from '../../context/session-key.provider';
import { createValueProvider, createClassProvider } from '../../__test-utils__/fixtures/provider.fixtures';

// Test fixtures
const TEST_TOKEN = Symbol('TEST_TOKEN');
const SESSION_TOKEN = Symbol('SESSION_TOKEN');

function Injectable() {
  return function (target: any) {};
}

@Injectable()
class GlobalService {
  readonly name = 'GlobalService';
}

@Injectable()
class SessionService {
  constructor(public readonly sessionKey: SessionKey) {}
  getSessionId(): string {
    return this.sessionKey.value;
  }
}

describe('ProviderRegistry - Session Scope', () => {
  // Helper to access private members for testing
  const getPrivate = (registry: ProviderRegistry, prop: string) => {
    return (registry as any)[prop];
  };

  describe('buildViews', () => {
    it('should validate sessionKey early', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      // Invalid session key should throw before any cache operations
      await expect(registry.buildViews('')).rejects.toThrow('SessionKey cannot be empty');
    });

    it('should reject sessionKey exceeding max length', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const tooLongKey = 'a'.repeat(257);
      await expect(registry.buildViews(tooLongKey)).rejects.toThrow(
        'SessionKey exceeds maximum length of 256 characters',
      );
    });

    it('should reject sessionKey with invalid characters', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      await expect(registry.buildViews('session@key')).rejects.toThrow('SessionKey contains invalid characters');
    });

    it('should create session store on first call', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');
      expect(sessionStores.size).toBe(0);

      await registry.buildViews('session-1');

      expect(sessionStores.size).toBe(1);
      expect(sessionStores.has('session-1')).toBe(true);
    });

    it('should inject SessionKey into session store', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const views = await registry.buildViews('my-session-123');

      expect(views.session.has(SessionKey)).toBe(true);
      const sessionKey = views.session.get(SessionKey) as SessionKey;
      expect(sessionKey).toBeInstanceOf(SessionKey);
      expect(sessionKey.value).toBe('my-session-123');
    });

    it('should cache SESSION providers on second call', async () => {
      const callCount = { count: 0 };

      @Injectable()
      class CountingSessionService {
        constructor() {
          callCount.count++;
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(CountingSessionService, {
          name: 'CountingSessionService',
          scope: ProviderScope.SESSION,
        }),
      ]);
      await registry.ready;

      // First call should build
      await registry.buildViews('session-1');
      expect(callCount.count).toBe(1);

      // Second call should use cache
      await registry.buildViews('session-1');
      expect(callCount.count).toBe(1); // Still 1, not 2
    });

    it('should not cache REQUEST providers', async () => {
      const callCount = { count: 0 };

      @Injectable()
      class CountingRequestService {
        constructor() {
          callCount.count++;
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(CountingRequestService, {
          name: 'CountingRequestService',
          scope: ProviderScope.REQUEST,
        }),
      ]);
      await registry.ready;

      // First call
      await registry.buildViews('session-1');
      expect(callCount.count).toBe(1);

      // Second call should rebuild REQUEST providers
      await registry.buildViews('session-1');
      expect(callCount.count).toBe(2);
    });

    it('should return global providers in views', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'global-value' })]);
      await registry.ready;

      const views = await registry.buildViews('session-1');

      expect(views.global.has(TEST_TOKEN)).toBe(true);
      expect(views.global.get(TEST_TOKEN)).toEqual({ name: 'global-value' });
    });
  });

  describe('session isolation', () => {
    it('should create separate stores per session', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      await registry.buildViews('session-1');
      await registry.buildViews('session-2');
      await registry.buildViews('session-3');

      const sessionStores = getPrivate(registry, 'sessionStores');
      expect(sessionStores.size).toBe(3);
      expect(sessionStores.has('session-1')).toBe(true);
      expect(sessionStores.has('session-2')).toBe(true);
      expect(sessionStores.has('session-3')).toBe(true);
    });

    it('should not share SESSION providers between sessions', async () => {
      @Injectable()
      class SessionStateService {
        state = { value: Math.random() };
      }

      const registry = new ProviderRegistry([
        createClassProvider(SessionStateService, {
          name: 'SessionStateService',
          scope: ProviderScope.SESSION,
        }),
      ]);
      await registry.ready;

      const views1 = await registry.buildViews('session-1');
      const views2 = await registry.buildViews('session-2');

      const service1 = views1.session.get(SessionStateService) as SessionStateService;
      const service2 = views2.session.get(SessionStateService) as SessionStateService;

      // Each session should have its own instance
      expect(service1).not.toBe(service2);
    });

    it('should share GLOBAL providers across sessions', async () => {
      const GlobalServiceAnnotated = createClassProvider(GlobalService, {
        name: 'GlobalService',
        scope: ProviderScope.GLOBAL,
      });

      const registry = new ProviderRegistry([GlobalServiceAnnotated]);
      await registry.ready;

      const views1 = await registry.buildViews('session-1');
      const views2 = await registry.buildViews('session-2');

      const global1 = views1.global.get(GlobalService);
      const global2 = views2.global.get(GlobalService);

      // Same global instance
      expect(global1).toBe(global2);
    });
  });

  describe('acquireSessionLock', () => {
    it('should acquire lock for new session', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      // Start buildViews which acquires lock
      const buildPromise = registry.buildViews('session-1');

      // Lock should exist while building
      const locks = getPrivate(registry, 'sessionBuildLocks');
      expect(locks.has('session-1')).toBe(true);

      await buildPromise;

      // Lock should be released after completion
      expect(locks.has('session-1')).toBe(false);
    });

    it('should wait for existing lock', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const executionOrder: string[] = [];

      // Manually simulate slow build by adding a session provider that takes time
      @Injectable()
      class SlowSessionService {
        constructor() {
          executionOrder.push('slow-start');
        }
        async init() {
          await new Promise((resolve) => setTimeout(resolve, 50));
          executionOrder.push('slow-end');
        }
      }

      const slowRegistry = new ProviderRegistry([
        createClassProvider(SlowSessionService, {
          name: 'SlowSessionService',
          scope: ProviderScope.SESSION,
        }),
      ]);
      await slowRegistry.ready;

      // Start two concurrent builds for same session
      const promise1 = slowRegistry.buildViews('session-1').then(() => executionOrder.push('build-1-done'));
      const promise2 = slowRegistry.buildViews('session-1').then(() => executionOrder.push('build-2-done'));

      await Promise.all([promise1, promise2]);

      // Second build should wait for first (serialized, not parallel)
      // The slow-start should only appear once since second build uses cached providers
      expect(executionOrder.filter((e) => e === 'slow-start').length).toBe(1);
    });

    it('should return generation number', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      // Access private acquireSessionLock method
      const acquireSessionLock = getPrivate(registry, 'acquireSessionLock').bind(registry);
      const releaseSessionLock = getPrivate(registry, 'releaseSessionLock').bind(registry);

      const gen1 = await acquireSessionLock('session-1');
      expect(typeof gen1).toBe('number');
      expect(gen1).toBeGreaterThan(0);
      releaseSessionLock('session-1', gen1);

      const gen2 = await acquireSessionLock('session-2');
      expect(gen2).toBe(gen1 + 1);
      releaseSessionLock('session-2', gen2);
    });
  });

  describe('releaseSessionLock', () => {
    it('should release lock and resolve promise', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const acquireSessionLock = getPrivate(registry, 'acquireSessionLock').bind(registry);
      const releaseSessionLock = getPrivate(registry, 'releaseSessionLock').bind(registry);
      const locks = getPrivate(registry, 'sessionBuildLocks');

      const gen = await acquireSessionLock('session-1');
      expect(locks.has('session-1')).toBe(true);

      releaseSessionLock('session-1', gen);
      expect(locks.has('session-1')).toBe(false);
    });

    it('should ignore release if generation mismatch', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const acquireSessionLock = getPrivate(registry, 'acquireSessionLock').bind(registry);
      const releaseSessionLock = getPrivate(registry, 'releaseSessionLock').bind(registry);
      const locks = getPrivate(registry, 'sessionBuildLocks');

      const gen = await acquireSessionLock('session-1');
      expect(locks.has('session-1')).toBe(true);

      // Try to release with wrong generation
      releaseSessionLock('session-1', gen + 100);

      // Lock should still exist (not released)
      expect(locks.has('session-1')).toBe(true);

      // Cleanup
      releaseSessionLock('session-1', gen);
    });

    it('should handle non-existent lock gracefully', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const releaseSessionLock = getPrivate(registry, 'releaseSessionLock').bind(registry);

      // Should not throw
      expect(() => releaseSessionLock('non-existent-session', 1)).not.toThrow();
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest session when at capacity', async () => {
      // Create registry and access private constant
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');

      // Manually set a small cache size for testing by populating with fake entries
      // We'll test the eviction logic by filling it up
      const MAX_SIZE = 10000; // Same as ProviderRegistry.MAX_SESSION_CACHE_SIZE

      // Create MAX_SIZE sessions
      for (let i = 0; i < MAX_SIZE; i++) {
        sessionStores.set(`old-session-${i}`, {
          providers: new Map(),
          lastAccess: Date.now() - (MAX_SIZE - i) * 1000, // Older sessions have older timestamps
        });
      }

      expect(sessionStores.size).toBe(MAX_SIZE);

      // Add one more via buildViews - should trigger eviction
      await registry.buildViews('new-session');

      // Size should still be at max (old one evicted, new one added)
      expect(sessionStores.size).toBe(MAX_SIZE);
      expect(sessionStores.has('new-session')).toBe(true);
      // The oldest session should have been evicted
      expect(sessionStores.has('old-session-0')).toBe(false);
    });

    it('should update lastAccess on access', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');

      // First access
      await registry.buildViews('session-1');
      const firstAccess = sessionStores.get('session-1').lastAccess;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Second access
      await registry.buildViews('session-1');
      const secondAccess = sessionStores.get('session-1').lastAccess;

      expect(secondAccess).toBeGreaterThan(firstAccess);
    });

    it('should skip locked sessions during eviction', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');
      const locks = getPrivate(registry, 'sessionBuildLocks');

      // Add a fake lock for the oldest session - this simulates an in-progress build
      locks.set('old-session-0', {
        promise: Promise.resolve(),
        resolve: () => {},
        generation: 1,
      });

      // Fill up cache
      const MAX_SIZE = 10000;
      for (let i = 0; i < MAX_SIZE; i++) {
        sessionStores.set(`old-session-${i}`, {
          providers: new Map(),
          lastAccess: Date.now() - (MAX_SIZE - i) * 1000, // session-0 is oldest
        });
      }

      // Trigger eviction
      await registry.buildViews('new-session');

      // Locked session should NOT be evicted (it's still being built)
      expect(sessionStores.has('old-session-0')).toBe(true);
      expect(locks.has('old-session-0')).toBe(true);
      // Instead, the next oldest unlocked session should be evicted
      expect(sessionStores.has('old-session-1')).toBe(false);
    });
  });

  describe('TTL cleanup', () => {
    it('should remove expired sessions', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');
      const TTL_MS = 3600000; // 1 hour

      // Add an expired session
      sessionStores.set('expired-session', {
        providers: new Map(),
        lastAccess: Date.now() - TTL_MS - 1000, // Older than TTL
      });

      // Add a fresh session
      sessionStores.set('fresh-session', {
        providers: new Map(),
        lastAccess: Date.now(),
      });

      expect(sessionStores.size).toBe(2);

      const cleaned = registry.cleanupExpiredSessions();

      expect(cleaned).toBe(1);
      expect(sessionStores.size).toBe(1);
      expect(sessionStores.has('expired-session')).toBe(false);
      expect(sessionStores.has('fresh-session')).toBe(true);
    });

    it('should keep non-expired sessions', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');

      // Add multiple fresh sessions
      sessionStores.set('session-1', { providers: new Map(), lastAccess: Date.now() });
      sessionStores.set('session-2', { providers: new Map(), lastAccess: Date.now() });
      sessionStores.set('session-3', { providers: new Map(), lastAccess: Date.now() });

      const cleaned = registry.cleanupExpiredSessions();

      expect(cleaned).toBe(0);
      expect(sessionStores.size).toBe(3);
    });

    it('should cleanup locks on expiration', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');
      const locks = getPrivate(registry, 'sessionBuildLocks');
      const TTL_MS = 3600000;

      // Add an expired session with orphaned lock
      sessionStores.set('expired-session', {
        providers: new Map(),
        lastAccess: Date.now() - TTL_MS - 1000,
      });
      locks.set('expired-session', {
        promise: Promise.resolve(),
        resolve: () => {},
        generation: 1,
      });

      registry.cleanupExpiredSessions();

      expect(locks.has('expired-session')).toBe(false);
    });

    it('should return cleanup count', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');
      const TTL_MS = 3600000;

      // Add 3 expired sessions
      for (let i = 0; i < 3; i++) {
        sessionStores.set(`expired-${i}`, {
          providers: new Map(),
          lastAccess: Date.now() - TTL_MS - 1000,
        });
      }

      const cleaned = registry.cleanupExpiredSessions();
      expect(cleaned).toBe(3);
    });
  });

  describe('error rollback', () => {
    it('should cleanup partial state on error', async () => {
      @Injectable()
      class FailingSessionService {
        constructor() {
          throw new Error('Construction failed!');
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(FailingSessionService, {
          name: 'FailingSessionService',
          scope: ProviderScope.SESSION,
        }),
      ]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');

      await expect(registry.buildViews('session-1')).rejects.toThrow('Construction failed');

      // Session store should be cleaned up on error
      expect(sessionStores.has('session-1')).toBe(false);
    });

    it('should release lock after cleanup on error', async () => {
      @Injectable()
      class FailingSessionService {
        constructor() {
          throw new Error('Construction failed!');
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(FailingSessionService, {
          name: 'FailingSessionService',
          scope: ProviderScope.SESSION,
        }),
      ]);
      await registry.ready;

      const locks = getPrivate(registry, 'sessionBuildLocks');

      await expect(registry.buildViews('session-1')).rejects.toThrow();

      // Lock should be released even on error
      expect(locks.has('session-1')).toBe(false);
    });

    it('should re-throw original error', async () => {
      const originalError = 'Specific error message for testing';

      @Injectable()
      class FailingSessionService {
        constructor() {
          throw new Error(originalError);
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(FailingSessionService, {
          name: 'FailingSessionService',
          scope: ProviderScope.SESSION,
        }),
      ]);
      await registry.ready;

      await expect(registry.buildViews('session-1')).rejects.toThrow(originalError);
    });
  });

  describe('cleanupSession', () => {
    it('should remove specific session', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      await registry.buildViews('session-1');
      await registry.buildViews('session-2');

      const sessionStores = getPrivate(registry, 'sessionStores');
      expect(sessionStores.size).toBe(2);

      registry.cleanupSession('session-1');

      expect(sessionStores.size).toBe(1);
      expect(sessionStores.has('session-1')).toBe(false);
      expect(sessionStores.has('session-2')).toBe(true);
    });

    it('should cleanup associated lock', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const locks = getPrivate(registry, 'sessionBuildLocks');

      // Manually add a lock
      locks.set('session-1', {
        promise: Promise.resolve(),
        resolve: () => {},
        generation: 1,
      });

      registry.cleanupSession('session-1');

      expect(locks.has('session-1')).toBe(false);
    });
  });

  describe('getSessionCacheStats', () => {
    it('should return cache statistics', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      await registry.buildViews('session-1');
      await registry.buildViews('session-2');

      const stats = registry.getSessionCacheStats();

      expect(stats.size).toBe(2);
      expect(stats.maxSize).toBe(10000);
      expect(stats.ttlMs).toBe(3600000);
    });
  });

  describe('getScoped', () => {
    it('should return provider from request store first', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'global' })]);
      await registry.ready;

      const views = await registry.buildViews('session-1');

      // Manually add to request store
      const REQUEST_VALUE = { name: 'request-specific' };
      views.request.set(TEST_TOKEN, REQUEST_VALUE);

      const result = registry.getScoped(TEST_TOKEN, views);
      expect(result).toBe(REQUEST_VALUE);
    });

    it('should fallback to session store', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'global' })]);
      await registry.ready;

      const views = await registry.buildViews('session-1');

      // Add to session store only
      const SESSION_VALUE = { name: 'session-specific' };
      views.session.set(TEST_TOKEN, SESSION_VALUE);

      const result = registry.getScoped(TEST_TOKEN, views);
      expect(result).toBe(SESSION_VALUE);
    });

    it('should fallback to global store', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'global' })]);
      await registry.ready;

      const views = await registry.buildViews('session-1');

      const result = registry.getScoped(TEST_TOKEN, views);
      expect(result).toEqual({ name: 'global' });
    });

    it('should throw if provider not found', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'global' })]);
      await registry.ready;

      const views = await registry.buildViews('session-1');
      const UNKNOWN_TOKEN = Symbol('UNKNOWN');

      expect(() => registry.getScoped(UNKNOWN_TOKEN, views)).toThrow('not found in views');
    });
  });

  // ============================================================================
  // ROUND 4 TESTS - CRITICAL & HIGH PRIORITY
  // ============================================================================

  describe('CRITICAL: Generation Counter', () => {
    it('should reset generation counter near MAX_SAFE_INTEGER', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      // Set generation near max
      (registry as any).lockGeneration = Number.MAX_SAFE_INTEGER - 1;

      // Build should reset counter
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      await registry.buildViews('session-1');

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('generation counter reset'));
      expect(getPrivate(registry, 'lockGeneration')).toBeLessThan(Number.MAX_SAFE_INTEGER);
      consoleSpy.mockRestore();
    });
  });

  describe('CRITICAL: Cross-Scope Dependencies', () => {
    it('should allow REQUEST provider to depend on SESSION provider', async () => {
      @Injectable()
      class SessionDataService {
        getValue() {
          return 'session-value';
        }
      }

      @Injectable()
      class RequestDataService {
        constructor(public session: SessionDataService) {}
      }

      const registry = new ProviderRegistry([
        createClassProvider(SessionDataService, {
          name: 'SessionDataService',
          scope: ProviderScope.SESSION,
        }),
        createClassProvider(RequestDataService, {
          name: 'RequestDataService',
          scope: ProviderScope.REQUEST,
        }),
      ]);
      await registry.ready;

      const views = await registry.buildViews('session-1');
      const requestService = views.request.get(RequestDataService) as RequestDataService;

      expect(requestService).toBeDefined();
      expect(requestService.session.getValue()).toBe('session-value');
    });
  });

  describe('CRITICAL: REQUEST Provider Failure', () => {
    it('should not corrupt session store when REQUEST provider fails', async () => {
      @Injectable()
      class GoodSessionService {
        constructor() {}
      }

      @Injectable()
      class FailingRequestService {
        constructor() {
          throw new Error('REQUEST construction failed');
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(GoodSessionService, {
          name: 'GoodSessionService',
          scope: ProviderScope.SESSION,
        }),
        createClassProvider(FailingRequestService, {
          name: 'FailingRequestService',
          scope: ProviderScope.REQUEST,
        }),
      ]);
      await registry.ready;

      // First call should fail but session store should be intact
      await expect(registry.buildViews('session-1')).rejects.toThrow('REQUEST construction failed');

      // Session store should still exist (SESSION providers were built before REQUEST failed)
      const sessionStores = getPrivate(registry, 'sessionStores');
      expect(sessionStores.has('session-1')).toBe(true);
    });
  });

  describe('HIGH: Lock Cleanup Races', () => {
    it('should skip locked sessions during LRU eviction', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const sessionStores = getPrivate(registry, 'sessionStores');
      const locks = getPrivate(registry, 'sessionBuildLocks');
      const MAX_SIZE = 10000;

      // Fill cache, making session-0 the oldest
      for (let i = 0; i < MAX_SIZE; i++) {
        sessionStores.set(`session-${i}`, {
          providers: new Map(),
          lastAccess: Date.now() - (MAX_SIZE - i) * 1000,
        });
      }

      // Simulate active lock on oldest session
      locks.set('session-0', { promise: Promise.resolve(), resolve: () => {}, generation: 1 });

      // Trigger eviction - should skip session-0 and evict session-1
      await registry.buildViews('new-session');

      expect(sessionStores.has('session-0')).toBe(true); // Protected by lock
      expect(sessionStores.has('session-1')).toBe(false); // Evicted instead
    });

    it('should resolve waiters when cleanupSession deletes lock', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const locks = getPrivate(registry, 'sessionBuildLocks');
      let resolved = false;

      // Simulate lock with waiter - set up properly with correct resolve reference
      const lockEntry = {
        promise: null as unknown as Promise<void>,
        resolve: () => {
          resolved = true;
        },
        generation: 1,
      };
      lockEntry.promise = new Promise<void>((r) => {
        lockEntry.resolve = () => {
          resolved = true;
          r();
        };
      });
      locks.set('session-1', lockEntry);

      registry.cleanupSession('session-1');

      expect(resolved).toBe(true);
      expect(locks.has('session-1')).toBe(false);
    });

    it('should not corrupt cache when error occurs during build', async () => {
      @Injectable()
      class FailingBuildService {
        constructor() {
          throw new Error('Build failed');
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(FailingBuildService, {
          name: 'FailingBuildService',
          scope: ProviderScope.SESSION,
        }),
      ]);
      await registry.ready;

      const locks = getPrivate(registry, 'sessionBuildLocks');

      await expect(registry.buildViews('session-1')).rejects.toThrow('Build failed');

      // Lock should be released (not left dangling)
      expect(locks.has('session-1')).toBe(false);
    });
  });

  describe('HIGH: Concurrent Sessions', () => {
    it('should build different sessions in parallel without contention', async () => {
      let buildCount = 0;

      @Injectable()
      class TrackingService {
        public readonly buildId: number;
        constructor() {
          this.buildId = ++buildCount;
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(TrackingService, {
          name: 'TrackingService',
          scope: ProviderScope.SESSION,
        }),
      ]);
      await registry.ready;

      // Build 3 different sessions concurrently
      const [views1, views2, views3] = await Promise.all([
        registry.buildViews('session-1'),
        registry.buildViews('session-2'),
        registry.buildViews('session-3'),
      ]);

      // All 3 should have built unique instances
      expect(buildCount).toBe(3);

      // Each session should have its own instance
      const service1 = views1.session.get(TrackingService) as TrackingService;
      const service2 = views2.session.get(TrackingService) as TrackingService;
      const service3 = views3.session.get(TrackingService) as TrackingService;

      // Verify unique build IDs (different instances)
      const buildIds = [service1.buildId, service2.buildId, service3.buildId];
      expect(new Set(buildIds).size).toBe(3); // All unique
    });
  });

  describe('HIGH: Evicted Session Re-access', () => {
    it('should rebuild session providers after eviction and re-access', async () => {
      let buildCount = 0;

      @Injectable()
      class CountingService {
        constructor() {
          buildCount++;
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(CountingService, {
          name: 'CountingService',
          scope: ProviderScope.SESSION,
        }),
      ]);
      await registry.ready;

      // First build
      await registry.buildViews('session-1');
      expect(buildCount).toBe(1);

      // Simulate eviction
      registry.cleanupSession('session-1');

      // Re-access should rebuild
      await registry.buildViews('session-1');
      expect(buildCount).toBe(2);
    });
  });
});
