/**
 * Session approvals are keyed by caller, never by the shared stateless session id
 * (GHSA-r848-p7wf-96rc follow-up).
 */
import 'reflect-metadata';

import { STATELESS_SESSION_ID } from '@frontmcp/sdk';

import { resolveApprovalIdentity } from '../approval.identity';

describe('resolveApprovalIdentity (GHSA-r848-p7wf-96rc)', () => {
  it('keys a stateful call by its session', () => {
    expect(resolveApprovalIdentity({ sessionId: 'session-1', authInfo: { clientId: 'alice' } })).toEqual({
      sessionId: 'session-1',
      userId: 'alice',
    });
  });

  it('keys a stateless call by its authenticated principal', () => {
    expect(resolveApprovalIdentity({ sessionId: STATELESS_SESSION_ID, authInfo: { clientId: 'alice' } })).toEqual({
      sessionId: 'stateless-user:alice',
      userId: 'alice',
    });
  });

  it('gives two stateless principals different keys', () => {
    const alice = resolveApprovalIdentity({ sessionId: STATELESS_SESSION_ID, authInfo: { clientId: 'alice' } });
    const bob = resolveApprovalIdentity({ sessionId: STATELESS_SESSION_ID, authInfo: { clientId: 'bob' } });

    expect(alice.sessionId).not.toBe(bob.sessionId);
  });

  it('prefers the server-set userId and sub over the client id', () => {
    expect(
      resolveApprovalIdentity({ sessionId: 'session-1', authInfo: { clientId: 'client', extra: { userId: 'user' } } })
        .userId,
    ).toBe('user');
    expect(
      resolveApprovalIdentity({ sessionId: 'session-1', authInfo: { clientId: 'client', extra: { sub: 'subject' } } })
        .userId,
    ).toBe('subject');
  });

  it('gives each unidentified stateless call a key no other call shares', () => {
    const first = resolveApprovalIdentity({ sessionId: STATELESS_SESSION_ID, authInfo: { clientId: '' } });
    const second = resolveApprovalIdentity({ sessionId: STATELESS_SESSION_ID, authInfo: {} });

    expect(first.userId).toBeUndefined();
    expect(first.sessionId).toMatch(/^unidentified:/);
    expect(first.sessionId).not.toBe(second.sessionId);
  });

  it('never falls back to a shared placeholder when there is no context', () => {
    const first = resolveApprovalIdentity(undefined);
    const second = resolveApprovalIdentity(undefined);

    expect(first.sessionId).not.toBe('unknown');
    expect(first.sessionId).not.toBe(second.sessionId);
  });
});
