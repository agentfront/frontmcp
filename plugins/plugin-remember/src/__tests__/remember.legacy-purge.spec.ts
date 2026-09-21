import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import type { RememberStoreInterface } from '../providers/remember-store.interface';
import {
  purgeLegacyRememberEntries,
  readLayoutFirstSeenAt,
  resetLegacyPurgeStateForTests,
  scheduleLegacyRememberPurge,
} from '../remember.legacy-purge';
import type { RememberPluginOptions } from '../remember.types';

class FakeStore implements RememberStoreInterface {
  readonly data = new Map<string, string>();

  async setValue(key: string, value: unknown): Promise<void> {
    this.data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  async setIfAbsent(key: string, value: unknown): Promise<boolean> {
    if (this.data.has(key)) return false;
    await this.setValue(key, value);
    return true;
  }

  async getValue<T = unknown>(key: string): Promise<T | undefined> {
    return this.data.get(key) as unknown as T | undefined;
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async keys(pattern?: string): Promise<string[]> {
    const all = [...this.data.keys()];
    if (!pattern) return all;
    const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    return all.filter((key) => regex.test(key));
  }

  async close(): Promise<void> {
    this.data.clear();
  }
}

function createContext(): FrontMcpContext {
  return {
    sessionId: 'session-abc',
    authInfo: { clientId: 'client-1', extra: { userId: 'user-1' } },
    flow: { name: 'my_tool' },
  } as unknown as FrontMcpContext;
}

const config: RememberPluginOptions = {
  type: 'memory',
  keyPrefix: 'remember:',
  encryption: { enabled: false },
};

const DEFAULT_DELAY_MS = 86_400_000;
const MARKER_KEY = 'remember:__layout__';

/** Pretend an earlier instance stamped the layout marker `ageMs` ago. */
function seedLayoutMarker(store: FakeStore, ageMs: number): void {
  store.data.set(MARKER_KEY, JSON.stringify({ version: 2, firstSeenAt: Date.now() - ageMs }));
}

function seedLegacyEntries(store: FakeStore): void {
  store.data.set('remember:session:session-abc:theme', 'legacy');
  store.data.set('remember:tool:my_tool:session-abc:draft', 'legacy');
  store.data.set('remember:user:user:1:profile', 'legacy');
  store.data.set('remember:global:banner', 'still-readable');
}

describe('legacy remember purge', () => {
  let store: FakeStore;

  beforeEach(() => {
    store = new FakeStore();
    resetLegacyPurgeStateForTests(store);
  });

  it('deletes session, tool and user entries written before the layout change', async () => {
    seedLegacyEntries(store);

    const deleted = await purgeLegacyRememberEntries(store, 'remember:');

    expect(deleted).toBe(3);
    expect([...store.data.keys()]).toEqual(['remember:global:banner']);
  });

  it('warns with the number of entries it removed', async () => {
    seedLegacyEntries(store);
    const logger = { warn: jest.fn(), debug: jest.fn() };

    await purgeLegacyRememberEntries(store, 'remember:', logger);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain('purged 3 entries');
  });

  it('stays silent when there is nothing to purge', async () => {
    const logger = { warn: jest.fn(), debug: jest.fn() };

    await purgeLegacyRememberEntries(store, 'remember:', logger);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('degrades to a debug log when the store cannot enumerate keys', async () => {
    const logger = { warn: jest.fn(), debug: jest.fn() };
    jest.spyOn(store, 'keys').mockRejectedValue(new Error('SCAN unsupported'));

    const deleted = await purgeLegacyRememberEntries(store, 'remember:', logger);

    expect(deleted).toBe(0);
    expect(logger.debug).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps sweeping when one key cannot be deleted', async () => {
    seedLegacyEntries(store);
    jest
      .spyOn(store, 'delete')
      .mockImplementationOnce(() => Promise.reject(new Error('READONLY')))
      .mockImplementation(async (key: string) => {
        store.data.delete(key);
      });

    const deleted = await purgeLegacyRememberEntries(store, 'remember:');

    expect(deleted).toBe(2);
  });

  describe('the layout marker', () => {
    it('stamps the marker when none exists', async () => {
      const firstSeenAt = await readLayoutFirstSeenAt(store, 'remember:');

      expect(firstSeenAt).toBeCloseTo(Date.now(), -2);
      expect(JSON.parse(store.data.get(MARKER_KEY) as string)).toEqual({
        version: 2,
        firstSeenAt,
      });
    });

    it('instances booting together settle on one clock', async () => {
      // Both observe no marker. Each would stamp its own `Date.now()`, so the clock is pinned to
      // distinct values -- without a conditional write the second overwrites the first and moves
      // the fleet's clock forward.
      const base = Date.now();
      jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(base)
        .mockReturnValue(base + 60_000);

      const [first, second] = await Promise.all([
        readLayoutFirstSeenAt(store, 'remember:'),
        readLayoutFirstSeenAt(store, 'remember:'),
      ]);

      expect(first).toBe(base);
      expect(second).toBe(base);
      expect(JSON.parse(store.data.get(MARKER_KEY) as string).firstSeenAt).toBe(base);
    });

    it('the loser of a race adopts the winner timestamp, not its own', async () => {
      const winnerFirstSeenAt = Date.now() - 12_345;
      jest.spyOn(store, 'setIfAbsent').mockImplementation(async () => {
        store.data.set(MARKER_KEY, JSON.stringify({ version: 2, firstSeenAt: winnerFirstSeenAt }));
        return false;
      });

      await expect(readLayoutFirstSeenAt(store, 'remember:')).resolves.toBe(winnerFirstSeenAt);
    });

    it('stands down when a lost race leaves no readable marker', async () => {
      jest.spyOn(store, 'setIfAbsent').mockResolvedValue(false);
      const logger = { warn: jest.fn(), debug: jest.fn() };

      await expect(readLayoutFirstSeenAt(store, 'remember:', logger)).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalled();
    });

    it('falls back to read-then-write on a store without a conditional write', async () => {
      const plain = new FakeStore() as FakeStore & { setIfAbsent?: unknown };
      delete plain.setIfAbsent;

      const firstSeenAt = await readLayoutFirstSeenAt(plain, 'remember:');

      expect(firstSeenAt).toBeCloseTo(Date.now(), -2);
      expect(JSON.parse(plain.data.get(MARKER_KEY) as string).firstSeenAt).toBe(firstSeenAt);
    });

    it('never overwrites an existing marker -- the timestamp belongs to the fleet', async () => {
      seedLayoutMarker(store, 5_000);
      const stamped = store.data.get(MARKER_KEY);

      const firstSeenAt = await readLayoutFirstSeenAt(store, 'remember:');

      expect(store.data.get(MARKER_KEY)).toBe(stamped);
      expect(firstSeenAt).toBe(JSON.parse(stamped as string).firstSeenAt);
    });

    it('stands down on a malformed marker rather than assuming a clock', async () => {
      store.data.set(MARKER_KEY, 'not json');
      const logger = { warn: jest.fn(), debug: jest.fn() };

      await expect(readLayoutFirstSeenAt(store, 'remember:', logger)).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalled();
    });

    it('stands down when the store cannot be read', async () => {
      jest.spyOn(store, 'getValue').mockRejectedValue(new Error('store gone'));
      const logger = { warn: jest.fn(), debug: jest.fn() };

      await expect(readLayoutFirstSeenAt(store, 'remember:', logger)).resolves.toBeUndefined();
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  describe('scheduling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('deletes nothing while the fleet clock is still running', async () => {
      seedLegacyEntries(store);
      const before = [...store.data.keys()];

      scheduleLegacyRememberPurge(store, 'remember:');
      await jest.advanceTimersByTimeAsync(DEFAULT_DELAY_MS - 1);

      expect([...store.data.keys()]).toEqual([...before, MARKER_KEY]);
    });

    it('sweeps once the window has passed', async () => {
      seedLegacyEntries(store);
      const logger = { warn: jest.fn(), debug: jest.fn() };

      scheduleLegacyRememberPurge(store, 'remember:', { logger });
      await jest.advanceTimersByTimeAsync(DEFAULT_DELAY_MS);

      expect([...store.data.keys()].sort()).toEqual([MARKER_KEY, 'remember:global:banner'].sort());
      expect(logger.warn.mock.calls[0][0]).toContain('purged 3 entries');
    });

    it('a restart does not reset the clock', async () => {
      // The whole point of keeping the clock in the store: an instance that starts 23h into
      // the window waits out the last hour, not another full window.
      seedLegacyEntries(store);
      seedLayoutMarker(store, DEFAULT_DELAY_MS - 3_600_000);

      scheduleLegacyRememberPurge(store, 'remember:');
      await jest.advanceTimersByTimeAsync(3_600_000);

      expect(store.data.has('remember:session:session-abc:theme')).toBe(false);
    });

    it('sweeps on the first wake when the window has already passed', async () => {
      seedLegacyEntries(store);
      seedLayoutMarker(store, DEFAULT_DELAY_MS + 1);

      scheduleLegacyRememberPurge(store, 'remember:');
      await jest.advanceTimersByTimeAsync(0);

      expect(store.data.has('remember:session:session-abc:theme')).toBe(false);
    });

    it('deletes nothing when the clock cannot be established', async () => {
      seedLegacyEntries(store);
      store.data.set(MARKER_KEY, 'not json');
      const before = [...store.data.keys()];

      scheduleLegacyRememberPurge(store, 'remember:');
      await jest.advanceTimersByTimeAsync(DEFAULT_DELAY_MS * 2);

      expect([...store.data.keys()]).toEqual(before);
    });

    it('honours a custom delay', async () => {
      seedLegacyEntries(store);

      scheduleLegacyRememberPurge(store, 'remember:', { delayMs: 1_000 });
      await jest.advanceTimersByTimeAsync(1_000);

      expect(store.data.has('remember:session:session-abc:theme')).toBe(false);
    });

    it('arms at most once per store', async () => {
      seedLegacyEntries(store);
      const keysSpy = jest.spyOn(store, 'keys');

      scheduleLegacyRememberPurge(store, 'remember:', { delayMs: 1_000 });
      scheduleLegacyRememberPurge(store, 'remember:', { delayMs: 1_000 });
      await jest.advanceTimersByTimeAsync(1_000);

      expect(keysSpy).toHaveBeenCalledTimes(3);
    });

    it('unrefs the timer so housekeeping cannot hold the process open', async () => {
      const unref = jest.fn();
      jest.spyOn(global, 'setTimeout').mockReturnValue({ unref } as unknown as NodeJS.Timeout);

      scheduleLegacyRememberPurge(store, 'remember:');
      await jest.advanceTimersByTimeAsync(0);

      expect(unref).toHaveBeenCalled();
    });

    it('swallows a sweep that rejects outright', async () => {
      seedLegacyEntries(store);
      seedLayoutMarker(store, DEFAULT_DELAY_MS + 1);
      jest.spyOn(store, 'keys').mockImplementation(() => {
        throw new Error('store gone');
      });

      scheduleLegacyRememberPurge(store, 'remember:', { delayMs: 1_000 });

      await expect(jest.advanceTimersByTimeAsync(1_000)).resolves.toBeUndefined();
    });
  });

  describe('accessor integration', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('purges once the delay elapses', async () => {
      seedLegacyEntries(store);
      new RememberAccessor(store, createContext(), config);

      await jest.advanceTimersByTimeAsync(DEFAULT_DELAY_MS);

      expect(store.data.has('remember:session:session-abc:theme')).toBe(false);
      expect(store.data.has('remember:global:banner')).toBe(true);
    });

    it('does not make a storage call wait for the sweep', async () => {
      seedLegacyEntries(store);
      const accessor = new RememberAccessor(store, createContext(), config);
      const keysSpy = jest.spyOn(store, 'keys');

      await accessor.get('theme');

      expect(keysSpy).not.toHaveBeenCalled();
    });

    it('never deletes an entry written by the current layout', async () => {
      const accessor = new RememberAccessor(store, createContext(), config);
      await accessor.set('theme', 'dark');
      await accessor.set('draft', 'text', { scope: 'tool' });
      await accessor.set('profile', 'me', { scope: 'user' });
      const liveKeys = [...store.data.keys()].filter((key) => key !== MARKER_KEY);
      seedLegacyEntries(store);

      await jest.advanceTimersByTimeAsync(DEFAULT_DELAY_MS);

      const survivors = [...store.data.keys()].filter((key) => key !== MARKER_KEY);
      expect(survivors.sort()).toEqual([...liveKeys, 'remember:global:banner'].sort());
      expect(await accessor.get('theme')).toBe('dark');
    });

    it('honours skipLegacyPurge', async () => {
      seedLegacyEntries(store);
      new RememberAccessor(store, createContext(), { ...config, skipLegacyPurge: true });

      await jest.advanceTimersByTimeAsync(DEFAULT_DELAY_MS);

      expect(store.data.has('remember:session:session-abc:theme')).toBe(true);
    });

    it('honours legacyPurgeDelayMs', async () => {
      seedLegacyEntries(store);
      new RememberAccessor(store, createContext(), { ...config, legacyPurgeDelayMs: 1_000 });

      await jest.advanceTimersByTimeAsync(1_000);

      expect(store.data.has('remember:session:session-abc:theme')).toBe(false);
    });
  });
});
