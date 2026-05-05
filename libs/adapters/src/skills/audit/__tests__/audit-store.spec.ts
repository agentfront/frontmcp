// file: libs/adapters/src/skills/audit/__tests__/audit-store.spec.ts

import { createMemoryStorage, type StorageAdapter } from '@frontmcp/utils';

import { type SkillAuditRecord } from '../audit-record.types';
import { MemoryAuditStore, StorageAdapterAuditStore, type SkillAuditStore } from '../audit-store';

function fakeRecord(seq: number): SkillAuditRecord {
  return {
    id: `id-${seq}`,
    sequence: seq,
    timestamp: '2026-05-05T12:00:00.000Z',
    subject: 'user-1',
    skillId: 'billing',
    actionId: 'createInvoice',
    bundleId: 'acme:prod',
    bundleVersion: '1.0.0',
    phase: 'authority-check-pass',
    inputHash: 'a'.repeat(64),
    prevHash: '0'.repeat(64),
    signature: 'AAA',
    signatureKeyId: 'k',
    signatureAlg: 'HS256',
  };
}

function describeAuditStoreContract(name: string, factory: () => Promise<SkillAuditStore>): void {
  describe(name, () => {
    let store: SkillAuditStore;

    beforeEach(async () => {
      store = await factory();
    });

    it('returns undefined tail for empty chain', async () => {
      expect(await store.tail()).toBeUndefined();
    });

    it('allocates monotonic sequence numbers', async () => {
      const a = await store.nextSequence();
      const b = await store.nextSequence();
      const c = await store.nextSequence();
      expect(b).toBe(a + 1);
      expect(c).toBe(b + 1);
    });

    it('persists and reads back records in sequence order', async () => {
      const seq1 = await store.nextSequence();
      await store.appendAtSequence(fakeRecord(seq1));
      const seq2 = await store.nextSequence();
      await store.appendAtSequence(fakeRecord(seq2));

      const all = await store.read();
      expect(all.length).toBe(2);
      expect(all.map((r) => r.sequence)).toEqual([seq1, seq2]);
    });

    it('tail returns the latest record', async () => {
      const seq1 = await store.nextSequence();
      await store.appendAtSequence(fakeRecord(seq1));
      const seq2 = await store.nextSequence();
      await store.appendAtSequence(fakeRecord(seq2));

      const tail = await store.tail();
      expect(tail?.sequence).toBe(seq2);
    });

    it('rejects appending a different record at an already-used sequence', async () => {
      const seq = await store.nextSequence();
      await store.appendAtSequence(fakeRecord(seq));
      // Same sequence, different record body — must NOT clobber.
      const second = { ...fakeRecord(seq), id: 'different-id' };
      await expect(store.appendAtSequence(second)).rejects.toThrow();
    });

    it('respects from/limit on read', async () => {
      for (let i = 0; i < 5; i++) {
        const s = await store.nextSequence();
        await store.appendAtSequence(fakeRecord(s));
      }
      const slice = await store.read({ from: 2, limit: 2 });
      expect(slice.length).toBe(2);
      expect(slice[0]!.sequence).toBe(2);
      expect(slice[1]!.sequence).toBe(3);
    });

    it('handles concurrent nextSequence allocations without duplicates', async () => {
      const allocations = await Promise.all([
        store.nextSequence(),
        store.nextSequence(),
        store.nextSequence(),
        store.nextSequence(),
      ]);
      const unique = new Set(allocations);
      expect(unique.size).toBe(4);
    });
  });
}

describeAuditStoreContract('MemoryAuditStore', async () => new MemoryAuditStore());

describeAuditStoreContract('StorageAdapterAuditStore (memory backend)', async () => {
  const adapter = createMemoryStorage();
  await adapter.connect();
  return new StorageAdapterAuditStore(adapter as StorageAdapter);
});

describe('StorageAdapterAuditStore — restart safety', () => {
  it('survives a fresh wrapper around the same adapter (process restart sim)', async () => {
    const adapter = createMemoryStorage();
    await adapter.connect();
    const store1 = new StorageAdapterAuditStore(adapter as StorageAdapter);
    const seq1 = await store1.nextSequence();
    await store1.appendAtSequence(fakeRecord(seq1));

    // New wrapper, same adapter — simulates a process restart with shared backend.
    const store2 = new StorageAdapterAuditStore(adapter as StorageAdapter);
    const tail = await store2.tail();
    expect(tail?.sequence).toBe(seq1);

    const seq2 = await store2.nextSequence();
    expect(seq2).toBe(seq1 + 1);
  });

  it('returns empty array when reading from a never-used backend', async () => {
    const adapter = createMemoryStorage();
    await adapter.connect();
    const store = new StorageAdapterAuditStore(adapter as StorageAdapter);
    expect(await store.read()).toEqual([]);
  });

  it('honors custom key prefixes', async () => {
    const adapter = createMemoryStorage();
    await adapter.connect();
    const store = new StorageAdapterAuditStore(adapter as StorageAdapter, {
      sequenceKey: 'custom:audit:seq',
      recordKeyPrefix: 'custom:audit:rec:',
    });
    const seq = await store.nextSequence();
    await store.appendAtSequence(fakeRecord(seq));
    const stored = await adapter.get(`custom:audit:rec:${seq}`);
    expect(stored).not.toBeNull();
    const seqRaw = await adapter.get('custom:audit:seq');
    expect(seqRaw).toBe(String(seq));
  });
});
