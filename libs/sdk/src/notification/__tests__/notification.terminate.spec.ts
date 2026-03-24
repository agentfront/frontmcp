/**
 * @file notification.terminate.spec.ts
 * @description Tests for NotificationService session termination and cleanup.
 *
 * Verifies that terminateSession:
 * - Unregisters the server (cleans subscriptions, log levels)
 * - Calls providers.cleanupSession to prevent memory leaks
 * - Adds to terminated sessions set with LRU eviction
 * - Returns correct wasRegistered boolean
 */

import { NotificationService } from '../notification.service';

// Minimal mock for McpServer
const createMockServer = () =>
  ({
    notification: jest.fn(),
    request: jest.fn(),
  }) as never;

// Minimal mock scope for NotificationService constructor
function createMockScope() {
  return {
    logger: {
      verbose: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn().mockReturnValue({
        verbose: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    },
    providers: {
      cleanupSession: jest.fn(),
    },
    resources: { subscribe: jest.fn().mockReturnValue(() => {}) },
    tools: { subscribe: jest.fn().mockReturnValue(() => {}) },
    prompts: { subscribe: jest.fn().mockReturnValue(() => {}) },
  };
}

describe('NotificationService - terminateSession', () => {
  let service: NotificationService;
  let mockScope: ReturnType<typeof createMockScope>;

  beforeEach(() => {
    mockScope = createMockScope();
    service = new NotificationService(mockScope as never);
  });

  describe('cleanup side effects', () => {
    it('should call providers.cleanupSession with the session ID', () => {
      service.terminateSession('session-abc');

      expect(mockScope.providers.cleanupSession).toHaveBeenCalledWith('session-abc');
    });

    it('should call providers.cleanupSession even for unregistered sessions', () => {
      // Session was never registered via registerServer
      service.terminateSession('never-registered');

      expect(mockScope.providers.cleanupSession).toHaveBeenCalledWith('never-registered');
    });

    it('should unregister server when terminating registered session', () => {
      service.registerServer('session-xyz', createMockServer());

      const wasRegistered = service.terminateSession('session-xyz');

      expect(wasRegistered).toBe(true);
    });

    it('should return false for unregistered session', () => {
      const wasRegistered = service.terminateSession('not-registered');

      expect(wasRegistered).toBe(false);
    });
  });

  describe('terminated sessions set', () => {
    it('should mark session as terminated after terminateSession', () => {
      expect(service.isSessionTerminated('session-1')).toBe(false);

      service.terminateSession('session-1');

      expect(service.isSessionTerminated('session-1')).toBe(true);
    });

    it('should track multiple terminated sessions', () => {
      service.terminateSession('session-a');
      service.terminateSession('session-b');
      service.terminateSession('session-c');

      expect(service.isSessionTerminated('session-a')).toBe(true);
      expect(service.isSessionTerminated('session-b')).toBe(true);
      expect(service.isSessionTerminated('session-c')).toBe(true);
      expect(service.isSessionTerminated('session-d')).toBe(false);
    });

    it('should add unregistered sessions to terminated set', () => {
      // Even unregistered sessions should be tracked to prevent future use
      service.terminateSession('unknown-session');

      expect(service.isSessionTerminated('unknown-session')).toBe(true);
    });

    it('should be idempotent - terminating same session twice', () => {
      service.registerServer('session-dup', createMockServer());

      const first = service.terminateSession('session-dup');
      const second = service.terminateSession('session-dup');

      expect(first).toBe(true);
      expect(second).toBe(false); // Already unregistered
      expect(service.isSessionTerminated('session-dup')).toBe(true);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest terminated session when exceeding max', () => {
      service = new NotificationService(mockScope as never, { maxTerminatedSessions: 10 });

      const sessions = Array.from({ length: 11 }, (_, i) => `evict-session-${i}`);
      for (const s of sessions) {
        service.terminateSession(s);
      }

      expect(service.isSessionTerminated('evict-session-0')).toBe(false);
      expect(service.isSessionTerminated('evict-session-10')).toBe(true);
    });

    it('should call providers.cleanupSession for every terminated session', () => {
      service.terminateSession('s1');
      service.terminateSession('s2');
      service.terminateSession('s3');

      expect(mockScope.providers.cleanupSession).toHaveBeenCalledTimes(3);
      expect(mockScope.providers.cleanupSession).toHaveBeenCalledWith('s1');
      expect(mockScope.providers.cleanupSession).toHaveBeenCalledWith('s2');
      expect(mockScope.providers.cleanupSession).toHaveBeenCalledWith('s3');
    });
  });

  describe('subscription and log level cleanup', () => {
    it('should not leave orphaned subscriptions after termination', () => {
      service.registerServer('sub-session', createMockServer());
      service.terminateSession('sub-session');

      // Registering again should work without "already registered" warning
      service.registerServer('sub-session', createMockServer());

      // The warn mock should not have been called (no "already registered")
      const childLogger = mockScope.logger.child.mock.results[0]?.value;
      const warnCalls = childLogger?.warn?.mock?.calls ?? [];
      const alreadyRegisteredCalls = warnCalls.filter(
        (call: string[]) => typeof call[0] === 'string' && call[0].includes('already registered'),
      );
      expect(alreadyRegisteredCalls.length).toBe(0);
    });
  });
});
