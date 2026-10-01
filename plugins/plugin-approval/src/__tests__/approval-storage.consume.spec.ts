/**
 * `ApprovalStorageStore.consumeApproval()`: an `alwaysPrompt` tool's approval admits one call.
 */
import 'reflect-metadata';

import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

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
    await store.close();
  });

  it('deletes the approval and reports that this call got it', async () => {
    const record = await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });

    await expect(store.consumeApproval(record, SESSION_ID)).resolves.toBe(true);
    await expect(store.getApprovals(TOOL_ID, SESSION_ID)).resolves.toEqual([]);
  });

  it('gives one approval to only one of two calls', async () => {
    const record = await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: SESSION_ID });

    const results = await Promise.all([store.consumeApproval(record, SESSION_ID), store.consumeApproval(record, SESSION_ID)]);

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
