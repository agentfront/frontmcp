/** Session approvals are keyed by verified session, else by principal (GHSA-r848-p7wf-96rc, #597). */
import 'reflect-metadata';

import { resolveApprovalIdentity } from '../approval.identity';

describe('resolveApprovalIdentity (GHSA-r848-p7wf-96rc)', () => {
  it('keys a call in a verified session by its session', () => {
    expect(resolveApprovalIdentity({ verifiedSessionId: 'session-1', authInfo: { clientId: 'alice' } })).toEqual({
      sessionId: 'session-1',
      userId: 'alice',
    });
  });

  it('keys a call without a verified session by its authenticated principal', () => {
    expect(resolveApprovalIdentity({ verifiedSessionId: undefined, authInfo: { clientId: 'alice' } })).toEqual({
      sessionId: 'stateless-user:alice',
      userId: 'alice',
    });
  });

  it('gives two principals without a verified session different keys', () => {
    const alice = resolveApprovalIdentity({ verifiedSessionId: undefined, authInfo: { clientId: 'alice' } });
    const bob = resolveApprovalIdentity({ verifiedSessionId: undefined, authInfo: { clientId: 'bob' } });

    expect(alice.sessionId).not.toBe(bob.sessionId);
  });

  it('prefers the server-set userId and sub over the client id', () => {
    expect(
      resolveApprovalIdentity({
        verifiedSessionId: 'session-1',
        authInfo: { clientId: 'client', extra: { userId: 'user' } },
      }).userId,
    ).toBe('user');
    expect(
      resolveApprovalIdentity({
        verifiedSessionId: 'session-1',
        authInfo: { clientId: 'client', extra: { sub: 'subject' } },
      }).userId,
    ).toBe('subject');
  });

  it('gives each unidentified call without a verified session a key no other call shares', () => {
    const first = resolveApprovalIdentity({ verifiedSessionId: undefined, authInfo: { clientId: '' } });
    const second = resolveApprovalIdentity({ verifiedSessionId: undefined, authInfo: {} });

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
