import type { EnabledOption, EnabledSource } from '../../common/metadata/enabled.metadata';
import { LiveSurface, surfaceHash, type LiveSurfaceScope } from '../live-surface';

class TestSource implements EnabledSource {
  readonly listeners = new Set<() => void>();
  value = true;

  get(): boolean {
    return this.value;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  flip(): void {
    this.value = !this.value;
    for (const listener of [...this.listeners]) listener();
  }
}

class TestRegistry {
  entries: Array<{ metadata: { enabled?: EnabledOption } }> = [];
  readonly notifyListChanged = jest.fn(() => this.emit());
  private readonly listeners = new Set<() => void>();

  listAllInstances() {
    return this.entries;
  }

  subscribe(_options: { immediate?: boolean }, listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function testScope() {
  return {
    tools: new TestRegistry(),
    resources: new TestRegistry(),
    prompts: new TestRegistry(),
    notifications: { sendNotificationToSession: jest.fn() },
    logger: { warn: jest.fn() },
  };
}

function surfaceOf(scope: ReturnType<typeof testScope>, options?: { windowMs?: number; maxSessions?: number }) {
  return new LiveSurface(scope as unknown as LiveSurfaceScope, options);
}

describe('LiveSurface', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('list_changed', () => {
    it("announces a change of an entry's source as one list_changed of its kind per window", () => {
      const scope = testScope();
      const source = new TestSource();
      scope.tools.entries = [{ metadata: { enabled: source } }, { metadata: { enabled: true } }];
      const surface = surfaceOf(scope, { windowMs: 100 });
      surface.start();

      source.flip();
      source.flip();
      source.flip();
      expect(scope.tools.notifyListChanged).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(scope.tools.notifyListChanged).toHaveBeenCalledTimes(1);

      source.flip();
      jest.advanceTimersByTime(100);
      expect(scope.tools.notifyListChanged).toHaveBeenCalledTimes(2);
      expect(scope.resources.notifyListChanged).not.toHaveBeenCalled();
      surface.stop();
    });

    it('announces each kind on its own', () => {
      const scope = testScope();
      const shared = new TestSource();
      scope.resources.entries = [{ metadata: { enabled: shared } }];
      scope.prompts.entries = [{ metadata: { enabled: shared } }];
      const surface = surfaceOf(scope, { windowMs: 50 });
      surface.start();

      shared.flip();
      jest.advanceTimersByTime(50);

      expect(scope.resources.notifyListChanged).toHaveBeenCalledTimes(1);
      expect(scope.prompts.notifyListChanged).toHaveBeenCalledTimes(1);
      expect(scope.tools.notifyListChanged).not.toHaveBeenCalled();
      surface.stop();
    });

    it('subscribes once to a source several entries share', () => {
      const scope = testScope();
      const shared = new TestSource();
      scope.tools.entries = [{ metadata: { enabled: shared } }, { metadata: { enabled: shared } }];
      const surface = surfaceOf(scope);
      surface.start();

      expect(shared.listeners.size).toBe(1);
      surface.stop();
    });

    it('follows the sources of entries added and removed while it runs', () => {
      const scope = testScope();
      const first = new TestSource();
      const added = new TestSource();
      scope.tools.entries = [{ metadata: { enabled: first } }];
      const surface = surfaceOf(scope);
      surface.start();

      scope.tools.entries = [{ metadata: { enabled: added } }];
      scope.tools.emit();

      expect(first.listeners.size).toBe(0);
      expect(added.listeners.size).toBe(1);
      surface.stop();
    });

    it('announces a change listChanged() is told about, coalesced with the others', () => {
      const scope = testScope();
      const surface = surfaceOf(scope, { windowMs: 100 });
      surface.start();

      surface.listChanged('prompts');
      surface.listChanged('prompts');
      jest.advanceTimersByTime(100);

      expect(scope.prompts.notifyListChanged).toHaveBeenCalledTimes(1);
      surface.stop();
    });

    it('lets go of every source and sends nothing more once stopped', () => {
      const scope = testScope();
      const source = new TestSource();
      scope.tools.entries = [{ metadata: { enabled: source } }];
      const surface = surfaceOf(scope, { windowMs: 100 });
      surface.start();

      source.flip();
      surface.stop();
      jest.advanceTimersByTime(100);
      surface.listChanged('tools');
      jest.advanceTimersByTime(100);

      expect(source.listeners.size).toBe(0);
      expect(scope.tools.notifyListChanged).not.toHaveBeenCalled();
    });

    it('logs a source that cannot be subscribed to, and keeps going', () => {
      const scope = testScope();
      const broken: EnabledSource = {
        get: () => true,
        subscribe: () => {
          throw new Error('no events here');
        },
      };
      scope.tools.entries = [{ metadata: { enabled: broken } }];
      const surface = surfaceOf(scope);

      expect(() => surface.start()).not.toThrow();
      expect(scope.logger.warn).toHaveBeenCalledWith(expect.stringContaining('no events here'));
      surface.stop();
    });
  });

  describe('the surface hash and stale lists', () => {
    it('hashes the names a session was shown, in any order', () => {
      expect(surfaceHash(['b', 'a'])).toBe(surfaceHash(['a', 'b']));
      expect(surfaceHash(['a', 'b'])).not.toBe(surfaceHash(['a']));
      expect(surfaceHash([])).toMatch(/^[0-9a-f]{16}$/);
    });

    it('finds a session stale once the tool list changed after it last listed', () => {
      const scope = testScope();
      const surface = surfaceOf(scope);
      surface.start();

      expect(surface.recordToolList('session-1', ['a', 'b'])).toBe(surfaceHash(['a', 'b']));
      expect(surface.isStale('session-1')).toBe(false);

      scope.tools.emit();

      expect(surface.isStale('session-1')).toBe(true);
      surface.recordToolList('session-1', ['a']);
      expect(surface.isStale('session-1')).toBe(false);
      surface.stop();
    });

    it('never finds stale a session that has not listed, or a call without a session', () => {
      const scope = testScope();
      const surface = surfaceOf(scope);
      surface.start();
      surface.recordToolList(undefined, ['a']);
      scope.tools.emit();

      expect(surface.isStale('never-listed')).toBe(false);
      expect(surface.isStale(undefined)).toBe(false);
      surface.stop();
    });

    it('sends a stale session list_changed and answers it as current after that', () => {
      const scope = testScope();
      const surface = surfaceOf(scope);
      surface.start();
      surface.recordToolList('session-1', ['a']);
      scope.tools.emit();

      surface.refreshSession('session-1');

      expect(scope.notifications.sendNotificationToSession).toHaveBeenCalledWith(
        'session-1',
        'notifications/tools/list_changed',
      );
      expect(surface.isStale('session-1')).toBe(false);
      surface.stop();
    });

    it('remembers a bounded number of sessions, dropping the one that listed least recently', () => {
      const scope = testScope();
      const surface = surfaceOf(scope, { maxSessions: 2 });
      surface.start();
      surface.recordToolList('first', ['a']);
      surface.recordToolList('second', ['a']);
      surface.recordToolList('first', ['a']);
      surface.recordToolList('third', ['a']);
      scope.tools.emit();

      expect(surface.isStale('first')).toBe(true);
      expect(surface.isStale('second')).toBe(false);
      expect(surface.isStale('third')).toBe(true);
      surface.stop();
    });
  });
});
