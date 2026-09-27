import { DEFAULT_ALLOWED_SCOPES, grantScopes } from '../scope-grant.utils';

describe('grantScopes', () => {
  it('grants only the standard OpenID scopes when nothing is configured', () => {
    expect(grantScopes(['openid', 'admin', 'email', 'tickets:write'], undefined)).toEqual(['openid', 'email']);
    expect(DEFAULT_ALLOWED_SCOPES).toEqual(['openid', 'profile', 'email', 'offline_access']);
  });

  it('grants exact matches and `*` globs from the allowlist, in request order', () => {
    expect(
      grantScopes(['reports:read', 'tickets:read', 'admin', 'tickets:write'], ['tickets:*', 'reports:read']),
    ).toEqual(['reports:read', 'tickets:read', 'tickets:write']);
  });

  it('drops duplicates and empty entries', () => {
    expect(grantScopes(['openid', '', 'openid'], undefined)).toEqual(['openid']);
  });

  it('grants nothing with an empty allowlist', () => {
    expect(grantScopes(['openid'], [])).toEqual([]);
  });

  it('does not let a glob cross into a longer name it was not written for', () => {
    expect(grantScopes(['tickets', 'ticketsadmin'], ['tickets'])).toEqual(['tickets']);
  });
});
