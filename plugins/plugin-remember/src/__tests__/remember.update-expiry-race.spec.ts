import 'reflect-metadata';

import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import RememberMemoryProvider from '../providers/remember-memory.provider';
import type { RememberPluginOptions } from '../remember.types';

const DEFAULT_TTL_SECONDS = 60;
let now = 0;
let advanceAfterNextEncryption = 0;
let runDuringNextEncryption: (() => Promise<unknown>) | undefined;

jest.mock('../remember.crypto', () => {
  const actual = jest.requireActual('../remember.crypto');
  return {
    ...actual,
    encryptAndSerialize: async (...args: Parameters<typeof actual.encryptAndSerialize>) => {
      const serialized = await actual.encryptAndSerialize(...args);
      const concurrentWork = runDuringNextEncryption;
      runDuringNextEncryption = undefined;
      await concurrentWork?.();
      now += advanceAfterNextEncryption;
      advanceAfterNextEncryption = 0;
      return serialized;
    },
  };
});

const context = {
  sessionId: 'session-1',
  authInfo: { sessionId: 'session-1', clientId: 'client-1', extra: { userId: 'user-1' } },
  flow: { name: 'tool' },
} as unknown as FrontMcpContext;

const config: RememberPluginOptions = {
  type: 'memory',
  keyPrefix: 'remember:',
  defaultTTL: DEFAULT_TTL_SECONDS,
  encryption: { enabled: true, customKey: 'k'.repeat(32) },
  skipLegacyPurge: true,
};

describe('updating an encrypted entry whose deadline passes while it is encrypted', () => {
  let store: RememberMemoryProvider;
  let remember: RememberAccessor;

  beforeEach(() => {
    now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    store = new RememberMemoryProvider(undefined, DEFAULT_TTL_SECONDS);
    remember = new RememberAccessor(store, context, config);
  });

  afterEach(async () => {
    runDuringNextEncryption = undefined;
    await store.close();
    jest.restoreAllMocks();
  });

  it('writes nothing and reports it was not updated', async () => {
    await remember.set('draft', 'v1');
    now += 59_600;
    const setValue = jest.spyOn(store, 'setValue');
    advanceAfterNextEncryption = 700;

    await expect(remember.update('draft', 'v2')).resolves.toBe(false);

    expect(setValue).not.toHaveBeenCalled();
    await expect(remember.get('draft')).resolves.toBeUndefined();
  });

  it('keeps a value set while the update was encrypting', async () => {
    await remember.set('draft', 'v1');
    now += 59_600;
    advanceAfterNextEncryption = 700;
    runDuringNextEncryption = () => remember.set('draft', 'v3');

    await expect(remember.update('draft', 'v2')).resolves.toBe(false);

    await expect(remember.get('draft')).resolves.toBe('v3');
  });
});
