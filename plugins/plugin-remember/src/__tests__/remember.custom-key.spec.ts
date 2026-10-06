/**
 * `encryption.customKey` is the secret Remember derives its encryption keys from (#767). Up to 1.9.1
 * it was never read, and every key came from the server secret.
 */
import 'reflect-metadata';

import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import RememberMemoryProvider from '../providers/remember-memory.provider';
import type { RememberStoreInterface } from '../providers/remember-store.interface';
import { deserializeAndDecrypt, getKeySourceForScope } from '../remember.crypto';
import type { RememberPluginOptions } from '../remember.types';

const context = {
  sessionId: 'session-1',
  authInfo: { sessionId: 'session-1', clientId: 'client-1', extra: { userId: 'user-1' } },
  flow: { name: 'tool' },
} as unknown as FrontMcpContext;

function accessorWith(store: RememberStoreInterface, customKey?: string): RememberAccessor {
  const config: RememberPluginOptions = {
    type: 'memory',
    keyPrefix: 'remember:',
    encryption: { enabled: true, customKey },
    skipLegacyPurge: true,
  };
  return new RememberAccessor(store, context, config);
}

describe('RememberPlugin encryption.customKey', () => {
  let store: RememberMemoryProvider;

  beforeEach(() => {
    store = new RememberMemoryProvider();
  });

  afterEach(async () => {
    await store.close();
  });

  it('reads back what it wrote with the same custom key', async () => {
    await accessorWith(store, 'custom-secret-a').set('lang', 'he', { scope: 'user' });

    expect(await accessorWith(store, 'custom-secret-a').get('lang', { scope: 'user' })).toBe('he');
  });

  it('cannot read entries written with another custom key, or with the server secret', async () => {
    await accessorWith(store, 'custom-secret-a').set('lang', 'he', { scope: 'user' });

    expect(await accessorWith(store, 'custom-secret-b').get('lang', { scope: 'user' })).toBeUndefined();
    expect(await accessorWith(store).get('lang', { scope: 'user' })).toBeUndefined();
  });

  it('derives the key from the custom key and the scope identity', async () => {
    await accessorWith(store, 'custom-secret-a').set('lang', 'he', { scope: 'user' });
    const [storageKey] = await store.keys('remember:v2:user:*');
    const stored = await store.getValue<string>(storageKey ?? '');

    const keySource = getKeySourceForScope('user', { sessionId: 'session-1', userId: 'user-1' }, 'custom-secret-a');
    const otherUser = getKeySourceForScope('user', { sessionId: 'session-1', userId: 'user-2' }, 'custom-secret-a');

    expect(await deserializeAndDecrypt<{ value: string }>(stored ?? '', keySource)).toMatchObject({ value: 'he' });
    expect(await deserializeAndDecrypt(stored ?? '', otherUser)).toBeNull();
  });
});
