import { authInfoFromAuthorization } from '../auth-info.utils';

describe('authInfoFromAuthorization', () => {
  const user = {
    iss: 'https://auth.example.com',
    sub: 'user-123',
    scope: 'tickets:read  tickets:write',
    exp: 1_900_000_000,
  };

  it('puts the claims under user and extra.user, with the granted scopes', () => {
    const authInfo = authInfoFromAuthorization({
      token: 'access-token',
      user,
      session: { id: 'session-1' },
    });

    expect(authInfo).toEqual({
      token: 'access-token',
      clientId: 'user-123',
      scopes: ['tickets:read', 'tickets:write'],
      expiresAt: 1_900_000_000_000,
      user,
      extra: { user, sessionId: 'session-1', sessionPayload: undefined },
    });
  });

  it('grants no scopes and no expiry when the token carries none', () => {
    const authInfo = authInfoFromAuthorization({ token: 'access-token', user: { iss: 'issuer', sub: 'user-9' } });

    expect(authInfo.scopes).toEqual([]);
    expect(authInfo.expiresAt).toBeUndefined();
  });
});
