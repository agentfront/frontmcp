import {
  AuthoritiesContextBuilder,
  AuthoritiesEngine,
  AuthoritiesEvaluatorRegistry,
  AuthoritiesProfileRegistry,
} from '@frontmcp/auth';

import { AuthorityGuard, policyDependsOnInput } from '../security/authority-guard';

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

  // ── C2: skill-level + op-level policies are AND-ed ───────────────────────────
  describe('skill-level + op-level AND (C2)', () => {
    it('denies when the skill-level policy fails even if the op-level policy would pass', async () => {
      const guard = new AuthorityGuard();
      const r = await guard.check({
        policy: { roles: { all: ['user'] } }, // op-level: passes
        skillPolicy: { roles: { all: ['admin'] } }, // skill-level: fails
        authInfo: { user: { sub: 'u', roles: ['user'], permissions: [] } },
        input: {},
      });
      expect(r.granted).toBe(false);
    });

    it('denies when the op-level policy fails even if the skill-level policy passes', async () => {
      const guard = new AuthorityGuard();
      const r = await guard.check({
        policy: { roles: { all: ['admin'] } }, // op-level: fails
        skillPolicy: { roles: { all: ['user'] } }, // skill-level: passes
        authInfo: { user: { sub: 'u', roles: ['user'], permissions: [] } },
        input: {},
      });
      expect(r.granted).toBe(false);
    });

    it('grants only when BOTH skill-level and op-level policies pass', async () => {
      const guard = new AuthorityGuard();
      const r = await guard.check({
        policy: { permissions: { all: ['invoices:write'] } },
        skillPolicy: { roles: { all: ['admin'] } },
        authInfo: { user: { sub: 'u', roles: ['admin'], permissions: ['invoices:write'] } },
        input: {},
      });
      expect(r.granted).toBe(true);
    });

    it('enforces the skill-level policy when there is no op-level policy', async () => {
      const guard = new AuthorityGuard();
      const denied = await guard.check({
        policy: undefined,
        skillPolicy: { roles: { all: ['admin'] } },
        authInfo: { user: { sub: 'u', roles: ['user'], permissions: [] } },
        input: {},
      });
      expect(denied.granted).toBe(false);
      const granted = await guard.check({
        policy: undefined,
        skillPolicy: { roles: { all: ['admin'] } },
        authInfo: { user: { sub: 'u', roles: ['admin'], permissions: [] } },
        input: {},
      });
      expect(granted.granted).toBe(true);
    });
  });

  // ── C1/C3: default-deny for unprotected ops ──────────────────────────────────
  describe('unprotectedOps default-deny (C1/C3)', () => {
    const anon = { user: { sub: 'u', roles: [], permissions: [] } };

    it('grants a policy-less op under the default unprotectedOps:"allow"', async () => {
      const guard = new AuthorityGuard();
      const r = await guard.check({ policy: undefined, authInfo: anon, input: {} });
      expect(r.granted).toBe(true);
    });

    it('denies a policy-less, non-public op under unprotectedOps:"deny"', async () => {
      const guard = new AuthorityGuard();
      const r = await guard.check({ policy: undefined, unprotectedOps: 'deny', authInfo: anon, input: {} });
      expect(r.granted).toBe(false);
      expect(r.deniedBy).toBe('unprotected_operation_denied');
    });

    it('grants a policy-less op marked public:true under unprotectedOps:"deny"', async () => {
      const guard = new AuthorityGuard();
      const r = await guard.check({
        policy: undefined,
        isPublic: true,
        unprotectedOps: 'deny',
        authInfo: anon,
        input: {},
      });
      expect(r.granted).toBe(true);
    });

    it('still evaluates a real policy under unprotectedOps:"deny" (deny does not blanket-block)', async () => {
      const guard = new AuthorityGuard();
      const r = await guard.check({
        policy: { roles: { all: ['admin'] } },
        unprotectedOps: 'deny',
        authInfo: { user: { sub: 'u', roles: ['admin'], permissions: [] } },
        input: {},
      });
      expect(r.granted).toBe(true);
    });
  });

  describe('error path — translates engine throws into structured deny', () => {
    // The skill-action executor contract is "every authority failure surfaces as
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

  describe("the server's authorities settings", () => {
    const serverAuthorities = () => {
      const evaluators = new AuthoritiesEvaluatorRegistry();
      evaluators.register('businessHours', {
        name: 'businessHours',
        evaluate: async () => ({ granted: true, evaluatedPolicies: ['custom.businessHours'] }),
      });
      return {
        engine: new AuthoritiesEngine(new AuthoritiesProfileRegistry(), evaluators),
        contextBuilder: new AuthoritiesContextBuilder({ claimsMapping: { roles: 'realm_access.roles' } }),
      };
    };
    const viewerWithStrayRolesClaim = { user: { sub: 'u', roles: ['admin'], realm_access: { roles: ['viewer'] } } };
    const mappedAdmin = { user: { sub: 'u', realm_access: { roles: ['admin'] } } };

    it("reads roles through the server's claimsMapping when the server has authorities", async () => {
      const guard = new AuthorityGuard({ serverAuthorities });
      const policy = { roles: { any: ['admin'] } };

      expect((await guard.check({ policy, authInfo: viewerWithStrayRolesClaim, input: {} })).granted).toBe(false);
      expect((await guard.check({ policy, authInfo: mappedAdmin, input: {} })).granted).toBe(true);
    });

    it("uses the server's engine, so a rule can use the server's custom evaluators", async () => {
      const policy = { custom: { businessHours: {} } };

      expect((await new AuthorityGuard().check({ policy, authInfo: mappedAdmin, input: {} })).granted).toBe(false);
      expect(
        (await new AuthorityGuard({ serverAuthorities }).check({ policy, authInfo: mappedAdmin, input: {} })).granted,
      ).toBe(true);
    });

    it('keeps its own defaults (the `roles` claim) when the server has no authorities', async () => {
      const guard = new AuthorityGuard({ serverAuthorities: () => undefined });
      const policy = { roles: { any: ['admin'] } };

      expect((await guard.check({ policy, authInfo: viewerWithStrayRolesClaim, input: {} })).granted).toBe(true);
    });
  });

  describe('canDiscover (what search_skill / load_skill may show)', () => {
    const guard = new AuthorityGuard();
    const viewer = { user: { sub: 'u', roles: ['viewer'] } };

    it('hides an action whose rule refuses the caller whatever the input', async () => {
      expect(await guard.canDiscover({ policy: { roles: { any: ['admin'] } }, authInfo: viewer })).toBe(false);
    });

    it('shows an action whose only rule depends on the input', async () => {
      const policy = { attributes: { conditions: [{ path: 'input.amount', op: 'lte', value: 100 }] } };
      expect(await guard.canDiscover({ policy, authInfo: viewer })).toBe(true);
    });

    it('still judges the rules that do not depend on the input', async () => {
      const policy = { attributes: { conditions: [{ path: 'input.amount', op: 'lte', value: 100 }] } };
      expect(await guard.canDiscover({ policy, skillPolicy: { roles: { any: ['admin'] } }, authInfo: viewer })).toBe(
        false,
      );
    });

    it('hides a policy-less, non-public action under unprotectedOps:"deny", and shows a public one', async () => {
      expect(await guard.canDiscover({ unprotectedOps: 'deny', authInfo: viewer })).toBe(false);
      expect(await guard.canDiscover({ unprotectedOps: 'deny', isPublic: true, authInfo: viewer })).toBe(true);
    });
  });

  describe('policyDependsOnInput', () => {
    it.each([
      [{ attributes: { conditions: [{ path: 'input.amount', op: 'lte', value: 1 }] } }, true],
      [{ attributes: { match: { 'input.tenant': 'acme' } } }, true],
      [{ relationships: { type: 'member', resource: 'site', resourceId: { fromInput: 'siteId' } } }, true],
      [{ custom: { quota: {} } }, true],
      [{ roles: { any: ['admin'] }, permissions: { all: ['invoices:write'] } }, false],
      [{ not: { attributes: { conditions: [{ path: 'claims.tenant', op: 'eq', value: 'a' }] } } }, false],
    ])('%j → %s', (policy, expected) => {
      expect(policyDependsOnInput(policy)).toBe(expected);
    });
  });
});
