import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import type { RememberStoreInterface } from '../providers/remember-store.interface';
import {
  purgeLegacyRememberEntries,
  resetLegacyPurgeStateForTests,
  scheduleLegacyRememberPurge,
} from '../remember.legacy-purge';
import type { RememberPluginOptions } from '../remember.types';

class FakeStore implements RememberStoreInterface {
  readonly data = new Map<string, string>();

  async setValue(key: string, value: unknown): Promise<void> {
    this.data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
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

const DEFAULT_DELAY_MS = 600_000;

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

  describe('scheduling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('deletes nothing until the delay elapses', async () => {
      seedLegacyEntries(store);
      const before = [...store.data.keys()];

      scheduleLegacyRememberPurge(store, 'remember:');
      await jest.advanceTimersByTimeAsync(DEFAULT_DELAY_MS - 1);

      expect([...store.data.keys()]).toEqual(before);
    });

    it('sweeps once the delay elapses', async () => {
      seedLegacyEntries(store);
      const logger = { warn: jest.fn(), debug: jest.fn() };

      scheduleLegacyRememberPurge(store, 'remember:', { logger });
      await jest.advanceTimersByTimeAsync(DEFAULT_DELAY_MS);

      expect([...store.data.keys()]).toEqual(['remember:global:banner']);
      expect(logger.warn.mock.calls[0][0]).toContain('purged 3 entries');
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

    it('unrefs the timer so housekeeping cannot hold the process open', () => {
      const unref = jest.fn();
      jest.spyOn(global, 'setTimeout').mockReturnValue({ unref } as unknown as NodeJS.Timeout);

      scheduleLegacyRememberPurge(store, 'remember:');

      expect(unref).toHaveBeenCalledTimes(1);
    });

    it('swallows a sweep that rejects outright', async () => {
      seedLegacyEntries(store);
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
      const liveKeys = [...store.data.keys()];
      seedLegacyEntries(store);

      await jest.advanceTimersByTimeAsync(DEFAULT_DELAY_MS);

      expect([...store.data.keys()].sort()).toEqual([...liveKeys, 'remember:global:banner'].sort());
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
