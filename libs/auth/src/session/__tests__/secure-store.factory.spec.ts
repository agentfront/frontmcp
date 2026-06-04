/**
 * createSecureStore factory tests (#470).
 *
 * Exercises the secure-store backend selection from `auth.secureStore` config:
 *   - undefined / 'memory' → encrypted in-memory backend, user scope
 *   - object form without backing → encrypted memory backend honoring scope/ttl
 *   - { backend } → the custom backend used as-is (kind 'custom')
 *   - reuse of a supplied StorageAdapter for built-in backings
 *   - explicit encryption.pepper overrides the factory pepper
 *
 * The sqlite/redis paths are covered by token-storage.factory.spec.ts (the same
 * createTokenStorageAdapter is reused); here we verify the mapping + memory.
 */

import { MemoryStorageAdapter } from '@frontmcp/utils';

import { type SecureStoreBackend } from '../secure-store';
import { createSecureStore } from '../secure-store.factory';

describe('createSecureStore', () => {
  it('defaults to an encrypted in-memory backend with user scope (undefined config)', async () => {
    const resolved = await createSecureStore({ config: undefined, pepper: 'p-32-bytes-minimum-aaaaaaaaaaaa' });
    expect(resolved.kind).toBe('memory');
    expect(resolved.scope).toBe('user');
    expect(resolved.ttlMs).toBeUndefined();
    // Round-trips through the encrypted backend.
    await resolved.backend.set('u:ns', 'k', 'v');
    expect(await resolved.backend.get('u:ns', 'k')).toBe('v');
  });

  it("treats 'memory' string the same as undefined", async () => {
    const resolved = await createSecureStore({ config: 'memory', pepper: 'p-32-bytes-minimum-aaaaaaaaaaaa' });
    expect(resolved.kind).toBe('memory');
    expect(resolved.scope).toBe('user');
  });

  it('honors scope and ttlMs from an object-form config', async () => {
    const resolved = await createSecureStore({
      config: { scope: 'session', ttlMs: 30_000 },
      pepper: 'p-32-bytes-minimum-aaaaaaaaaaaa',
    });
    expect(resolved.kind).toBe('memory');
    expect(resolved.scope).toBe('session');
    expect(resolved.ttlMs).toBe(30_000);
  });

  it('uses a custom backend as-is (kind custom), ignoring pepper/adapter', async () => {
    const calls: string[] = [];
    const custom: SecureStoreBackend = {
      get: async () => {
        calls.push('get');
        return null;
      },
      set: async () => {
        calls.push('set');
      },
      delete: async () => {
        calls.push('delete');
        return false;
      },
      list: async () => {
        calls.push('list');
        return [];
      },
    };
    const resolved = await createSecureStore({ config: { backend: custom, scope: 'global' } });
    expect(resolved.kind).toBe('custom');
    expect(resolved.scope).toBe('global');
    expect(resolved.backend).toBe(custom);
    await resolved.backend.get('ns', 'k');
    expect(calls).toEqual(['get']);
  });

  it('reuses a supplied StorageAdapter for a built-in backing', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.connect();
    const resolved = await createSecureStore({
      config: 'memory',
      pepper: 'p-32-bytes-minimum-aaaaaaaaaaaa',
      storage: adapter,
    });
    await resolved.backend.set('u:ns', 'k', 'v');
    // The value is encrypted in the SUPPLIED adapter.
    expect(await adapter.get('mcp:secret:data:u:ns:k')).toBeTruthy();
    await adapter.disconnect();
  });

  it('explicit encryption.pepper isolates from the factory pepper', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.connect();
    const withConfigPepper = await createSecureStore({
      config: { encryption: { pepper: 'config-pepper-32-bytes-minimum-aa' } },
      pepper: 'factory-pepper-32-bytes-minimum-aa',
      storage: adapter,
    });
    await withConfigPepper.backend.set('u:ns', 'k', 'secret');

    // A backend built with the FACTORY pepper (no config override) cannot read it.
    const withFactoryPepper = await createSecureStore({
      config: 'memory',
      pepper: 'factory-pepper-32-bytes-minimum-aa',
      storage: adapter,
    });
    expect(await withFactoryPepper.backend.get('u:ns', 'k')).toBeNull();
    await adapter.disconnect();
  });
});
