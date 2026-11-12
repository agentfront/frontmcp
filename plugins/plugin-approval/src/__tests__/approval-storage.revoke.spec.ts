/**
 * `ApprovalStorageStore` deletes a record it read only while the key still holds it: a record written to the key in
 * the meantime, a denial say, is kept by revocation and by the cleanup of expired approvals.
 */
import 'reflect-metadata';

import { createMemoryStorage, StorageNotSupportedError, type RootStorage } from '@frontmcp/utils';

import type { ApprovalAuditEvent } from '../audit/approval-audit';
import { ApprovalStorageStore } from '../stores/approval-storage.store';
import { ApprovalScope, ApprovalState, type ApprovalRecord } from '../types';

const TOOL_ID = 'accounts:delete_account';
const SESSION_ID = 'session-alice';
const SESSION_KEY = `${TOOL_ID}:session:${SESSION_ID}`;

describe('ApprovalStorageStore deletes only what it read', () => {
  let storage: RootStorage;
  let store: ApprovalStorageStore;
  let events: ApprovalAuditEvent[];

  const recordJson = (record: Partial<ApprovalRecord>) =>
    JSON.stringify({
      toolId: TOOL_ID,
      scope: ApprovalScope.SESSION,
      state: ApprovalState.APPROVED,
      sessionId: SESSION_ID,
      grantedAt: Date.now(),
      grantedBy: { source: 'user' },
      ...record,
    });

  /** Writes `value` to the session key right after the store's next `mget` has read it. */
  const writeAfterNextRead = (value: string) => {
    const read = storage.root.mget.bind(storage.root);
    jest.spyOn(storage.root, 'mget').mockImplementationOnce(async (keys) => {
      const values = await read(keys);
      await storage.namespace('approval').set(SESSION_KEY, value);
      return values;
    });
  };

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.connect();
    events = [];
    store = new ApprovalStorageStore({
      storageInstance: storage,
      cleanupIntervalSeconds: 0,
      audit: { record: (event) => events.push(event) },
    });
    await store.initialize();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await store.close();
  });

  it('keeps a denial recorded between reading the approvals and revoking them', async () => {
    await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });
    const denial = recordJson({ state: ApprovalState.DENIED, grantedAt: Date.now() + 1 });
    writeAfterNextRead(denial);

    await expect(store.revokeApproval({ toolId: TOOL_ID, sessionId: SESSION_ID })).resolves.toBe(false);

    await expect(storage.namespace('approval').get(SESSION_KEY)).resolves.toBe(denial);
    await expect(store.getRevocations(TOOL_ID, SESSION_ID)).resolves.toEqual([]);
    expect(events.filter((event) => event.type === 'approval.revoked')).toEqual([]);
  });

  it('keeps that denial on a backend without compare-and-delete, and still revokes there', async () => {
    jest
      .spyOn(storage.root, 'deleteIfEquals')
      .mockRejectedValue(new StorageNotSupportedError('deleteIfEquals', 'cloudflare-kv'));
    await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });
    const denial = recordJson({ state: ApprovalState.DENIED, grantedAt: Date.now() + 1 });
    writeAfterNextRead(denial);

    await expect(store.revokeApproval({ toolId: TOOL_ID, sessionId: SESSION_ID })).resolves.toBe(false);
    await expect(storage.namespace('approval').get(SESSION_KEY)).resolves.toBe(denial);

    await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });
    await expect(store.revokeApproval({ toolId: TOOL_ID, sessionId: SESSION_ID })).resolves.toBe(true);
    await expect(store.getApprovals(TOOL_ID, SESSION_ID)).resolves.toEqual([]);
  });

  it('keeps an approval granted between reading expired approvals and clearing them', async () => {
    await storage
      .namespace('approval')
      .set(SESSION_KEY, recordJson({ grantedAt: Date.now() - 2_000, expiresAt: Date.now() - 1_000 }));
    const fresh = recordJson({ grantedAt: Date.now() });
    writeAfterNextRead(fresh);

    await expect(store.clearExpiredApprovals()).resolves.toBe(0);

    await expect(storage.namespace('approval').get(SESSION_KEY)).resolves.toBe(fresh);
    expect(events).toEqual([]);
  });
});
