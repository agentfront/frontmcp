/**
 * `ApprovalStorageStore.consumeApproval()`: an `alwaysPrompt` tool's approval admits one call.
 */
import 'reflect-metadata';

import { createMemoryStorage, StorageNotSupportedError, type RootStorage } from '@frontmcp/utils';

import { ApprovalStorageStore } from '../stores/approval-storage.store';
import { ApprovalScope, ApprovalState } from '../types';

const TOOL_ID = 'accounts:delete_account';
const SESSION_ID = 'session-alice';

describe('ApprovalStorageStore.consumeApproval()', () => {
  let storage: RootStorage;
  let store: ApprovalStorageStore;

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.connect();
    store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
    await store.initialize();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await store.close();
  });

  it('deletes the approval and reports that this call got it', async () => {
    const record = await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });

    await expect(store.consumeApproval(record, SESSION_ID)).resolves.toBe(true);
    await expect(store.getApprovals(TOOL_ID, SESSION_ID)).resolves.toEqual([]);
  });

  it('gives one approval to only one of two calls', async () => {
    const record = await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });

    const results = await Promise.all([
      store.consumeApproval(record, SESSION_ID),
      store.consumeApproval(record, SESSION_ID),
    ]);

    expect(results.sort()).toEqual([false, true]);
  });

  it('uses up a user approval found for the caller', async () => {
    const record = await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.USER, userId: 'alice' });

    await expect(store.consumeApproval(record, SESSION_ID, 'alice')).resolves.toBe(true);
    await expect(store.getApprovals(TOOL_ID, SESSION_ID, 'alice')).resolves.toEqual([]);
  });

  it('leaves a newer approval granted in its place', async () => {
    const used = await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });
    const newer = { ...used, grantedAt: used.grantedAt + 1 };
    await storage.namespace('approval').set(`${TOOL_ID}:session:${SESSION_ID}`, JSON.stringify(newer));

    await expect(store.consumeApproval(used, SESSION_ID)).resolves.toBe(false);
    await expect(store.getApprovals(TOOL_ID, SESSION_ID)).resolves.toEqual([newer]);
  });

  it('keeps a denial recorded between reading the approval and using it up', async () => {
    const used = await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });
    const denial = { ...used, state: ApprovalState.DENIED, grantedAt: used.grantedAt + 1 };
    const readFromStore = storage.root.get.bind(storage.root);
    jest.spyOn(storage.root, 'get').mockImplementationOnce(async (key) => {
      const value = await readFromStore(key);
      await storage.namespace('approval').set(`${TOOL_ID}:session:${SESSION_ID}`, JSON.stringify(denial));
      return value;
    });

    await expect(store.consumeApproval(used, SESSION_ID)).resolves.toBe(false);
    await expect(store.getApprovals(TOOL_ID, SESSION_ID)).resolves.toEqual([denial]);
  });

  it('deletes the approval outright on a backend without compare-and-delete', async () => {
    const record = await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });
    jest
      .spyOn(storage.root, 'deleteIfEquals')
      .mockRejectedValue(new StorageNotSupportedError('deleteIfEquals', 'cloudflare-kv'));

    await expect(store.consumeApproval(record, SESSION_ID)).resolves.toBe(true);
    await expect(store.getApprovals(TOOL_ID, SESSION_ID)).resolves.toEqual([]);
  });

  it('reports a storage failure instead of deleting the approval', async () => {
    const record = await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });
    jest.spyOn(storage.root, 'deleteIfEquals').mockRejectedValue(new Error('connection lost'));

    await expect(store.consumeApproval(record, SESSION_ID)).rejects.toThrow('connection lost');
    await expect(store.getApprovals(TOOL_ID, SESSION_ID)).resolves.toEqual([record]);
  });

  it('finds nothing for a record that is not stored for the caller', async () => {
    const record = {
      toolId: TOOL_ID,
      state: ApprovalState.APPROVED,
      scope: ApprovalScope.SESSION,
      grantedAt: Date.now(),
      sessionId: 'session-bob',
      grantedBy: { source: 'user' as const },
    };

    await expect(store.consumeApproval(record, SESSION_ID)).resolves.toBe(false);
  });
});
