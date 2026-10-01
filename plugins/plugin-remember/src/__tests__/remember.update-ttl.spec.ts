/**
 * `update()` without a `ttl` keeps the entry's expiry in the store too (#678).
 *
 * The entry kept its `expiresAt`, but it was written back with no storage TTL, so the store kept
 * it forever: once the expiry passed, `get()` answered the default while `knows()` still said
 * `true` and `list()` still listed the key.
 */
import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import RememberMemoryProvider from '../providers/remember-memory.provider';
import type { RememberPluginOptions } from '../remember.types';

function sessionContext(): FrontMcpContext {
  return {
    sessionId: 'session-update-ttl',
    authInfo: { sessionId: 'session-update-ttl', clientId: 'caller', extra: { sub: 'caller' } },
  } as unknown as FrontMcpContext;
}

const config: RememberPluginOptions = {
  type: 'memory',
  keyPrefix: 'remember:',
  encryption: { enabled: false },
  skipLegacyPurge: true,
};

describe('RememberAccessor.update() and the entry TTL (#678)', () => {
  let store: RememberMemoryProvider;
  let remember: RememberAccessor;
  let now: number;

  beforeEach(() => {
    now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    store = new RememberMemoryProvider();
    remember = new RememberAccessor(store, sessionContext(), config);
  });

  afterEach(async () => {
    await store.close();
    jest.restoreAllMocks();
  });

  it('forgets an entry updated without a ttl once its original ttl runs out', async () => {
    await remember.set('draft', 'v1', { ttl: 60 });
    now += 30_000;
    await expect(remember.update('draft', 'v2')).resolves.toBe(true);

    now += 31_000;

    // knows() and list() first: get() forgets an expired entry it reads, which would hide the bug.
    await expect(remember.knows('draft')).resolves.toBe(false);
    await expect(remember.list()).resolves.toEqual([]);
    await expect(remember.get('draft')).resolves.toBeUndefined();
  });

  it('keeps it, updated, until then', async () => {
    await remember.set('draft', 'v1', { ttl: 60 });
    now += 30_000;
    await remember.update('draft', 'v2');

    now += 29_000;

    await expect(remember.get('draft')).resolves.toBe('v2');
    await expect(remember.knows('draft')).resolves.toBe(true);
    await expect(remember.list()).resolves.toEqual(['draft']);
  });

  it('gives an entry updated with a ttl the new ttl', async () => {
    await remember.set('draft', 'v1', { ttl: 60 });
    now += 30_000;
    await remember.update('draft', 'v2', { ttl: 120 });

    now += 100_000;

    await expect(remember.knows('draft')).resolves.toBe(true);
    await expect(remember.get('draft')).resolves.toBe('v2');

    now += 21_000;

    await expect(remember.list()).resolves.toEqual([]);
    await expect(remember.knows('draft')).resolves.toBe(false);
  });

  it('keeps an entry set without a ttl when it is updated without one', async () => {
    await remember.set('draft', 'v1');
    await remember.update('draft', 'v2');

    now += 365 * 24 * 60 * 60 * 1000;

    await expect(remember.get('draft')).resolves.toBe('v2');
    await expect(remember.knows('draft')).resolves.toBe(true);
  });

  it('writes the remaining whole seconds as the storage ttl, never less than one', async () => {
    const setValue = jest.spyOn(store, 'setValue');
    await remember.set('draft', 'v1', { ttl: 60 });
    now += 59_500;
    await remember.update('draft', 'v2');

    expect(setValue).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 1);
  });
});
