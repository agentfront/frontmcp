import { authInfoFromAuthorization, sessionIdPresentedBy } from '../auth-info.utils';

describe('authInfoFromAuthorization', () => {
  const user = {
    iss: 'https://auth.example.com',
    sub: 'user-123',
    scope: 'tickets:read  tickets:write',
    exp: 1_900_000_000,
  };

  it('puts the claims under user and extra.user, with the granted scopes', () => {
    const authInfo = authInfoFromAuthorization(
      {
        token: 'access-token',
        user,
        session: { id: 'session-1' },
      },
      'session-1',
    );

    expect(authInfo).toEqual({
      token: 'access-token',
      clientId: 'user-123',
      scopes: ['tickets:read', 'tickets:write'],
      expiresAt: 1_900_000_000,
      user,
      extra: {
        user,
        sessionId: 'session-1',
        sessionPayload: undefined,
        principal: { kind: 'person', sub: 'user-123' },
      },
    });
  });

  it('grants no scopes and no expiry when the token carries none', () => {
    const authInfo = authInfoFromAuthorization({ token: 'access-token', user: { iss: 'issuer', sub: 'user-9' } });

    expect(authInfo.scopes).toEqual([]);
    expect(authInfo.expiresAt).toBeUndefined();
  });

  it('records no session that the request did not present', () => {
    const minted = { token: '', user, session: { id: 'minted-for-this-request' } };

    expect([
      authInfoFromAuthorization(minted).extra,
      authInfoFromAuthorization(minted, 'another-session').extra,
    ]).toEqual([
      { user, sessionId: undefined, sessionPayload: undefined, principal: { kind: 'person', sub: 'user-123' } },
      { user, sessionId: undefined, sessionPayload: undefined, principal: { kind: 'person', sub: 'user-123' } },
    ]);
  });

  it('carries the principal session verification resolved, else the one the claims name', () => {
    const resolved = { kind: 'machine' as const, sub: 'svc-sync', clientId: 'sync-client' };
    const machine = { iss: 'issuer', sub: 'sync-client', client_id: 'sync-client', iat: 1_800_000_000 };

    expect(authInfoFromAuthorization({ token: 't', user, principal: resolved }).extra.principal).toBe(resolved);
    expect(authInfoFromAuthorization({ token: 't', user: machine }).extra.principal).toEqual({
      kind: 'machine',
      sub: 'sync-client',
      clientId: 'sync-client',
      authTime: 1_800_000_000,
    });
  });

  it("carries the issuer of a token from another issuer than the server's own", () => {
    const fromOtherIssuer = { token: 'access-token', user, principalIssuer: 'https://tenant-b.example.com' };

    expect(authInfoFromAuthorization(fromOtherIssuer).extra?.['principalIssuer']).toBe('https://tenant-b.example.com');
    expect(authInfoFromAuthorization({ token: 'access-token', user }).extra?.['principalIssuer']).toBeUndefined();
  });
});

describe('sessionIdPresentedBy', () => {
  it('is the mcp-session-id header, else the legacy SSE sessionId query', () => {
    expect([
      sessionIdPresentedBy({ headers: { 'mcp-session-id': 'from-header' }, query: { sessionId: 'from-query' } }),
      sessionIdPresentedBy({ headers: {}, query: { sessionId: 'from-query' } }),
    ]).toEqual(['from-header', 'from-query']);
  });

  it('is undefined when the request carries no usable id', () => {
    expect([
      sessionIdPresentedBy({}),
      sessionIdPresentedBy({ headers: { 'mcp-session-id': '' }, query: {} }),
      sessionIdPresentedBy({ headers: { 'mcp-session-id': ['a', 'b'] } }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
