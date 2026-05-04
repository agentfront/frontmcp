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

  describe('error path — translates engine throws into structured deny', () => {
    // The execute_action contract is "every authority failure surfaces as
    // { granted: false, deniedBy }". Force the underlying engine to throw and
    // assert the catch block translates faithfully instead of bubbling.
    const installEngineThrow = (guard: AuthorityGuard, thrown: unknown) => {
      const internal = guard as unknown as { engine: { evaluate: () => Promise<unknown> } };
      internal.engine.evaluate = jest.fn().mockRejectedValue(thrown);
    };

    it('translates an Error to deniedBy=authority_evaluation_failed with the message', async () => {
      const errors: string[] = [];
      const logger = {
        error: (m: string) => errors.push(m),
        warn: () => undefined,
        info: () => undefined,
        debug: () => undefined,
        verbose: () => undefined,
        child: () => logger,
      } as unknown as Parameters<typeof AuthorityGuard.prototype.constructor>[0]['logger'];
      const guard = new AuthorityGuard({ logger });
      installEngineThrow(guard, new Error('engine boom'));
      const r = await guard.check({
        policy: { roles: { all: ['admin'] } },
        authInfo: { user: { sub: 'u', roles: ['admin'], permissions: [] } },
        input: {},
      });
      expect(r.granted).toBe(false);
      expect(r.deniedBy).toBe('authority_evaluation_failed');
      expect(r.message).toBe('engine boom');
      expect(errors.some((e) => e.includes('engine boom'))).toBe(true);
    });

    it('handles an Error with empty message', async () => {
      const guard = new AuthorityGuard();
      installEngineThrow(guard, new Error(''));
      const r = await guard.check({
        policy: { roles: { all: ['admin'] } },
        authInfo: { user: { sub: 'u', roles: [], permissions: [] } },
        input: {},
      });
      expect(r.granted).toBe(false);
      expect(r.message).toBe('authority evaluation threw');
    });

    it('handles a thrown string', async () => {
      const guard = new AuthorityGuard();
      installEngineThrow(guard, 'literal-string-error');
      const r = await guard.check({
        policy: { roles: { all: ['admin'] } },
        authInfo: { user: { sub: 'u', roles: [], permissions: [] } },
        input: {},
      });
      expect(r.message).toBe('literal-string-error');
    });

    it('handles a thrown object with message property', async () => {
      const guard = new AuthorityGuard();
      installEngineThrow(guard, { message: 'object-message' });
      const r = await guard.check({
        policy: { roles: { all: ['admin'] } },
        authInfo: { user: { sub: 'u', roles: [], permissions: [] } },
        input: {},
      });
      expect(r.message).toBe('object-message');
    });

    it('handles a thrown null with a stable fallback message', async () => {
      const guard = new AuthorityGuard();
      installEngineThrow(guard, null);
      const r = await guard.check({
        policy: { roles: { all: ['admin'] } },
        authInfo: { user: { sub: 'u', roles: [], permissions: [] } },
        input: {},
      });
      expect(r.granted).toBe(false);
      expect(r.message).toBe('authority evaluation threw');
    });
  });
});
