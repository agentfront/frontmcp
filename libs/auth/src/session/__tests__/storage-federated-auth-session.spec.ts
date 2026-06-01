/**
 * StorageFederatedAuthSessionStore Tests
 *
 * Adapter-backed FederatedAuthSessionStore. Exercises store/get/update/delete,
 * the Map<->array (de)serialization via to/fromSessionRecord, lazy expiry, TTL
 * derivation, and the raw-adapter vs NamespacedStorage key branches.
 */

import { createNamespacedStorage, MemoryStorageAdapter } from '@frontmcp/utils';

import { createFederatedAuthSession, type FederatedAuthSession } from '../federated-auth.session';
import { StorageFederatedAuthSessionStore } from '../storage-federated-auth.session';

function makeSession(overrides: Partial<FederatedAuthSession> = {}): FederatedAuthSession {
  const session = createFederatedAuthSession({
    pendingAuthId: 'pending-1',
    clientId: 'client-1',
    redirectUri: 'https://example.com/cb',
    scopes: ['openid'],
    userInfo: { email: 'user@example.com', name: 'User' },
    frontmcpPkce: { challenge: 'abc', method: 'S256' },
    providerIds: ['github', 'google'],
  });
  return { ...session, ...overrides };
}

describe('StorageFederatedAuthSessionStore', () => {
  let adapter: MemoryStorageAdapter;
  let store: StorageFederatedAuthSessionStore;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
    store = new StorageFederatedAuthSessionStore(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('stores and retrieves a session', async () => {
    const session = makeSession();
    await store.store(session);
    const retrieved = await store.get(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(session.id);
    expect(retrieved?.providerQueue).toEqual(['github', 'google']);
  });

  it('returns null for an unknown id', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('round-trips the completedProviders Map through serialization', async () => {
    const session = makeSession();
    session.completedProviders.set('github', {
      providerId: 'github',
      tokens: { accessToken: 'gho_x', refreshToken: 'ghr_x' },
      userInfo: { sub: 'gh-sub', email: 'u@example.com' },
      completedAt: Date.now(),
    });
    await store.store(session);

    const retrieved = await store.get(session.id);
    expect(retrieved?.completedProviders).toBeInstanceOf(Map);
    expect(retrieved?.completedProviders.get('github')?.tokens.accessToken).toBe('gho_x');
  });

  it('update overwrites an existing session', async () => {
    const session = makeSession();
    await store.store(session);

    session.currentProviderId = 'github';
    session.providerQueue = ['google'];
    await store.update(session);

    const retrieved = await store.get(session.id);
    expect(retrieved?.currentProviderId).toBe('github');
    expect(retrieved?.providerQueue).toEqual(['google']);
  });

  it('deletes a session', async () => {
    const session = makeSession();
    await store.store(session);
    await store.delete(session.id);
    expect(await store.get(session.id)).toBeNull();
  });

  it('expires a session lazily on read and removes the key', async () => {
    const session = makeSession({ expiresAt: Date.now() - 1000 });
    await store.store(session);
    expect(await store.get(session.id)).toBeNull();
    const keys = await adapter.keys('*');
    expect(keys.some((k) => k.includes(session.id))).toBe(false);
  });

  describe('key namespacing', () => {
    it('prefixes keys with the default namespace for a raw adapter', async () => {
      const session = makeSession();
      await store.store(session);
      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('fed:'))).toBe(true);
    });

    it('honors a custom namespace', async () => {
      const custom = new StorageFederatedAuthSessionStore(adapter, { namespace: 'flow' });
      const session = makeSession();
      await custom.store(session);
      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('flow:'))).toBe(true);
    });

    it('nests its namespace under a NamespacedStorage rather than manually prefixing', async () => {
      const namespaced = createNamespacedStorage(adapter, 'sess:1');
      const nsStore = new StorageFederatedAuthSessionStore(namespaced);
      const session = makeSession();
      await nsStore.store(session);
      expect(await nsStore.get(session.id)).not.toBeNull();
      // 'fed' becomes a sub-namespace of the wrapper's 'sess:1' (key() is not
      // manually prefixed in the namespaced branch).
      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith(`sess:1:fed:${session.id}`))).toBe(true);
    });
  });
});
