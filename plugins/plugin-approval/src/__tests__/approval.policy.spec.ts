/**
 * A tool's `allowedScopes`, applied to grants and to stored records.
 */
import { ApprovalScopeNotAllowedError } from '../approval/errors';
import { checkGrantAgainstPolicy, isApprovalUsable } from '../approval/policy';
import { ApprovalScope, ApprovalState, type ApprovalRecord } from '../types';

const SESSION_RECORD: ApprovalRecord = {
  toolId: 'ops:deploy',
  state: ApprovalState.APPROVED,
  scope: ApprovalScope.SESSION,
  grantedAt: 1_000,
  sessionId: 'session-alice',
  grantedBy: { source: 'user' },
};

describe('allowedScopes', () => {
  it('an empty list allows no scope, for grants and for stored records', () => {
    const requirement = { required: true, allowedScopes: [] };

    expect(() => checkGrantAgainstPolicy('ops:deploy', ApprovalScope.SESSION, undefined, requirement)).toThrow(
      ApprovalScopeNotAllowedError,
    );
    expect(isApprovalUsable(SESSION_RECORD, requirement, 2_000)).toBe(false);
  });

  it('an absent list allows every scope', () => {
    const requirement = { required: true };

    expect(checkGrantAgainstPolicy('ops:deploy', ApprovalScope.SESSION, undefined, requirement)).toBeUndefined();
    expect(isApprovalUsable(SESSION_RECORD, requirement, 2_000)).toBe(true);
  });
});
