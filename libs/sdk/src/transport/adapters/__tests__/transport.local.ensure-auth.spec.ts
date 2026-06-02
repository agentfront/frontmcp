/**
 * transport.local.adapter — ensureAuthInfo 401 (#471)
 *
 * When a token verifies but its session cannot be reconstructed (evicted /
 * expired), ensureAuthInfo must throw a PublicMcpError-derived 401 carrying a
 * `WWW-Authenticate: Bearer` challenge — NOT a plain Error that surfaces as a
 * 500/-32000. A valid session must still produce SdkAuthInfo as before.
 */
import 'reflect-metadata';

import { ServerRequestTokens } from '../../../common';
import { UnauthorizedError } from '../../../errors';
import { LocalTransportAdapter } from '../transport.local.adapter';

/**
 * Build a stand-in adapter instance WITHOUT running the heavy constructor
 * (which connects an McpServer). We only need `ensureAuthInfo`, so we attach
 * the minimum it touches: a logger and (optionally) initSessionPayload.
 */
function makeAdapter(): any {
  const adapter = Object.create(LocalTransportAdapter.prototype);
  adapter.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), verbose: jest.fn(), debug: jest.fn() };
  return adapter;
}

function makeReq(session?: { id: string; payload?: Record<string, unknown> }): any {
  return {
    [ServerRequestTokens.auth]: {
      token: 'verified-token',
      user: { sub: 'user-123' },
      session,
    },
  };
}

describe('LocalTransportAdapter.ensureAuthInfo — missing session → 401 (#471)', () => {
  it('UnauthorizedError is a 401 PublicMcpError (constructor contract)', () => {
    const err = new UnauthorizedError('nope');
    expect(err.statusCode).toBe(401);
    expect(err.isPublic).toBe(true);
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('throws UnauthorizedError (401) when the session is undefined', () => {
    const adapter = makeAdapter();
    let thrown: unknown;
    try {
      adapter.ensureAuthInfo(makeReq(undefined), adapter);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(UnauthorizedError);
    expect((thrown as UnauthorizedError).statusCode).toBe(401);
    // RFC 6750 challenge carried on the error for the flow runner to forward.
    expect((thrown as { wwwAuthenticate?: string }).wwwAuthenticate).toBe('Bearer');
  });

  it('throws UnauthorizedError (401) when the session has an empty id', () => {
    const adapter = makeAdapter();
    expect(() => adapter.ensureAuthInfo(makeReq({ id: '' }), adapter)).toThrow(UnauthorizedError);
  });

  it('does NOT throw a generic Error (so it cannot surface as 500/-32000)', () => {
    const adapter = makeAdapter();
    try {
      adapter.ensureAuthInfo(makeReq(undefined), adapter);
      throw new Error('expected ensureAuthInfo to throw');
    } catch (e) {
      // Must be the public 401, not a bare Error.
      expect(e).toBeInstanceOf(UnauthorizedError);
    }
  });

  it('returns SdkAuthInfo for a valid session (no regression)', () => {
    const adapter = makeAdapter();
    const transport = { marker: 'transport' };
    const authInfo = adapter.ensureAuthInfo(
      makeReq({ id: 'live-session-id', payload: { protocol: 'streamable-http' } }),
      transport,
    );
    expect(authInfo.sessionId).toBe('live-session-id');
    expect(authInfo.token).toBe('verified-token');
    expect(authInfo.transport).toBe(transport);
  });
});
