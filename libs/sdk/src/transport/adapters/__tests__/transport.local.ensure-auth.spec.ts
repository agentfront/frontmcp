/**
 * transport.local.adapter — ensureAuthInfo
 *
 * Two contracts:
 *
 * 1. #471 — when a token verifies but its session cannot be reconstructed
 *    (evicted / expired), ensureAuthInfo must throw a PublicMcpError-derived
 *    401 carrying a `WWW-Authenticate: Bearer` challenge — NOT a plain Error
 *    that surfaces as a 500/-32000.
 *
 * 2. The AuthInfo handed to tool code must carry the scopes and claims the
 *    request's verified `Authorization` actually holds. They used to be dropped
 *    (`scopes: []` hardcoded), which silently disabled every scope-based check
 *    downstream — including the job/workflow permission guard.
 *
 * 3. Every request keeps its caller on the session, without the token: what is
 *    pushed to the session later (an event with `channel`) is checked against
 *    the caller of its latest request, and not sent once its credentials expired.
 */
import 'reflect-metadata';

import { ServerRequestTokens } from '../../../common';
import { UnauthorizedError } from '../../../errors';
import { LocalTransportAdapter } from '../transport.local.adapter';

/**
 * Build a stand-in adapter instance WITHOUT running the heavy constructor
 * (which connects an McpServer). We only need `ensureAuthInfo`, so we attach
 * the minimum it touches: a logger, the session it serves, the notification
 * service that keeps the session's caller, and (optionally) initSessionPayload.
 */
function makeAdapter(): any {
  const adapter = Object.create(LocalTransportAdapter.prototype);
  adapter.logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), verbose: jest.fn(), debug: jest.fn() };
  adapter.key = { sessionId: 'live-session-id' };
  adapter.scope = { notifications: { setCaller: jest.fn() } };
  return adapter;
}

function makeReq(
  session?: { id: string; payload?: Record<string, unknown> },
  authorization: Record<string, unknown> = {},
): any {
  return {
    [ServerRequestTokens.auth]: {
      token: 'verified-token',
      user: { sub: 'user-123' },
      session,
      ...authorization,
    },
  };
}

const liveSession = { id: 'live-session-id', payload: { protocol: 'streamable-http' as const } };

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
    const authInfo = adapter.ensureAuthInfo(makeReq(liveSession), transport);
    expect(authInfo.sessionId).toBe('live-session-id');
    expect(authInfo.token).toBe('verified-token');
    expect(authInfo.transport).toBe(transport);
  });
});

describe('LocalTransportAdapter.ensureAuthInfo — verified scopes and claims reach tool code', () => {
  it('carries the verified scopes through to AuthInfo', () => {
    const adapter = makeAdapter();
    const authInfo = adapter.ensureAuthInfo(makeReq(liveSession, { scopes: ['read', 'admin'] }), {});

    expect(authInfo.scopes).toEqual(['read', 'admin']);
  });

  it('carries the verified claims through to AuthInfo', () => {
    const adapter = makeAdapter();
    const claims = { roles: ['admin'], tenant: 'acme' };
    const authInfo = adapter.ensureAuthInfo(makeReq(liveSession, { claims }), {});

    expect(authInfo.claims).toEqual(claims);
  });

  it('defaults to an empty scope set when the authorization carries none', () => {
    const adapter = makeAdapter();
    const authInfo = adapter.ensureAuthInfo(makeReq(liveSession), {});

    expect(authInfo.scopes).toEqual([]);
    expect(authInfo.claims).toBeUndefined();
  });

  it('does not alias the authorization scope array (tool code cannot mutate it)', () => {
    const adapter = makeAdapter();
    const scopes = ['read'];
    const authInfo = adapter.ensureAuthInfo(makeReq(liveSession, { scopes }), {});

    authInfo.scopes.push('admin');
    expect(scopes).toEqual(['read']);
  });

  it('does not alias the claims object, at any depth', () => {
    // Tool code receives this AuthInfo. A nested mutation on a shared reference
    // would rewrite the request's own verified authorization — which the
    // job/workflow permission guard reads to decide what the caller may run.
    const adapter = makeAdapter();
    const claims = { roles: ['viewer'], tenant: { id: 'acme' } };
    const authInfo = adapter.ensureAuthInfo(makeReq(liveSession, { claims }), {});

    (authInfo.claims as { roles: string[] }).roles.push('admin');
    (authInfo.claims as { tenant: { id: string } }).tenant.id = 'evil';

    expect(claims.roles).toEqual(['viewer']);
    expect(claims.tenant.id).toBe('acme');
  });
});

describe('LocalTransportAdapter.ensureAuthInfo — the session keeps the caller of its latest request', () => {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;

  it('keeps the verified user, scopes and claims and the expiry of the token, and not the token', () => {
    const adapter = makeAdapter();
    const user = { sub: 'user-123', exp: expiresAt };
    const claims = { roles: ['admin'] };

    adapter.ensureAuthInfo(makeReq(liveSession, { user, scopes: ['read'], claims }), {});

    expect(adapter.scope.notifications.setCaller).toHaveBeenCalledTimes(1);
    const [sessionId, caller] = adapter.scope.notifications.setCaller.mock.calls[0];
    expect(sessionId).toBe('live-session-id');
    expect(caller).toEqual({ clientId: 'user-123', scopes: ['read'], user, claims, expiresAt });
    expect(JSON.stringify(caller)).not.toContain('verified-token');
  });

  it('keeps the caller of every request, so a later request replaces the one before', () => {
    const adapter = makeAdapter();

    adapter.ensureAuthInfo(makeReq(liveSession, { claims: { roles: ['admin'] } }), {});
    adapter.ensureAuthInfo(makeReq(liveSession, { claims: { roles: ['member'] } }), {});

    const kept = adapter.scope.notifications.setCaller.mock.calls.map(([, caller]: [string, unknown]) => caller);
    expect(kept).toEqual([
      expect.objectContaining({ claims: { roles: ['admin'] } }),
      expect.objectContaining({ claims: { roles: ['member'] } }),
    ]);
  });

  it('keeps the verified claims themselves, which tool code cannot reach through its AuthInfo', () => {
    const adapter = makeAdapter();
    const claims = { roles: ['viewer'] };

    const authInfo = adapter.ensureAuthInfo(makeReq(liveSession, { claims, scopes: ['read'] }), {});
    (authInfo.claims as { roles: string[] }).roles.push('admin');
    authInfo.scopes.push('admin');

    const [, caller] = adapter.scope.notifications.setCaller.mock.calls[0];
    expect(caller.claims).toEqual({ roles: ['viewer'] });
    expect(caller.scopes).toEqual(['read']);
  });

  it('keeps no expiry for a caller whose credentials have none, as in public mode', () => {
    const adapter = makeAdapter();

    adapter.ensureAuthInfo(makeReq(liveSession, { user: { sub: 'anon:1' } }), {});

    const [, caller] = adapter.scope.notifications.setCaller.mock.calls[0];
    expect(caller.expiresAt).toBeUndefined();
  });

  it('keeps nothing for a request whose session could not be reconstructed', () => {
    const adapter = makeAdapter();

    expect(() => adapter.ensureAuthInfo(makeReq(undefined), adapter)).toThrow(UnauthorizedError);

    expect(adapter.scope.notifications.setCaller).not.toHaveBeenCalled();
  });
});
