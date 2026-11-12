/**
 * `ApprovalStorageStore` keys: an approval is read only by the session, user and context it was granted to, whatever
 * characters their ids hold, and a time-limited grant never replaces another record of the same caller.
 */
import 'reflect-metadata';

import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { ApprovalStorageStore } from '../stores/approval-storage.store';
import { ApprovalScope, ApprovalState, type ApprovalRecord } from '../types';

const TOOL_ID = 'accounts:delete_account';
const TTL_MS = 60_000;

describe('ApprovalStorageStore keys', () => {
  let storage: RootStorage;
  let store: ApprovalStorageStore;

  const storeRaw = async (key: string, record: Partial<ApprovalRecord>) =>
    storage.namespace('approval').set(
      key,
      JSON.stringify({
        toolId: TOOL_ID,
        scope: ApprovalScope.SESSION,
        state: ApprovalState.APPROVED,
        grantedAt: Date.now(),
        grantedBy: { source: 'user' },
        ...record,
      }),
    );

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.connect();
    store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it('does not give the approval of session "s1:user:u1" to the caller with session s1 and user u1', async () => {
    await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: 's1:user:u1' });

    await expect(store.getApprovals(TOOL_ID, 's1', 'u1')).resolves.toEqual([]);
    await expect(store.isApproved(TOOL_ID, 's1', 'u1')).resolves.toBe(false);
    await expect(store.getApprovals(TOOL_ID, 's1:user:u1')).resolves.toHaveLength(1);
  });

  it('ignores a record stored up to 1.12.0 under a key that spells another caller', async () => {
    await storeRaw(`${TOOL_ID}:session:s1:user:u1`, { sessionId: 's1:user:u1' });

    await expect(store.getApprovals(TOOL_ID, 's1', 'u1')).resolves.toEqual([]);
  });

  it('still reads a record stored up to 1.12.0 for a session id holding a colon', async () => {
    await storeRaw(`${TOOL_ID}:session:stateless-user:alice`, { sessionId: 'stateless-user:alice' });

    const records = await store.getApprovals(TOOL_ID, 'stateless-user:alice', 'alice');

    expect(records.map((record) => record.sessionId)).toEqual(['stateless-user:alice']);
  });

  it('stores an id holding a colon or a percent sign encoded, and other ids as before', async () => {
    await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: 'stateless-user:50%' });
    await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.USER, userId: 'alice' });

    await expect(storage.namespace('approval').keys('*')).resolves.toEqual(
      expect.arrayContaining([`${TOOL_ID}:session:stateless-user%3A50%25`, `${TOOL_ID}:user:alice`]),
    );
  });

  it('keeps a session denial of a session and a user when a time-limited approval is granted to both', async () => {
    await store.denyApproval({
      toolId: TOOL_ID,
      scope: ApprovalScope.SESSION,
      sessionId: 'session-alice',
      userId: 'alice',
      ttlMs: TTL_MS,
    });
    await store.grantApproval({
      toolId: TOOL_ID,
      scope: ApprovalScope.TIME_LIMITED,
      sessionId: 'session-alice',
      userId: 'alice',
      ttlMs: TTL_MS,
    });

    const states = (await store.getApprovals(TOOL_ID, 'session-alice', 'alice')).map((record) => record.state);

    expect(states.sort()).toEqual([ApprovalState.APPROVED, ApprovalState.DENIED]);
    await expect(store.isApproved(TOOL_ID, 'session-alice', 'alice')).resolves.toBe(false);
  });

  it('uses up and clears the approvals of a session id holding a colon', async () => {
    const record = await store.grantApproval({
      toolId: TOOL_ID,
      scope: ApprovalScope.SESSION,
      sessionId: 'stateless-user:alice',
    });
    await expect(store.consumeApproval(record, 'stateless-user:alice', 'alice')).resolves.toBe(true);

    await store.grantApproval({ toolId: TOOL_ID, scope: ApprovalScope.SESSION, sessionId: 'stateless-user:alice' });
    await storeRaw(`${TOOL_ID}:session:stateless-user:alice:scope:time_limited`, {
      scope: ApprovalScope.TIME_LIMITED,
      sessionId: 'stateless-user:alice',
    });

    await expect(store.clearSessionApprovals('stateless-user:alice')).resolves.toBe(2);
    await expect(store.getApprovals(TOOL_ID, 'stateless-user:alice', 'alice')).resolves.toEqual([]);
  });

  it('clearing session s1 keeps a record stored up to 1.12.0 for session "s1:user:u1" under the same key', async () => {
    const OTHER_TOOL_ID = 'accounts:export';
    await storeRaw(`${TOOL_ID}:session:s1:user:u1`, { sessionId: 's1:user:u1', state: ApprovalState.DENIED });
    await storeRaw(`${OTHER_TOOL_ID}:session:s1:user:u1`, { toolId: OTHER_TOOL_ID, sessionId: 's1', userId: 'u1' });

    await expect(store.clearSessionApprovals('s1')).resolves.toBe(1);

    await expect(store.getApprovals(TOOL_ID, 's1:user:u1')).resolves.toEqual([
      expect.objectContaining({ sessionId: 's1:user:u1', state: ApprovalState.DENIED }),
    ]);
    await expect(store.getApprovals(OTHER_TOOL_ID, 's1', 'u1')).resolves.toEqual([]);
  });
});
