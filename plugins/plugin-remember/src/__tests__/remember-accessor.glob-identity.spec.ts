/**
 * `RememberAccessor.list()` for a caller whose id holds a glob wildcard: it lists only its own keys.
 */
import 'reflect-metadata';

import type { FrontMcpContext } from '@frontmcp/sdk';

import { RememberAccessor } from '../providers/remember-accessor.provider';
import RememberMemoryProvider from '../providers/remember-memory.provider';
import type { RememberPluginOptions } from '../remember.types';

const config: RememberPluginOptions = {
  type: 'memory',
  keyPrefix: 'remember:',
  encryption: { enabled: false },
  skipLegacyPurge: true,
};

function accessorFor(store: RememberMemoryProvider, userId: string): RememberAccessor {
  const ctx = { sessionId: `session-${userId}`, authInfo: { extra: { userId } } } as unknown as FrontMcpContext;
  return new RememberAccessor(store, ctx, config);
}

describe('RememberAccessor.list() for an id holding a wildcard', () => {
  let store: RememberMemoryProvider;

  beforeEach(() => {
    store = new RememberMemoryProvider();
  });

  afterEach(async () => {
    await store.close();
  });

  it("does not list another user's keys that the id would match as a pattern", async () => {
    await accessorFor(store, 'alice').set('secret-plan', 'launch', { scope: 'user' });
    const starred = accessorFor(store, 'ali*');
    await starred.set('own-note', 'hello', { scope: 'user' });

    await expect(starred.list({ scope: 'user' })).resolves.toEqual(['own-note']);
    await expect(accessorFor(store, 'alice').list({ scope: 'user' })).resolves.toEqual(['secret-plan']);
  });
});
