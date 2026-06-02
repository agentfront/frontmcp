/**
 * EncryptedStorageSecureStoreBackend tests (#470).
 *
 * Exercises the built-in encrypted secure-store backend against a real
 * MemoryStorageAdapter (the same backend powers the sqlite/redis backings, only
 * the adapter differs):
 *   - get/set/delete/list round-trip within a namespace
 *   - encryption at rest (plaintext never written; AES-GCM envelope present)
 *   - namespace isolation (one namespace cannot read another's secret)
 *   - pepper isolation (a different pepper cannot decrypt)
 *   - TTL plumbed to the adapter as ttlSeconds
 *
 * No PII — synthetic namespaces and secrets only.
 */

import { MemoryStorageAdapter } from '@frontmcp/utils';

import { EncryptedStorageSecureStoreBackend } from '../secure-store-backends';

const PEPPER = 'secure-store-test-pepper-32-bytes-min';
const NS = 'u:namespace-alpha';

describe('EncryptedStorageSecureStoreBackend', () => {
  let adapter: MemoryStorageAdapter;
  let backend: EncryptedStorageSecureStoreBackend;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
    backend = new EncryptedStorageSecureStoreBackend({ storage: adapter, pepper: PEPPER });
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  describe('get/set/delete/list round-trip', () => {
    it('stores and reads back a value', async () => {
      await backend.set(NS, 'api-key', 'sk-secret-123');
      expect(await backend.get(NS, 'api-key')).toBe('sk-secret-123');
    });

    it('returns null for an absent key', async () => {
      expect(await backend.get(NS, 'missing')).toBeNull();
    });

    it('lists stored keys (and de-dups on overwrite)', async () => {
      await backend.set(NS, 'a', '1');
      await backend.set(NS, 'b', '2');
      await backend.set(NS, 'a', '1-updated');
      const keys = await backend.list(NS);
      expect(keys.sort()).toEqual(['a', 'b']);
      expect(await backend.get(NS, 'a')).toBe('1-updated');
    });

    it('deletes a key and drops it from the set', async () => {
      await backend.set(NS, 'a', '1');
      await backend.set(NS, 'b', '2');
      expect(await backend.delete(NS, 'a')).toBe(true);
      expect(await backend.get(NS, 'a')).toBeNull();
      expect(await backend.list(NS)).toEqual(['b']);
    });

    it('delete is idempotent for an absent key', async () => {
      expect(await backend.delete(NS, 'nope')).toBe(false);
    });

    it('list is empty for an unknown namespace', async () => {
      expect(await backend.list('u:never-used')).toEqual([]);
    });
  });

  describe('encryption at rest', () => {
    it('persists ciphertext, NOT plaintext', async () => {
      await backend.set(NS, 'api-key', 'super-secret-value');
      const raw = await adapter.get(`mcp:secret:data:${NS}:api-key`);
      expect(raw).toBeTruthy();
      expect(raw).not.toContain('super-secret-value');
      const parsed = JSON.parse(raw as string) as { enc: { alg: string; iv: string; ct: string; tag: string } };
      expect(parsed.enc.alg).toBe('aes-256-gcm');
      expect(parsed.enc.ct).toBeTruthy();
      expect(parsed.enc.iv).toBeTruthy();
      expect(parsed.enc.tag).toBeTruthy();
    });

    it('a different pepper cannot decrypt (fails closed → null)', async () => {
      await backend.set(NS, 'api-key', 'secret');
      const other = new EncryptedStorageSecureStoreBackend({ storage: adapter, pepper: 'a-totally-different-pepper' });
      expect(await other.get(NS, 'api-key')).toBeNull();
    });

    it('corrupted ciphertext fails closed → null', async () => {
      await backend.set(NS, 'api-key', 'secret');
      // Tamper with the stored ciphertext.
      const key = `mcp:secret:data:${NS}:api-key`;
      const raw = JSON.parse((await adapter.get(key)) as string) as { enc: { ct: string } };
      raw.enc.ct = `${raw.enc.ct}tampered`;
      await adapter.set(key, JSON.stringify(raw));
      expect(await backend.get(NS, 'api-key')).toBeNull();
    });
  });

  describe('namespace isolation', () => {
    it('one namespace cannot read another namespace value', async () => {
      await backend.set('u:alice', 'token', 'alice-secret');
      await backend.set('u:bob', 'token', 'bob-secret');
      expect(await backend.get('u:alice', 'token')).toBe('alice-secret');
      expect(await backend.get('u:bob', 'token')).toBe('bob-secret');
      // Keys are isolated per namespace.
      expect(await backend.list('u:alice')).toEqual(['token']);
      expect(await backend.list('u:bob')).toEqual(['token']);
    });
  });

  describe('TTL', () => {
    it('passes ttlSeconds through to the adapter', async () => {
      const setSpy = jest.spyOn(adapter, 'set');
      await backend.set(NS, 'short', 'v', 5000);
      // Both the data write and the key-set write carry the TTL.
      for (const call of setSpy.mock.calls) {
        expect(call[2]).toEqual({ ttlSeconds: 5 });
      }
      setSpy.mockRestore();
    });

    it('omits TTL options when ttlMs is undefined or non-positive', async () => {
      const setSpy = jest.spyOn(adapter, 'set');
      await backend.set(NS, 'k', 'v');
      await backend.set(NS, 'k2', 'v', 0);
      for (const call of setSpy.mock.calls) {
        expect(call[2]).toBeUndefined();
      }
      setSpy.mockRestore();
    });
  });

  it('honors a custom keyPrefix', async () => {
    const custom = new EncryptedStorageSecureStoreBackend({ storage: adapter, pepper: PEPPER, keyPrefix: 'x:y:' });
    await custom.set(NS, 'k', 'v');
    expect(await adapter.get(`x:y:data:${NS}:k`)).toBeTruthy();
    expect(await custom.get(NS, 'k')).toBe('v');
  });
});
