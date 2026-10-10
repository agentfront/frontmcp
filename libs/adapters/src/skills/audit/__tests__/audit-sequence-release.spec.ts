import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { verifyChain, type AuditTrustedKey } from '../audit-chain';
import { SKILL_AUDIT_KEYS, type SkillAuditRecord } from '../audit-record.types';
import { defaultAuditSignatureVerifier, Hs256AuditSigner } from '../audit-signer';
import { MemoryAuditStore, StorageAdapterAuditStore } from '../audit-store';
import { SkillAuditWriter } from '../audit-writer';

const SECRET = 'sequence-release-secret';
const KEY_ID = 'sequence-release';
const TRUSTED: AuditTrustedKey[] = [{ keyId: KEY_ID, alg: 'HS256', secret: new TextEncoder().encode(SECRET) }];
const silentLogger = { warn: () => undefined };

function writeContext(actionId: string) {
  return { subject: 'nour', skillId: 'billing', actionId, bundleId: 'acme', bundleVersion: '1', input: {} };
}

/** Enough of a record for a store, which keys and serializes it by `sequence`. */
function recordAt(sequence: number): SkillAuditRecord {
  return { sequence } as SkillAuditRecord;
}

describe('StorageAdapterAuditStore.releaseSequence', () => {
  let storage: RootStorage;
  let store: StorageAdapterAuditStore;

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.connect();
    store = new StorageAdapterAuditStore(storage);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await storage.disconnect();
  });

  async function counter(): Promise<number> {
    return Number(await storage.get(SKILL_AUDIT_KEYS.sequence));
  }

  /** The next read of a record just written fails, as a timed-out verification read would. */
  function failTheReadAfterTheNextRecordWrite(): void {
    const set = storage.set.bind(storage);
    const get = storage.get.bind(storage);
    let justWritten: string | undefined;
    jest.spyOn(storage, 'set').mockImplementation(async (key, value, options) => {
      await set(key, value, options);
      if (key.startsWith('audit:skills:records:') && justWritten === undefined) justWritten = key;
    });
    jest.spyOn(storage, 'get').mockImplementation(async (key) => {
      if (key === justWritten) {
        justWritten = 'done';
        throw new Error('read timed out');
      }
      return get(key);
    });
  }

  it('keeps the number of a record that was stored although its verification read failed', async () => {
    failTheReadAfterTheNextRecordWrite();
    await new SkillAuditWriter(store, new Hs256AuditSigner(SECRET, KEY_ID), silentLogger).writeAuthorityPass(
      writeContext('first'),
    );
    jest.restoreAllMocks();

    await new SkillAuditWriter(store, new Hs256AuditSigner(SECRET, KEY_ID), silentLogger).writeAuthorityPass(
      writeContext('second'),
    );

    const records = await store.read();
    expect(records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(await counter()).toBe(2);
    expect(verifyChain(records, TRUSTED, defaultAuditSignatureVerifier)).toEqual({ ok: true, verified: 2 });
  });

  it('keeps the counter when another writer allocated a later number', async () => {
    const failed = await store.nextSequence();
    const later = await store.nextSequence();
    await store.appendAtSequence(recordAt(later));

    await store.releaseSequence(failed);

    expect(await counter()).toBe(later);
    expect(await store.nextSequence()).toBe(later + 1);
  });

  it('gives back the latest number when its record was never stored', async () => {
    const failed = await store.nextSequence();

    await store.releaseSequence(failed);

    expect(await counter()).toBe(failed - 1);
  });
});

describe('MemoryAuditStore.releaseSequence', () => {
  it('keeps the number of a record that was stored', async () => {
    const store = new MemoryAuditStore();
    const sequence = await store.nextSequence();
    await store.appendAtSequence(recordAt(sequence));

    await store.releaseSequence(sequence);

    expect(await store.nextSequence()).toBe(sequence + 1);
  });

  it('keeps the counter when a later number was allocated', async () => {
    const store = new MemoryAuditStore();
    const failed = await store.nextSequence();
    const later = await store.nextSequence();

    await store.releaseSequence(failed);

    expect(await store.nextSequence()).toBe(later + 1);
  });

  it('gives back the latest number when its record was never stored', async () => {
    const store = new MemoryAuditStore();
    const failed = await store.nextSequence();

    await store.releaseSequence(failed);

    expect(await store.nextSequence()).toBe(failed);
  });
});
