/**
 * A revocation leaves a record of who revoked it (#660).
 *
 * `revokeApproval()` deleted the approval and kept nothing, so `ApprovalRecord.revokedBy` was never
 * set and an audit trail could not say who withdrew an approval.
 */
import 'reflect-metadata';

import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { adminRevoker, ApprovalScope, ApprovalService, ApprovalStorageStore } from '../index';

const TOOL_ID = 'ops:deploy';

describe('revokeApproval() records the revoker (#660)', () => {
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
    await storage.disconnect();
  });

  it('records the signed-in user, the time, the reason and the scope that was revoked', async () => {
    const service = new ApprovalService(store, 'session-1', 'alice');
    await service.grantSessionApproval(TOOL_ID);

    const before = Date.now();
    expect(await service.revokeApproval(TOOL_ID, { reason: 'no longer needed' })).toBe(true);

    expect(await service.isApproved(TOOL_ID)).toBe(false);
    const [revoked] = await service.getRevocations(TOOL_ID);
    expect(revoked.toolId).toBe(TOOL_ID);
    expect(revoked.scope).toBe(ApprovalScope.SESSION);
    expect(revoked.revokedBy).toEqual({ source: 'user', identifier: 'alice', method: 'implicit' });
    expect(revoked.revocationReason).toBe('no longer needed');
    expect(revoked.revokedAt).toBeGreaterThanOrEqual(before);
  });

  it('records an explicit revoker as given', async () => {
    const service = new ApprovalService(store, 'session-1', 'alice');
    await service.grantUserApproval(TOOL_ID);

    await service.revokeApproval(TOOL_ID, { revokedBy: adminRevoker('root') });

    const [revoked] = await service.getRevocations(TOOL_ID);
    expect(revoked.revokedBy).toMatchObject({ source: 'admin', identifier: 'root', method: 'interactive' });
  });

  it('records a revoker for a caller with no signed-in user', async () => {
    const service = new ApprovalService(store, 'session-1');
    await service.grantSessionApproval(TOOL_ID);
    await service.revokeApproval(TOOL_ID);

    const [revoked] = await service.getRevocations(TOOL_ID);
    expect(revoked.revokedBy).toEqual({ source: 'user', method: 'implicit' });
  });

  it('records nothing when there was nothing to revoke', async () => {
    const service = new ApprovalService(store, 'session-1', 'alice');

    expect(await service.revokeApproval(TOOL_ID)).toBe(false);
    expect(await service.getRevocations(TOOL_ID)).toEqual([]);
  });

  it("does not show one caller another caller's revocations", async () => {
    const alice = new ApprovalService(store, 'session-alice', 'alice');
    const bob = new ApprovalService(store, 'session-bob', 'bob');
    await alice.grantSessionApproval(TOOL_ID);
    await alice.revokeApproval(TOOL_ID);

    expect(await bob.getRevocations(TOOL_ID)).toEqual([]);
  });

  it('keeps revoked approvals out of the live approvals and the stats', async () => {
    const service = new ApprovalService(store, 'session-1', 'alice');
    await service.grantSessionApproval(TOOL_ID);
    await service.revokeApproval(TOOL_ID);

    expect(await service.queryApprovals({})).toEqual([]);
    expect(await service.getApproval(TOOL_ID)).toBeUndefined();
    expect((await store.getStats()).totalApprovals).toBe(0);
  });
});
