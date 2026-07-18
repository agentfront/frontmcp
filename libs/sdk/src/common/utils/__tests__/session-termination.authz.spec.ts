/**
 * authorizeSessionTermination — cross-session DELETE termination guard.
 *
 * Regression for the unauthenticated cross-session termination finding: the
 * `http:request` router's DELETE branch used to terminate whatever
 * `mcp-session-id` a request carried, without ever consulting the auth result
 * or checking ownership. This guard requires an authorized verify result AND
 * that the requested id is the caller's OWN verified session id.
 */
import { authorizeSessionTermination } from '../decide-request-intent.utils';

describe('authorizeSessionTermination', () => {
  it('denies an unauthenticated request (no authorization)', () => {
    const d = authorizeSessionTermination({ kind: 'unauthorized' }, 'sess-victim');
    expect(d.kind).toBe('unauthorized');
  });

  it('denies when verifyResult is missing entirely', () => {
    expect(authorizeSessionTermination(undefined, 'sess-victim').kind).toBe('unauthorized');
  });

  it('forbids terminating a session the caller does not own', () => {
    const verify = { kind: 'authorized', authorization: { session: { id: 'sess-attacker' } } };
    const d = authorizeSessionTermination(verify, 'sess-victim'); // attacker targets someone else's id
    expect(d.kind).toBe('forbidden');
  });

  it('forbids when the caller has no bound session id', () => {
    const verify = { kind: 'authorized', authorization: {} };
    expect(authorizeSessionTermination(verify, 'sess-victim').kind).toBe('forbidden');
  });

  it('forbids when no session id is requested', () => {
    const verify = { kind: 'authorized', authorization: { session: { id: 'sess-own' } } };
    expect(authorizeSessionTermination(verify, undefined).kind).toBe('forbidden');
  });

  it('allows terminating the caller OWN verified session', () => {
    const verify = { kind: 'authorized', authorization: { session: { id: 'sess-own' } } };
    const d = authorizeSessionTermination(verify, 'sess-own');
    expect(d).toEqual({ kind: 'ok', sessionId: 'sess-own' });
  });
});
