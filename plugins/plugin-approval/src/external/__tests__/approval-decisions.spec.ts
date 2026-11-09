import type { FrontMcpLogger } from '@frontmcp/sdk';
import { createMemoryStorage } from '@frontmcp/utils';

import { ApprovalStorageStore } from '../../stores';
import { ApprovalScope, ApprovalState } from '../../types';
import { ApprovalDecisionRecorder, pendingRequestKey } from '../approval-decisions';

const TOOL_ID = 'ops:deploy';
const subject = { toolId: TOOL_ID, sessionId: 'session-1', userId: 'alice' };

describe('ApprovalDecisionRecorder', () => {
  let store: ApprovalStorageStore;
  let warn: jest.Mock;
  let decisions: ApprovalDecisionRecorder;

  beforeEach(async () => {
    const storage = createMemoryStorage();
    await storage.connect();
    store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
    await store.initialize();
    warn = jest.fn();
    decisions = new ApprovalDecisionRecorder(store, () => undefined, { warn } as unknown as FrontMcpLogger);
  });

  afterEach(async () => {
    await store.close();
  });

  it.each([
    ['a session approval', ApprovalScope.SESSION, { sessionId: 'session-1' }],
    ['a user approval', ApprovalScope.USER, { userId: 'alice' }],
    ['a time-limited approval', ApprovalScope.TIME_LIMITED, { sessionId: 'session-1', userId: 'alice' }],
  ])('records %s for the caller', async (_, scope, owner) => {
    await expect(decisions.approve(subject, { scope, ttlMs: 1_000 }, 'webhook')).resolves.toBe(true);

    expect(await store.getApprovals(TOOL_ID, 'session-1', 'alice')).toEqual([
      expect.objectContaining({ scope, ...owner, grantedBy: { source: 'api', method: 'api', origin: 'webhook' } }),
    ]);
  });

  it('records a context approval for the context the call ran in', async () => {
    const context = { type: 'repository', identifier: 'acme/api' };

    await decisions.approve({ ...subject, context }, { scope: ApprovalScope.CONTEXT_SPECIFIC }, 'webhook');

    expect(await store.getApprovals(TOOL_ID, 'session-1', 'alice', context)).toEqual([
      expect.objectContaining({ scope: ApprovalScope.CONTEXT_SPECIFIC, context }),
    ]);
  });

  it.each([
    ['a user approval for a caller with no user', { ...subject, userId: undefined }, ApprovalScope.USER],
    ['a context approval for a call with no context', subject, ApprovalScope.CONTEXT_SPECIFIC],
    ['a tool-specific approval, which is a label', subject, ApprovalScope.TOOL_SPECIFIC],
  ])('records nothing for %s', async (_, who, scope) => {
    await expect(decisions.approve(who, { scope }, 'recheck')).resolves.toBe(false);

    expect(await store.queryApprovals({})).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`the recheck approval of ${TOOL_ID} was not recorded`));
  });

  it('records nothing for a time-limited approval without a lifetime', async () => {
    await expect(decisions.approve(subject, { scope: ApprovalScope.TIME_LIMITED }, 'webhook')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a time-limited approval needs ttlMs'));
  });

  it('records nothing for an approval whose delegation chain is deeper than maxDelegationDepth', async () => {
    const delegationContext = {
      delegatorId: 'c',
      delegateId: 'd',
      chain: [
        { delegatorId: 'a', delegateId: 'b' },
        { delegatorId: 'b', delegateId: 'c' },
        { delegatorId: 'c0', delegateId: 'c' },
      ],
    };

    await expect(
      decisions.approve(subject, { decidedBy: { source: 'agent', identifier: 'd', delegationContext } }, 'webhook'),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('maxDelegationDepth is 3'));
  });

  it('passes on a failure of the store itself', async () => {
    jest.spyOn(store, 'grantApproval').mockRejectedValue(new Error('storage down'));

    await expect(decisions.approve(subject, {}, 'webhook')).rejects.toThrow('storage down');
  });

  it('records a denial for the session, for its lifetime', async () => {
    await decisions.deny(
      subject,
      { reason: 'no', decidedBy: { source: 'user', identifier: 'lead' } },
      5_000,
      'webhook',
    );

    expect(await store.getApprovals(TOOL_ID, 'session-1', 'alice')).toEqual([
      expect.objectContaining({
        state: ApprovalState.DENIED,
        scope: ApprovalScope.SESSION,
        ttlMs: 5_000,
        reason: 'no',
        grantedBy: { source: 'user', identifier: 'lead', origin: 'webhook' },
      }),
    ]);
  });

  it('logs a denial a store without denyApproval cannot keep', async () => {
    const withoutDenials = new ApprovalDecisionRecorder({ grantApproval: jest.fn() } as never, () => undefined, {
      warn,
    } as unknown as FrontMcpLogger);

    await withoutDenials.deny(subject, {}, 5_000, 'webhook');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('the store keeps no denials'));
  });

  it('names a request by caller and tool, without naming them', () => {
    const key = pendingRequestKey(subject);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(pendingRequestKey({ ...subject })).toBe(key);
    expect(pendingRequestKey({ ...subject, userId: undefined })).not.toBe(key);
    expect(pendingRequestKey({ ...subject, toolId: 'ops:other' })).not.toBe(key);
  });
});
