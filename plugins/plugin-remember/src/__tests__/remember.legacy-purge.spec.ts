import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import type { RememberStoreInterface } from '../providers/remember-store.interface';
import {
  purgeLegacyRememberEntries,
  purgeLegacyRememberEntriesOnce,
  resetLegacyPurgeStateForTests,
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

  it('runs at most once per store', async () => {
    seedLegacyEntries(store);
    const keysSpy = jest.spyOn(store, 'keys');

    await purgeLegacyRememberEntriesOnce(store, 'remember:');
    const callsAfterFirst = keysSpy.mock.calls.length;
    await purgeLegacyRememberEntriesOnce(store, 'remember:');

    expect(keysSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  describe('accessor integration', () => {
    it('purges on the first storage access', async () => {
      seedLegacyEntries(store);
      const accessor = new RememberAccessor(store, createContext(), config);

      await accessor.get('theme');

      expect(store.data.has('remember:session:session-abc:theme')).toBe(false);
      expect(store.data.has('remember:global:banner')).toBe(true);
    });

    it('never deletes an entry written by the current layout', async () => {
      const accessor = new RememberAccessor(store, createContext(), config);
      await accessor.set('theme', 'dark');
      await accessor.set('draft', 'text', { scope: 'tool' });
      await accessor.set('profile', 'me', { scope: 'user' });
      const liveKeys = [...store.data.keys()];
      seedLegacyEntries(store);
      resetLegacyPurgeStateForTests(store);

      await purgeLegacyRememberEntries(store, 'remember:');

      expect([...store.data.keys()].sort()).toEqual([...liveKeys, 'remember:global:banner'].sort());
      expect(await accessor.get('theme')).toBe('dark');
    });

    it('honours skipLegacyPurge', async () => {
      seedLegacyEntries(store);
      const accessor = new RememberAccessor(store, createContext(), { ...config, skipLegacyPurge: true });

      await accessor.get('theme');

      expect(store.data.has('remember:session:session-abc:theme')).toBe(true);
    });
  });
});
