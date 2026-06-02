/**
 * StorageAuthorizationStore Tests
 *
 * Adapter-backed AuthorizationStore. Exercises the authorization-code, pending,
 * and refresh-token CRUD + expiry/revoke/rotate paths against a real
 * MemoryStorageAdapter, plus the two key-namespacing branches (raw adapter vs
 * NamespacedStorage) and the no-op cleanup.
 */

import { createNamespacedStorage, MemoryStorageAdapter } from '@frontmcp/utils';

import type { AuthorizationCodeRecord, PendingAuthorizationRecord, RefreshTokenRecord } from '../authorization.store';
import { StorageAuthorizationStore } from '../storage-authorization.store';

describe('StorageAuthorizationStore', () => {
  let adapter: MemoryStorageAdapter;
  let store: StorageAuthorizationStore;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
    store = new StorageAuthorizationStore(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  function makeCodeRecord(overrides: Partial<AuthorizationCodeRecord> = {}): AuthorizationCodeRecord {
    return store.createCodeRecord({
      clientId: 'client-1',
      redirectUri: 'https://example.com/cb',
      scopes: ['openid', 'profile'],
      pkce: { challenge: 'abc', method: 'S256' },
      userSub: 'user-1',
      ...overrides,
    });
  }

  function makePendingRecord(overrides: Partial<PendingAuthorizationRecord> = {}): PendingAuthorizationRecord {
    return store.createPendingRecord({
      clientId: 'client-1',
      redirectUri: 'https://example.com/cb',
      scopes: ['openid'],
      pkce: { challenge: 'abc', method: 'S256' },
      ...overrides,
    });
  }

  function makeRefreshRecord(overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
    return store.createRefreshTokenRecord({
      clientId: 'client-1',
      userSub: 'user-1',
      scopes: ['openid'],
      ...overrides,
    });
  }

  describe('generators / record builders', () => {
    it('generateCode returns a non-empty string', () => {
      expect(store.generateCode().length).toBeGreaterThan(0);
    });

    it('generateRefreshToken returns a non-empty string', () => {
      expect(store.generateRefreshToken().length).toBeGreaterThan(0);
    });

    it('builds records with sane defaults', () => {
      const code = makeCodeRecord();
      expect(code.used).toBe(false);
      expect(code.expiresAt).toBeGreaterThan(code.createdAt);

      const pending = makePendingRecord();
      expect(pending.id).toBeTruthy();

      const refresh = makeRefreshRecord();
      expect(refresh.revoked).toBe(false);
    });
  });

  describe('authorization code CRUD', () => {
    it('stores and retrieves a code record', async () => {
      const record = makeCodeRecord();
      await store.storeAuthorizationCode(record);
      expect(await store.getAuthorizationCode(record.code)).toEqual(record);
    });

    it('returns null for an unknown code', async () => {
      expect(await store.getAuthorizationCode('nope')).toBeNull();
    });

    it('marks a code used', async () => {
      const record = makeCodeRecord();
      await store.storeAuthorizationCode(record);
      await store.markCodeUsed(record.code);
      const retrieved = await store.getAuthorizationCode(record.code);
      expect(retrieved?.used).toBe(true);
    });

    it('markCodeUsed is a no-op for an unknown code', async () => {
      await expect(store.markCodeUsed('nope')).resolves.toBeUndefined();
    });

    it('deletes a code record', async () => {
      const record = makeCodeRecord();
      await store.storeAuthorizationCode(record);
      await store.deleteAuthorizationCode(record.code);
      expect(await store.getAuthorizationCode(record.code)).toBeNull();
    });

    it('expires a code lazily on read and removes it', async () => {
      const record = makeCodeRecord();
      // The record builder sets its own expiresAt; rewind it after building.
      record.expiresAt = Date.now() - 1000;
      await store.storeAuthorizationCode(record);
      expect(await store.getAuthorizationCode(record.code)).toBeNull();
      // The lazy-expiry branch deletes the underlying key.
      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.includes(`code:${record.code}`))).toBe(false);
    });
  });

  describe('pending authorization CRUD', () => {
    it('stores and retrieves a pending record', async () => {
      const record = makePendingRecord();
      await store.storePendingAuthorization(record);
      expect(await store.getPendingAuthorization(record.id)).toEqual(record);
    });

    it('returns null for an unknown id', async () => {
      expect(await store.getPendingAuthorization('nope')).toBeNull();
    });

    it('deletes a pending record', async () => {
      const record = makePendingRecord();
      await store.storePendingAuthorization(record);
      await store.deletePendingAuthorization(record.id);
      expect(await store.getPendingAuthorization(record.id)).toBeNull();
    });

    it('expires a pending record lazily on read', async () => {
      const record = makePendingRecord();
      record.expiresAt = Date.now() - 1000;
      await store.storePendingAuthorization(record);
      expect(await store.getPendingAuthorization(record.id)).toBeNull();
    });
  });

  describe('refresh token CRUD', () => {
    it('stores and retrieves a refresh token', async () => {
      const record = makeRefreshRecord();
      await store.storeRefreshToken(record);
      expect(await store.getRefreshToken(record.token)).toEqual(record);
    });

    it('returns null for an unknown token', async () => {
      expect(await store.getRefreshToken('nope')).toBeNull();
    });

    it('revokes a refresh token', async () => {
      const record = makeRefreshRecord();
      await store.storeRefreshToken(record);
      await store.revokeRefreshToken(record.token);
      expect(await store.getRefreshToken(record.token)).toBeNull();
    });

    it('revokeRefreshToken is a no-op for an unknown token', async () => {
      await expect(store.revokeRefreshToken('nope')).resolves.toBeUndefined();
    });

    it('returns null for an expired refresh token', async () => {
      const record = makeRefreshRecord();
      record.expiresAt = Date.now() - 1000;
      await store.storeRefreshToken(record);
      expect(await store.getRefreshToken(record.token)).toBeNull();
    });

    it('rotates a refresh token, revoking the old and linking previousToken', async () => {
      const oldRecord = makeRefreshRecord();
      await store.storeRefreshToken(oldRecord);

      const newRecord = makeRefreshRecord();
      await store.rotateRefreshToken(oldRecord.token, newRecord);

      expect(await store.getRefreshToken(oldRecord.token)).toBeNull();
      const rotated = await store.getRefreshToken(newRecord.token);
      expect(rotated?.previousToken).toBe(oldRecord.token);
    });
  });

  describe('cleanup', () => {
    it('is a no-op (TTL backends expire on their own)', async () => {
      await expect(store.cleanup()).resolves.toBeUndefined();
    });
  });

  describe('key namespacing', () => {
    it('prefixes keys with the namespace when given a raw adapter', async () => {
      const record = makeCodeRecord();
      await store.storeAuthorizationCode(record);
      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('oauth:code:'))).toBe(true);
    });

    it('honors a custom namespace', async () => {
      const custom = new StorageAuthorizationStore(adapter, { namespace: 'authz' });
      const record = custom.createRefreshTokenRecord({ clientId: 'c', userSub: 'u', scopes: [] });
      await custom.storeRefreshToken(record);
      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('authz:refresh:'))).toBe(true);
    });

    it('nests its namespace under a NamespacedStorage rather than manually prefixing', async () => {
      const namespaced = createNamespacedStorage(adapter, 'session:abc');
      const nsStore = new StorageAuthorizationStore(namespaced, { namespace: 'oauth' });
      const record = nsStore.createCodeRecord({
        clientId: 'c',
        redirectUri: 'https://x/cb',
        scopes: [],
        pkce: { challenge: 'abc', method: 'S256' },
        userSub: 'u',
      });
      await nsStore.storeAuthorizationCode(record);
      // Round-trips through the namespaced wrapper.
      expect(await nsStore.getAuthorizationCode(record.code)).toEqual(record);
      // The store nests 'oauth' as a sub-namespace of the wrapper's 'session:abc'
      // (the storageKey is NOT manually prefixed in the namespaced branch).
      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('session:abc:oauth:code:'))).toBe(true);
    });
  });
});
