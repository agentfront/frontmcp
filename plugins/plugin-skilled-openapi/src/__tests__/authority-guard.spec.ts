import { AuthorityGuard } from '../security/authority-guard';

describe('AuthorityGuard', () => {
  it('grants when no policy is supplied', async () => {
    const guard = new AuthorityGuard();
    const r = await guard.check({
      policy: undefined,
      authInfo: { user: { sub: 'u', roles: [], permissions: [] } },
      input: {},
    });
    expect(r.granted).toBe(true);
  });

  it('grants RBAC when caller has the required role', async () => {
    const guard = new AuthorityGuard();
    const r = await guard.check({
      policy: { roles: { all: ['admin'] } },
      authInfo: { user: { sub: 'u', roles: ['admin'], permissions: [] } },
      input: {},
    });
    expect(r.granted).toBe(true);
  });

  it('denies RBAC when caller is missing the required role', async () => {
    const guard = new AuthorityGuard();
    const r = await guard.check({
      policy: { roles: { all: ['admin'] } },
      authInfo: { user: { sub: 'u', roles: ['user'], permissions: [] } },
      input: {},
    });
    expect(r.granted).toBe(false);
  });

  it('grants RBAC permission policies', async () => {
    const guard = new AuthorityGuard();
    const r = await guard.check({
      policy: { permissions: { all: ['invoices:write'] } },
      authInfo: { user: { sub: 'u', roles: [], permissions: ['invoices:write'] } },
      input: {},
    });
    expect(r.granted).toBe(true);
  });

  it('denies RBAC permission policies when missing', async () => {
    const guard = new AuthorityGuard();
    const r = await guard.check({
      policy: { permissions: { all: ['invoices:write'] } },
      authInfo: { user: { sub: 'u', roles: [], permissions: ['invoices:read'] } },
      input: {},
    });
    expect(r.granted).toBe(false);
  });

  it('passes ABAC match predicates that reference input', async () => {
    const guard = new AuthorityGuard();
    const r = await guard.check({
      policy: { attributes: { match: { 'input.tenantId': 'acme' } } },
      authInfo: { user: { sub: 'u', roles: [], permissions: [] } },
      input: { tenantId: 'acme' },
    });
    expect(r.granted).toBe(true);
  });

  it('fails ABAC match predicates when input does not match', async () => {
    const guard = new AuthorityGuard();
    const r = await guard.check({
      policy: { attributes: { match: { 'input.tenantId': 'acme' } } },
      authInfo: { user: { sub: 'u', roles: [], permissions: [] } },
      input: { tenantId: 'other' },
    });
    expect(r.granted).toBe(false);
  });

  it('combines fields with AND by default — denial wins', async () => {
    const guard = new AuthorityGuard();
    const r = await guard.check({
      policy: { roles: { all: ['admin'] }, permissions: { all: ['invoices:write'] } },
      authInfo: { user: { sub: 'u', roles: ['admin'], permissions: [] } },
      input: {},
    });
    expect(r.granted).toBe(false);
  });

  it('OR combinator grants when one branch passes', async () => {
    const guard = new AuthorityGuard();
    const r = await guard.check({
      policy: {
        operator: 'OR',
        roles: { all: ['admin'] },
        permissions: { all: ['invoices:write'] },
      },
      authInfo: { user: { sub: 'u', roles: ['admin'], permissions: [] } },
      input: {},
    });
    expect(r.granted).toBe(true);
  });
});
