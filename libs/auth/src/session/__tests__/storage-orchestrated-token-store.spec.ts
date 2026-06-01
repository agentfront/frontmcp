/**
 * StorageOrchestratedTokenStore Tests
 *
 * Adapter-backed orchestrated TokenStore. Exercises the plaintext and encrypted
 * code paths (store/get/has/delete), expiry, getProviderIds, migrateTokens
 * (plaintext + encrypted + corrupted-skip), deleteAllForAuthorization, the
 * corrupted-record drop branches in getRecord, the encryption-key guard, and
 * the raw-adapter vs NamespacedStorage key namespacing.
 */

import { createNamespacedStorage, MemoryStorageAdapter, randomBytes } from '@frontmcp/utils';

import { EncryptionKeyNotConfiguredError } from '../../errors/auth-internal.errors';
import { StorageOrchestratedTokenStore } from '../storage-orchestrated-token.store';

function encKey(): Uint8Array {
  return randomBytes(32);
}

describe('StorageOrchestratedTokenStore', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  // -------------------------------------------------------------------------
  // Plaintext mode
  // -------------------------------------------------------------------------
  describe('plaintext mode', () => {
    let store: StorageOrchestratedTokenStore;

    beforeEach(() => {
      store = new StorageOrchestratedTokenStore(adapter);
    });

    it('stores and retrieves access + refresh tokens', async () => {
      await store.storeTokens('auth-1', 'github', { accessToken: 'gho_a', refreshToken: 'ghr_b' });
      expect(await store.getAccessToken('auth-1', 'github')).toBe('gho_a');
      expect(await store.getRefreshToken('auth-1', 'github')).toBe('ghr_b');
    });

    it('returns null for missing tokens', async () => {
      expect(await store.getAccessToken('auth-1', 'github')).toBeNull();
      expect(await store.getRefreshToken('auth-1', 'github')).toBeNull();
    });

    it('returns null refresh token when only access token stored', async () => {
      await store.storeTokens('auth-1', 'github', { accessToken: 'gho_a' });
      expect(await store.getRefreshToken('auth-1', 'github')).toBeNull();
    });

    it('hasTokens reflects presence and deletion', async () => {
      expect(await store.hasTokens('auth-1', 'github')).toBe(false);
      await store.storeTokens('auth-1', 'github', { accessToken: 'gho_a' });
      expect(await store.hasTokens('auth-1', 'github')).toBe(true);
      await store.deleteTokens('auth-1', 'github');
      expect(await store.hasTokens('auth-1', 'github')).toBe(false);
    });

    it('overwrites existing tokens', async () => {
      await store.storeTokens('auth-1', 'github', { accessToken: 'old' });
      await store.storeTokens('auth-1', 'github', { accessToken: 'new' });
      expect(await store.getAccessToken('auth-1', 'github')).toBe('new');
    });

    it('stores plaintext JSON on the adapter (not an encrypted envelope)', async () => {
      await store.storeTokens('auth-1', 'github', { accessToken: 'gho_plaintext' });
      const raw = await adapter.get('otok:auth-1:github');
      expect(raw).toContain('gho_plaintext');
      expect((JSON.parse(raw as string) as { accessToken: string }).accessToken).toBe('gho_plaintext');
    });

    it('drops and returns null for an unparseable plaintext record', async () => {
      await adapter.set('otok:auth-1:github', 'not-json');
      expect(await store.getAccessToken('auth-1', 'github')).toBeNull();
      // Corrupted record was dropped.
      expect(await adapter.get('otok:auth-1:github')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Encrypted mode
  // -------------------------------------------------------------------------
  describe('encrypted mode', () => {
    let key: Uint8Array;
    let store: StorageOrchestratedTokenStore;

    beforeEach(() => {
      key = encKey();
      store = new StorageOrchestratedTokenStore(adapter, { encryptionKey: key });
    });

    it('round-trips encrypted tokens', async () => {
      await store.storeTokens('auth-1', 'github', { accessToken: 'gho_secret', refreshToken: 'ghr_secret' });
      expect(await store.getAccessToken('auth-1', 'github')).toBe('gho_secret');
      expect(await store.getRefreshToken('auth-1', 'github')).toBe('ghr_secret');
    });

    it('does not store the plaintext token on the adapter', async () => {
      await store.storeTokens('auth-1', 'github', { accessToken: 'gho_secret' });
      const raw = await adapter.get('otok:auth-1:github');
      expect(raw).not.toContain('gho_secret');
    });

    it('drops and returns null when a record cannot be decrypted (wrong key)', async () => {
      await store.storeTokens('auth-1', 'github', { accessToken: 'gho_secret' });
      // A store with a different key cannot decrypt it.
      const otherStore = new StorageOrchestratedTokenStore(adapter, { encryptionKey: encKey() });
      expect(await otherStore.getAccessToken('auth-1', 'github')).toBeNull();
      // getRecord deleted the undecryptable key.
      expect(await adapter.get('otok:auth-1:github')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Expiry
  // -------------------------------------------------------------------------
  describe('expiry', () => {
    it('returns null and drops an expired record (plaintext)', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      await store.storeTokens('auth-1', 'github', { accessToken: 'gho_a', expiresAt: Date.now() - 1000 });
      expect(await store.getAccessToken('auth-1', 'github')).toBeNull();
    });

    it('applies defaultTtlMs as the record expiresAt when none provided', async () => {
      const store = new StorageOrchestratedTokenStore(adapter, { defaultTtlMs: 3_600_000 });
      await store.storeTokens('auth-1', 'github', { accessToken: 'gho_a' });
      // Still retrievable immediately.
      expect(await store.getAccessToken('auth-1', 'github')).toBe('gho_a');
      // The stored record carries the derived expiresAt.
      const raw = JSON.parse((await adapter.get('otok:auth-1:github')) as string) as { expiresAt: number };
      expect(raw.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  // -------------------------------------------------------------------------
  // getProviderIds
  // -------------------------------------------------------------------------
  describe('getProviderIds', () => {
    it('lists provider ids for an authorization', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      await store.storeTokens('auth-1', 'github', { accessToken: 'a' });
      await store.storeTokens('auth-1', 'google', { accessToken: 'b' });
      await store.storeTokens('auth-2', 'slack', { accessToken: 'c' });

      const ids = await store.getProviderIds('auth-1');
      expect(ids.sort()).toEqual(['github', 'google']);
    });

    it('returns an empty array when none exist', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      expect(await store.getProviderIds('auth-x')).toEqual([]);
    });

    it('excludes expired records', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      await store.storeTokens('auth-1', 'github', { accessToken: 'a', expiresAt: Date.now() - 1000 });
      await store.storeTokens('auth-1', 'google', { accessToken: 'b', expiresAt: Date.now() + 3_600_000 });
      expect(await store.getProviderIds('auth-1')).toEqual(['google']);
    });

    it('works in encrypted mode', async () => {
      const store = new StorageOrchestratedTokenStore(adapter, { encryptionKey: encKey() });
      await store.storeTokens('auth-1', 'github', { accessToken: 'a' });
      expect(await store.getProviderIds('auth-1')).toEqual(['github']);
    });
  });

  // -------------------------------------------------------------------------
  // deleteAllForAuthorization
  // -------------------------------------------------------------------------
  describe('deleteAllForAuthorization', () => {
    it('removes only the matching authorization', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      await store.storeTokens('auth-1', 'github', { accessToken: 'a' });
      await store.storeTokens('auth-1', 'google', { accessToken: 'b' });
      await store.storeTokens('auth-2', 'github', { accessToken: 'c' });

      await store.deleteAllForAuthorization('auth-1');

      expect(await store.getAccessToken('auth-1', 'github')).toBeNull();
      expect(await store.getAccessToken('auth-1', 'google')).toBeNull();
      expect(await store.getAccessToken('auth-2', 'github')).toBe('c');
    });

    it('is a no-op when no tokens exist', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      await expect(store.deleteAllForAuthorization('none')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // migrateTokens
  // -------------------------------------------------------------------------
  describe('migrateTokens (plaintext)', () => {
    it('moves tokens from one authorization id to another', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      await store.storeTokens('pending:abc', 'github', { accessToken: 'a' });
      await store.storeTokens('pending:abc', 'google', { accessToken: 'b' });

      await store.migrateTokens('pending:abc', 'real-auth');

      expect(await store.getAccessToken('pending:abc', 'github')).toBeNull();
      expect(await store.getAccessToken('real-auth', 'github')).toBe('a');
      expect(await store.getAccessToken('real-auth', 'google')).toBe('b');
    });

    it('preserves expiresAt while migrating plaintext records', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      const exp = Date.now() + 3_600_000;
      await store.storeTokens('pending:abc', 'github', { accessToken: 'a', expiresAt: exp });
      await store.migrateTokens('pending:abc', 'real-auth');
      const raw = JSON.parse((await adapter.get('otok:real-auth:github')) as string) as { expiresAt: number };
      expect(raw.expiresAt).toBe(exp);
    });

    it('tolerates an unparseable plaintext value during migration', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      await adapter.set('otok:pending:abc:github', 'not-json');
      await store.migrateTokens('pending:abc', 'real-auth');
      // Copied verbatim with no TTL; old key removed.
      expect(await adapter.get('otok:pending:abc:github')).toBeNull();
      expect(await adapter.get('otok:real-auth:github')).toBe('not-json');
    });

    it('is a no-op when the source has no tokens', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      await expect(store.migrateTokens('none', 'target')).resolves.toBeUndefined();
    });
  });

  describe('migrateTokens (encrypted)', () => {
    it('decrypts with the old subkey and re-encrypts with the new one', async () => {
      const store = new StorageOrchestratedTokenStore(adapter, { encryptionKey: encKey() });
      await store.storeTokens('pending:abc', 'github', { accessToken: 'secret', refreshToken: 'refresh' });

      await store.migrateTokens('pending:abc', 'real-auth');

      expect(await store.getAccessToken('pending:abc', 'github')).toBeNull();
      expect(await store.getAccessToken('real-auth', 'github')).toBe('secret');
      expect(await store.getRefreshToken('real-auth', 'github')).toBe('refresh');
    });

    it('skips a corrupted encrypted record during migration', async () => {
      const store = new StorageOrchestratedTokenStore(adapter, { encryptionKey: encKey() });
      await store.storeTokens('pending:abc', 'github', { accessToken: 'good' });
      // Overwrite one record with garbage that cannot be decrypted.
      await adapter.set('otok:pending:abc:google', 'garbage-not-an-envelope');

      await store.migrateTokens('pending:abc', 'real-auth');

      // The good record migrated; the corrupted one was skipped (left in place).
      expect(await store.getAccessToken('real-auth', 'github')).toBe('good');
      expect(await adapter.get('otok:pending:abc:google')).toBe('garbage-not-an-envelope');
    });
  });

  // -------------------------------------------------------------------------
  // Encryption-key guard
  // -------------------------------------------------------------------------
  describe('encryption-key guard', () => {
    it('keyFor throws EncryptionKeyNotConfiguredError when no key is configured', () => {
      // The private `keyFor` is normally only reached when encryptionKey is set;
      // invoking it directly asserts the defensive guard branch.
      const store = new StorageOrchestratedTokenStore(adapter);
      expect(() => (store as unknown as { keyFor: (k: string) => Uint8Array }).keyFor('auth-1:github')).toThrow(
        EncryptionKeyNotConfiguredError,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Namespacing
  // -------------------------------------------------------------------------
  describe('key namespacing', () => {
    it('prefixes keys with the default namespace for a raw adapter', async () => {
      const store = new StorageOrchestratedTokenStore(adapter);
      await store.storeTokens('auth-1', 'github', { accessToken: 'a' });
      const keys = await adapter.keys('*');
      expect(keys).toContain('otok:auth-1:github');
    });

    it('honors a custom namespace', async () => {
      const store = new StorageOrchestratedTokenStore(adapter, { namespace: 'prov' });
      await store.storeTokens('auth-1', 'github', { accessToken: 'a' });
      const keys = await adapter.keys('*');
      expect(keys).toContain('prov:auth-1:github');
    });

    it('does not double-prefix when given a NamespacedStorage', async () => {
      const namespaced = createNamespacedStorage(adapter, 'sess:1');
      const store = new StorageOrchestratedTokenStore(namespaced);
      await store.storeTokens('auth-1', 'github', { accessToken: 'a' });
      expect(await store.getAccessToken('auth-1', 'github')).toBe('a');
      const keys = await adapter.keys('*');
      expect(keys.some((k) => k.startsWith('sess:1:'))).toBe(true);
      expect(keys.some((k) => k.startsWith('otok:'))).toBe(false);
      // getProviderIds also works through the namespaced wrapper.
      expect(await store.getProviderIds('auth-1')).toEqual(['github']);
    });
  });
});
