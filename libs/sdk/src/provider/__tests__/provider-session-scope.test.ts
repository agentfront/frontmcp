/**
 * Unit tests for ProviderRegistry - Context/Session Scope Management
 *
 * Note: With the unified FrontMcpContext model, SESSION and REQUEST scopes
 * are normalized to CONTEXT scope, and providers are built fresh per-request
 * (no caching between requests).
 *
 * Tests cover:
 * - CONTEXT scope normalization (SESSION/REQUEST → CONTEXT)
 * - Context isolation between requests
 * - Error handling during context builds
 * - getScoped behavior with unified views
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

describe('ProviderRegistry - Context Scope', () => {
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

    it('should inject SessionKey into context store', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const views = await registry.buildViews('my-session-123');

      // SessionKey should be in the unified context store
      expect(views.context.has(SessionKey)).toBe(true);
      const sessionKey = views.context.get(SessionKey) as SessionKey;
      expect(sessionKey).toBeInstanceOf(SessionKey);
      expect(sessionKey.value).toBe('my-session-123');
    });

    it('should provide session alias pointing to context store', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const views = await registry.buildViews('my-session-123');

      // session should be same as context (alias)
      expect(views.session).toBe(views.context);
    });

    it('should provide request alias pointing to context store', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const views = await registry.buildViews('my-session-123');

      // request should be same as context (alias)
      expect(views.request).toBe(views.context);
    });

    it('should build CONTEXT-scoped providers fresh per-request (no caching)', async () => {
      const callCount = { count: 0 };

      @Injectable()
      class CountingContextService {
        constructor() {
          callCount.count++;
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(CountingContextService, {
          name: 'CountingContextService',
          scope: ProviderScope.CONTEXT,
        }),
      ]);
      await registry.ready;

      // First call should build
      await registry.buildViews('session-1');
      expect(callCount.count).toBe(1);

      // Second call for same session should also build (no caching)
      await registry.buildViews('session-1');
      expect(callCount.count).toBe(2);
    });

    it('should normalize SESSION scope to CONTEXT (deprecated scope)', async () => {
      const callCount = { count: 0 };

      @Injectable()
      class OldSessionService {
        constructor() {
          callCount.count++;
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(OldSessionService, {
          name: 'OldSessionService',
          scope: ProviderScope.SESSION, // Deprecated, normalized to CONTEXT
        }),
      ]);
      await registry.ready;

      // Should build provider (normalized to CONTEXT)
      const views = await registry.buildViews('session-1');
      expect(callCount.count).toBe(1);
      expect(views.context.has(OldSessionService)).toBe(true);
    });

    it('should normalize REQUEST scope to CONTEXT (deprecated scope)', async () => {
      const callCount = { count: 0 };

      @Injectable()
      class OldRequestService {
        constructor() {
          callCount.count++;
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(OldRequestService, {
          name: 'OldRequestService',
          scope: ProviderScope.REQUEST, // Deprecated, normalized to CONTEXT
        }),
      ]);
      await registry.ready;

      // Should build provider (normalized to CONTEXT)
      const views = await registry.buildViews('session-1');
      expect(callCount.count).toBe(1);
      expect(views.context.has(OldRequestService)).toBe(true);
    });

    it('should return global providers in views', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'global-value' })]);
      await registry.ready;

      const views = await registry.buildViews('session-1');

      expect(views.global.has(TEST_TOKEN)).toBe(true);
      expect(views.global.get(TEST_TOKEN)).toEqual({ name: 'global-value' });
    });
  });

  describe('context isolation', () => {
    it('should create separate context stores per buildViews call', async () => {
      @Injectable()
      class ContextStateService {
        state = { value: Math.random() };
      }

      const registry = new ProviderRegistry([
        createClassProvider(ContextStateService, {
          name: 'ContextStateService',
          scope: ProviderScope.CONTEXT,
        }),
      ]);
      await registry.ready;

      const views1 = await registry.buildViews('session-1');
      const views2 = await registry.buildViews('session-1'); // Same session, but fresh context

      const service1 = views1.context.get(ContextStateService) as ContextStateService;
      const service2 = views2.context.get(ContextStateService) as ContextStateService;

      // Each call should have its own instance (fresh per request)
      expect(service1).not.toBe(service2);
    });

    it('should share GLOBAL providers across all contexts', async () => {
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

  describe('error handling', () => {
    it('should throw error when CONTEXT provider fails', async () => {
      @Injectable()
      class FailingContextService {
        constructor() {
          throw new Error('Construction failed!');
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(FailingContextService, {
          name: 'FailingContextService',
          scope: ProviderScope.CONTEXT,
        }),
      ]);
      await registry.ready;

      await expect(registry.buildViews('session-1')).rejects.toThrow('Construction failed');
    });

    it('should re-throw original error message', async () => {
      const originalError = 'Specific error message for testing';

      @Injectable()
      class FailingContextService {
        constructor() {
          throw new Error(originalError);
        }
      }

      const registry = new ProviderRegistry([
        createClassProvider(FailingContextService, {
          name: 'FailingContextService',
          scope: ProviderScope.CONTEXT,
        }),
      ]);
      await registry.ready;

      await expect(registry.buildViews('session-1')).rejects.toThrow(originalError);
    });
  });

  describe('getScoped', () => {
    it('should return provider from context store', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'global' })]);
      await registry.ready;

      const views = await registry.buildViews('session-1');

      // Manually add to context store
      const CONTEXT_VALUE = { name: 'context-specific' };
      views.context.set(TEST_TOKEN, CONTEXT_VALUE);

      const result = registry.getScoped(TEST_TOKEN, views);
      expect(result).toBe(CONTEXT_VALUE);
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

  describe('cross-scope dependencies', () => {
    it('should allow CONTEXT provider to depend on another CONTEXT provider', async () => {
      @Injectable()
      class DataService {
        getValue() {
          return 'data-value';
        }
      }

      @Injectable()
      class ConsumerService {
        constructor(public data: DataService) {}
      }

      const registry = new ProviderRegistry([
        createClassProvider(DataService, {
          name: 'DataService',
          scope: ProviderScope.CONTEXT,
        }),
        createClassProvider(ConsumerService, {
          name: 'ConsumerService',
          scope: ProviderScope.CONTEXT,
        }),
      ]);
      await registry.ready;

      const views = await registry.buildViews('session-1');
      const consumer = views.context.get(ConsumerService) as ConsumerService;

      expect(consumer).toBeDefined();
      expect(consumer.data.getValue()).toBe('data-value');
    });

    it('should allow legacy SESSION provider to depend on legacy REQUEST provider (both normalized to CONTEXT)', async () => {
      @Injectable()
      class OldRequestService {
        getValue() {
          return 'request-value';
        }
      }

      @Injectable()
      class OldSessionService {
        constructor(public request: OldRequestService) {}
      }

      const registry = new ProviderRegistry([
        createClassProvider(OldRequestService, {
          name: 'OldRequestService',
          scope: ProviderScope.REQUEST, // Normalized to CONTEXT
        }),
        createClassProvider(OldSessionService, {
          name: 'OldSessionService',
          scope: ProviderScope.SESSION, // Normalized to CONTEXT
        }),
      ]);
      await registry.ready;

      const views = await registry.buildViews('session-1');
      const sessionService = views.context.get(OldSessionService) as OldSessionService;

      expect(sessionService).toBeDefined();
      expect(sessionService.request.getValue()).toBe('request-value');
    });
  });

  describe('concurrent contexts', () => {
    it('should build different contexts in parallel without contention', async () => {
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
          scope: ProviderScope.CONTEXT,
        }),
      ]);
      await registry.ready;

      // Build 3 different contexts concurrently
      const [views1, views2, views3] = await Promise.all([
        registry.buildViews('session-1'),
        registry.buildViews('session-2'),
        registry.buildViews('session-3'),
      ]);

      // All 3 should have built unique instances
      expect(buildCount).toBe(3);

      // Each context should have its own instance
      const service1 = views1.context.get(TrackingService) as TrackingService;
      const service2 = views2.context.get(TrackingService) as TrackingService;
      const service3 = views3.context.get(TrackingService) as TrackingService;

      // Verify unique build IDs (different instances)
      const buildIds = [service1.buildId, service2.buildId, service3.buildId];
      expect(new Set(buildIds).size).toBe(3); // All unique
    });
  });

  describe('session cache management (backwards compatibility)', () => {
    // These methods exist for backwards compatibility but are not used
    // by the unified context model

    it('cleanupSession should not throw', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      // Should not throw even if session doesn't exist
      expect(() => registry.cleanupSession('non-existent')).not.toThrow();
    });

    it('cleanupExpiredSessions should return 0 when no sessions cached', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      const cleaned = registry.cleanupExpiredSessions();
      expect(cleaned).toBe(0);
    });

    it('getSessionCacheStats should return zero size', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      await registry.buildViews('session-1');
      await registry.buildViews('session-2');

      const stats = registry.getSessionCacheStats();

      // No sessions are cached with unified context model
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(10000);
      expect(stats.ttlMs).toBe(3600000);
    });
  });

  describe('dispose', () => {
    it('should cleanup all resources', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      // Should not throw
      expect(() => registry.dispose()).not.toThrow();
    });

    it('should be idempotent', async () => {
      const registry = new ProviderRegistry([createValueProvider(TEST_TOKEN, { name: 'test' })]);
      await registry.ready;

      // Multiple dispose calls should be safe
      registry.dispose();
      registry.dispose();
      registry.dispose();
    });
  });
});
