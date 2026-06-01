/**
 * Remembered Consent Store tests — InMemory + Storage variants.
 *
 * Covers get/set/delete, overwrite-on-set, the `consent:{userSub}:{clientId}`
 * key shape, isolation across (user, client) pairs, and (for the adapter-backed
 * variant) the raw-adapter vs NamespacedStorage key branches.
 */

import { createNamespacedStorage, MemoryStorageAdapter } from '@frontmcp/utils';

import {
  consentRecordKey,
  InMemoryConsentStore,
  type ConsentStore,
  type RememberedConsentRecord,
} from '../consent.store';
import { StorageConsentStore } from '../storage-consent.store';

function makeRecord(overrides: Partial<RememberedConsentRecord> = {}): RememberedConsentRecord {
  return {
    userSub: 'user-1',
    clientId: 'client-1',
    selectedToolIds: ['notes:create'],
    seenToolIds: ['notes:create', 'notes:list'],
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe('consentRecordKey', () => {
  it('builds a stable consent:{userSub}:{clientId} key', () => {
    expect(consentRecordKey('user-1', 'client-1')).toBe('consent:user-1:client-1');
  });
});

/**
 * Shared behavioral contract exercised by both store implementations.
 */
function runConsentStoreContract(name: string, makeStore: () => Promise<ConsentStore> | ConsentStore): void {
  describe(name, () => {
    let store: ConsentStore;

    beforeEach(async () => {
      store = await makeStore();
    });

    it('returns null when no record exists', async () => {
      expect(await store.get('nobody', 'client-1')).toBeNull();
    });

    it('stores and retrieves a record', async () => {
      const record = makeRecord();
      await store.set(record);
      const got = await store.get('user-1', 'client-1');
      expect(got).not.toBeNull();
      expect(got?.userSub).toBe('user-1');
      expect(got?.clientId).toBe('client-1');
      expect(got?.selectedToolIds).toEqual(['notes:create']);
      expect(got?.seenToolIds).toEqual(['notes:create', 'notes:list']);
      expect(got?.updatedAt).toBe(1_700_000_000_000);
    });

    it('overwrites an existing record on set', async () => {
      await store.set(makeRecord());
      await store.set(makeRecord({ selectedToolIds: ['notes:list'], seenToolIds: ['notes:list'], updatedAt: 2 }));
      const got = await store.get('user-1', 'client-1');
      expect(got?.selectedToolIds).toEqual(['notes:list']);
      expect(got?.seenToolIds).toEqual(['notes:list']);
      expect(got?.updatedAt).toBe(2);
    });

    it('isolates records per (userSub, clientId)', async () => {
      await store.set(makeRecord({ userSub: 'user-1', clientId: 'client-1', selectedToolIds: ['a'] }));
      await store.set(makeRecord({ userSub: 'user-1', clientId: 'client-2', selectedToolIds: ['b'] }));
      await store.set(makeRecord({ userSub: 'user-2', clientId: 'client-1', selectedToolIds: ['c'] }));

      expect((await store.get('user-1', 'client-1'))?.selectedToolIds).toEqual(['a']);
      expect((await store.get('user-1', 'client-2'))?.selectedToolIds).toEqual(['b']);
      expect((await store.get('user-2', 'client-1'))?.selectedToolIds).toEqual(['c']);
    });

    it('deletes a record', async () => {
      await store.set(makeRecord());
      await store.delete('user-1', 'client-1');
      expect(await store.get('user-1', 'client-1')).toBeNull();
    });

    it('delete of a missing record is a no-op', async () => {
      await expect(store.delete('ghost', 'client-1')).resolves.toBeUndefined();
    });
  });
}

runConsentStoreContract('InMemoryConsentStore', () => new InMemoryConsentStore());

runConsentStoreContract('StorageConsentStore (memory adapter)', async () => {
  const adapter = new MemoryStorageAdapter();
  await adapter.connect();
  return new StorageConsentStore(adapter);
});

describe('InMemoryConsentStore — size/clear helpers', () => {
  it('tracks size and clears', async () => {
    const store = new InMemoryConsentStore();
    expect(store.size).toBe(0);
    await store.set(makeRecord());
    await store.set(makeRecord({ clientId: 'client-2' }));
    expect(store.size).toBe(2);
    store.clear();
    expect(store.size).toBe(0);
  });

  it('returns a defensive copy (mutating the input does not corrupt the store)', async () => {
    const store = new InMemoryConsentStore();
    const record = makeRecord();
    await store.set(record);
    record.selectedToolIds.push('mutated');
    const got = await store.get('user-1', 'client-1');
    expect(got?.selectedToolIds).toEqual(['notes:create']);
  });
});

describe('StorageConsentStore — key namespacing', () => {
  let adapter: MemoryStorageAdapter;

  beforeEach(async () => {
    adapter = new MemoryStorageAdapter();
    await adapter.connect();
  });

  afterEach(async () => {
    await adapter.disconnect();
  });

  it('prefixes keys with the default namespace for a raw adapter', async () => {
    const store = new StorageConsentStore(adapter);
    await store.set(makeRecord());
    const keys = await adapter.keys('*');
    expect(keys.some((k) => k.startsWith('remembered-consent:consent:user-1:client-1'))).toBe(true);
  });

  it('honors a custom namespace', async () => {
    const store = new StorageConsentStore(adapter, { namespace: 'rc' });
    await store.set(makeRecord());
    const keys = await adapter.keys('*');
    expect(keys.some((k) => k.startsWith('rc:consent:user-1:client-1'))).toBe(true);
  });

  it('nests its namespace under a NamespacedStorage rather than manually prefixing', async () => {
    const namespaced = createNamespacedStorage(adapter, 'tenant:1');
    const store = new StorageConsentStore(namespaced);
    await store.set(makeRecord());
    expect(await store.get('user-1', 'client-1')).not.toBeNull();
    const keys = await adapter.keys('*');
    expect(keys.some((k) => k.startsWith('tenant:1:remembered-consent:consent:user-1:client-1'))).toBe(true);
  });
});
